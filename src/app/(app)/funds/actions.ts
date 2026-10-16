"use server";

import { revalidatePath } from "next/cache";
import { exec, one, transaction } from "@/lib/db";
import { assertRoomFor, insertAttachments, readUploads } from "@/lib/attachments.server";
import { loadLedger } from "@/lib/ledger";
import { requireSession } from "@/lib/auth/server";
import { assertAppOwner } from "@/lib/authz";
import type { CapitalInflowType, Currency, MoneyAccountKind } from "@/lib/types";

export type FundsFormState = { error: string | null; ok: string | null };

function value(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

async function owner() {
  const session = await requireSession();
  assertAppOwner(session);
  return session;
}

export async function addMoneyAccount(
  _previous: FundsFormState,
  formData: FormData
): Promise<FundsFormState> {
  await owner();
  const name = value(formData, "name");
  const kind = value(formData, "kind") as MoneyAccountKind;
  const currency = value(formData, "currency") as Currency;
  const holderName = value(formData, "holder_name") || null;
  const notes = value(formData, "notes") || null;

  if (!name) return { error: "Enter an account name.", ok: null };
  if (!(["company_bank", "personal_custody", "digital_wallet", "cash"] as string[]).includes(kind)) {
    return { error: "Choose a valid account type.", ok: null };
  }
  if (!(["NPR", "USD"] as string[]).includes(currency)) {
    return { error: "Choose NPR or USD.", ok: null };
  }
  if (kind === "personal_custody" && !holderName) {
    return { error: "Enter the legal account holder.", ok: null };
  }

  try {
    await exec(
      `insert into public.money_accounts (name, kind, currency, holder_name, notes)
       values ($1,$2,$3,$4,$5)`,
      [name, kind, currency, holderName, notes]
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("unique")) {
      return { error: "An account with this name and currency already exists.", ok: null };
    }
    throw error;
  }

  revalidatePath("/funds");
  revalidatePath("/income");
  revalidatePath("/expenses");
  revalidatePath("/");
  return { error: null, ok: `${name} added.` };
}

export async function addMoneyTransfer(
  _previous: FundsFormState,
  formData: FormData
): Promise<FundsFormState> {
  const session = await owner();
  const fromAccountId = value(formData, "from_account_id");
  const toAccountId = value(formData, "to_account_id");
  const fromAmount = Number(formData.get("from_amount"));
  const toAmount = Number(formData.get("to_amount"));
  const transferDate = value(formData, "transfer_date");
  const note = value(formData, "note") || null;

  if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
    return { error: "Choose two different accounts.", ok: null };
  }
  if (!Number.isFinite(fromAmount) || fromAmount <= 0 || !Number.isFinite(toAmount) || toAmount <= 0) {
    return { error: "Enter both transferred amounts.", ok: null };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) {
    return { error: "Enter the transfer date.", ok: null };
  }

  const fromAccount = await one<{ name: string; currency: string; is_active: boolean }>(
    `select name, currency, is_active from public.money_accounts where id = $1`,
    [fromAccountId]
  );
  const toAccount = await one<{ name: string; is_active: boolean }>(
    `select name, is_active from public.money_accounts where id = $1`,
    [toAccountId]
  );
  if (!fromAccount?.is_active || !toAccount?.is_active) {
    return { error: "One of those accounts is unavailable.", ok: null };
  }

  const fromBalance = (await loadLedger()).balances.find(
    (item) => item.account.id === fromAccountId
  );
  if (fromAmount > (fromBalance?.balance ?? 0) + 0.001) {
    return { error: `Only ${(fromBalance?.balance ?? 0).toLocaleString("en-NP")} is available in ${fromAccount.name}.`, ok: null };
  }

  await exec(
    `insert into public.money_transfers
       (from_account_id, to_account_id, from_amount, to_amount, transfer_date, note, created_by)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [fromAccountId, toAccountId, fromAmount, toAmount, transferDate, note, session.sub]
  );

  revalidateFunds();
  return { error: null, ok: `Moved money from ${fromAccount.name} to ${toAccount.name}.` };
}

// -----------------------------------------------------------------------------
// Non-revenue money in
//
// Founder capital, owner contributions and loans raise an account balance
// without being earned. Keeping them in their own ledger is the whole reason
// nobody has to invent a fake client to correct a bank balance — and the reason
// revenue, client income, VAT sales and profit stay untouched by them.
// -----------------------------------------------------------------------------

const CAPITAL_TYPES: CapitalInflowType[] = [
  "founder_investment",
  "owner_contribution",
  "loan_received",
  "other_non_revenue",
];

function revalidateFunds() {
  revalidatePath("/funds");
  revalidatePath("/income");
  revalidatePath("/");
}

function parseCapital(formData: FormData) {
  const accountId = value(formData, "money_account_id");
  const inflowType = value(formData, "inflow_type") as CapitalInflowType;
  const amount = Number(formData.get("amount"));
  const receivedOn = value(formData, "received_on");
  const sourceName = value(formData, "source_name") || null;
  const reference = value(formData, "reference") || null;
  const note = value(formData, "note") || null;

  if (!accountId) return { error: "Choose the account that received the money." } as const;
  if (!CAPITAL_TYPES.includes(inflowType)) {
    return { error: "Choose what kind of non-revenue funding this is." } as const;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "The amount must be greater than zero." } as const;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) {
    return { error: "Enter the date the money reached the account." } as const;
  }
  return {
    value: {
      accountId,
      inflowType,
      amount: Math.round(amount * 100) / 100,
      receivedOn,
      sourceName,
      reference,
      note,
    },
  } as const;
}

export async function addCapitalInflow(
  _previous: FundsFormState,
  formData: FormData
): Promise<FundsFormState> {
  const session = await owner();
  const parsed = parseCapital(formData);
  if ("error" in parsed) return { error: parsed.error ?? "Check the funding details.", ok: null };
  const input = parsed.value;

  const account = await one<{ name: string; is_active: boolean }>(
    `select name, is_active from public.money_accounts where id = $1`,
    [input.accountId]
  );
  if (!account?.is_active) return { error: "That account is unavailable.", ok: null };

  await exec(
    `insert into public.capital_inflows
       (money_account_id, inflow_type, amount, received_on, source_name, reference, note, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.accountId,
      input.inflowType,
      input.amount,
      input.receivedOn,
      input.sourceName,
      input.reference,
      input.note,
      session.sub,
    ]
  );

  revalidateFunds();
  return { error: null, ok: `Added to ${account.name}. This is capital, not revenue.` };
}

export async function updateCapitalInflow(
  _previous: FundsFormState,
  formData: FormData
): Promise<FundsFormState> {
  const session = await owner();
  const id = value(formData, "inflow_id");
  if (!id) return { error: "That funding record was not found.", ok: null };
  const parsed = parseCapital(formData);
  if ("error" in parsed) return { error: parsed.error ?? "Check the funding details.", ok: null };
  const input = parsed.value;

  const changed = await exec(
    `update public.capital_inflows
        set money_account_id = $1, inflow_type = $2, amount = $3, received_on = $4,
            source_name = $5, reference = $6, note = $7, updated_by = $8, updated_at = now()
      where id = $9`,
    [
      input.accountId,
      input.inflowType,
      input.amount,
      input.receivedOn,
      input.sourceName,
      input.reference,
      input.note,
      session.sub,
      id,
    ]
  );
  if (!changed) return { error: "That funding record no longer exists.", ok: null };

  revalidateFunds();
  return { error: null, ok: "Funding record updated." };
}

export async function deleteCapitalInflow(id: string) {
  await owner();
  await exec(`delete from public.capital_inflows where id = $1`, [id]);
  revalidateFunds();
}

// -----------------------------------------------------------------------------
// VAT bills in the company's name, and reimbursing them
//
// A lawyer or rent bill issued to Avernek is often paid first from Swornim's
// non-VAT account. Recording the bill here and reimbursing it from the VAT
// account moves the money back AND books the bill as a company expense, so the
// VAT the bill carries counts as input VAT. A reimbursement can never touch the
// VAT reserved for IRD.
// -----------------------------------------------------------------------------

function money2(raw: FormDataEntryValue | null) {
  const text = String(raw ?? "").trim();
  if (!text) return 0;
  const amount = Number(text);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : NaN;
}

/** A new bill in Avernek's name, as the assistant sends a batch of them. */
export type CompanyBillInput = {
  description: string;
  vendor_name: string | null;
  bill_number: string | null;
  bill_date: string;
  total_amount: number;
  vat_amount: number;
  paid_by: string | null;
  note: string | null;
};

/** The bill form's rules, shared by the form and the assistant's batch. */
function companyBillError(bill: { description: string; total: number; vat: number; billDate: string }): string | null {
  if (!bill.description) return "Say what the bill is for, e.g. Lawyer service charge.";
  if (!Number.isFinite(bill.total) || bill.total <= 0) return "Enter the bill total.";
  if (!Number.isFinite(bill.vat) || bill.vat < 0 || bill.vat > bill.total) {
    return "VAT must be between zero and the bill total.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bill.billDate)) return "Enter the bill date.";
  return null;
}

async function addCompanyBillUnguarded(
  _previous: FundsFormState,
  formData: FormData
): Promise<FundsFormState> {
  const session = await owner();
  const id = value(formData, "bill_id");
  const description = value(formData, "description");
  const total = money2(formData.get("total_amount"));
  const vat = money2(formData.get("vat_amount"));
  const billDate = value(formData, "bill_date");

  const invalid = companyBillError({ description, total, vat, billDate });
  if (invalid) return { error: invalid, ok: null };

  // A scan or photo of the bill is optional, and can be added to old bills too.
  let files: Awaited<ReturnType<typeof readUploads>>;
  try {
    files = await readUploads(formData, "bill_files");
    if (id) await assertRoomFor({ kind: "company_bill", id }, files.length);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not read the files.", ok: null };
  }

  const params = [
    description,
    value(formData, "vendor_name") || null,
    value(formData, "bill_number") || null,
    billDate,
    total,
    vat,
    value(formData, "paid_by") || null,
    value(formData, "note") || null,
  ];

  if (id) {
    const reimbursed = await one<{ total: string }>(
      `select coalesce(sum(from_amount), 0) as total from public.money_transfers
        where kind = 'reimbursement' and bill_id = $1`,
      [id]
    );
    if (Number(reimbursed?.total ?? 0) > total + 0.001) {
      return { error: "The bill total cannot be less than what was already reimbursed.", ok: null };
    }
    await transaction(async (client) => {
      await client.query(
        `update public.company_bills
            set description = $1, vendor_name = $2, bill_number = $3, bill_date = $4,
                total_amount = $5, vat_amount = $6, paid_by = $7, note = $8, updated_at = now()
          where id = $9`,
        [...params, id]
      );
      await insertAttachments(client, { kind: "company_bill", id }, files, session.sub);
    });
  } else {
    await transaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `insert into public.company_bills
           (description, vendor_name, bill_number, bill_date, total_amount, vat_amount, paid_by, note, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning id`,
        [...params, session.sub]
      );
      await insertAttachments(client, { kind: "company_bill", id: inserted.rows[0].id }, files, session.sub);
    });
  }

  revalidateFunds();
  return { error: null, ok: id ? "Bill updated." : "Bill added. Reimburse it when the VAT account has room." };
}

/**
 * Several new bills at once (the assistant's "add these bills"). Every bill is
 * checked with the form's rules before anything is written, then all of them
 * are saved in one transaction: either the whole list is added or none of it.
 */
async function addCompanyBillsUnguarded(bills: CompanyBillInput[]): Promise<FundsFormState> {
  const session = await owner();
  if (!Array.isArray(bills) || bills.length === 0) return { error: "There are no bills to add.", ok: null };
  if (bills.length > 20) return { error: "Add at most 20 bills at a time.", ok: null };

  const rows = bills.map((bill) => ({
    description: String(bill.description ?? "").trim(),
    vendor_name: String(bill.vendor_name ?? "").trim() || null,
    bill_number: String(bill.bill_number ?? "").trim() || null,
    bill_date: String(bill.bill_date ?? "").trim(),
    total_amount: Math.round(Number(bill.total_amount) * 100) / 100,
    vat_amount: Math.round(Number(bill.vat_amount ?? 0) * 100) / 100,
    paid_by: String(bill.paid_by ?? "").trim() || null,
    note: String(bill.note ?? "").trim() || null,
  }));
  for (const [index, row] of rows.entries()) {
    const invalid = companyBillError({
      description: row.description,
      total: row.total_amount,
      vat: row.vat_amount,
      billDate: row.bill_date,
    });
    if (invalid) return { error: `Bill ${index + 1}: ${invalid}`, ok: null };
  }

  await transaction(async (client) => {
    for (const row of rows) {
      await client.query(
        `insert into public.company_bills
           (description, vendor_name, bill_number, bill_date, total_amount, vat_amount, paid_by, note, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.description, row.vendor_name, row.bill_number, row.bill_date, row.total_amount, row.vat_amount, row.paid_by, row.note, session.sub]
      );
    }
  });

  revalidateFunds();
  return { error: null, ok: `${rows.length} ${rows.length === 1 ? "bill" : "bills"} added.` };
}

export async function addCompanyBills(bills: CompanyBillInput[]): Promise<FundsFormState> {
  return guardSave(() => addCompanyBillsUnguarded(bills));
}

export async function deleteCompanyBill(id: string) {
  await owner();
  const used = await one<{ count: string }>(
    `select count(*) from public.money_transfers where bill_id = $1`,
    [id]
  );
  if (Number(used?.count ?? 0) > 0) {
    throw new Error("Delete this bill's reimbursements first.");
  }
  await exec(`delete from public.company_bills where id = $1`, [id]);
  revalidateFunds();
}

export async function reimburseBill(
  _previous: FundsFormState,
  formData: FormData
): Promise<FundsFormState> {
  const session = await owner();
  const billId = value(formData, "bill_id");
  const fromAccountId = value(formData, "from_account_id");
  const toAccountId = value(formData, "to_account_id");
  const amount = money2(formData.get("amount"));
  const date = value(formData, "transfer_date");

  if (!billId) return { error: "Choose the bill being reimbursed.", ok: null };
  if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
    return { error: "Choose two different accounts.", ok: null };
  }
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter the amount reimbursed.", ok: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter the reimbursement date.", ok: null };

  const ledger = await loadLedger();
  const bill = ledger.billStatuses.find((item) => item.bill.id === billId);
  if (!bill) return { error: "That bill no longer exists.", ok: null };
  if (amount > bill.pending + 0.001) {
    return { error: `Only ${bill.pending.toLocaleString("en-NP")} of this bill is still unreimbursed.`, ok: null };
  }
  const from = ledger.balances.find((item) => item.account.id === fromAccountId);
  const to = ledger.balances.find((item) => item.account.id === toAccountId);
  if (!from || !to) return { error: "One of those accounts is unavailable.", ok: null };
  if (from.account.currency !== to.account.currency) {
    return { error: "Reimburse between accounts in the same currency.", ok: null };
  }
  if (amount > from.free + 0.001) {
    return {
      error: `Only ${Math.max(0, from.free).toLocaleString("en-NP")} can be used from ${from.account.name}. The rest is VAT kept aside for IRD${from.balance < amount ? " or not in the account" : ""}. Reimburse part now and the rest later.`,
      ok: null,
    };
  }

  await exec(
    `insert into public.money_transfers
       (kind, bill_id, from_account_id, to_account_id, from_amount, to_amount, transfer_date, note, created_by)
     values ('reimbursement',$1,$2,$3,$4,$4,$5,$6,$7)`,
    [billId, fromAccountId, toAccountId, amount, date,
     value(formData, "note") || `Reimbursed: ${bill.bill.description}`, session.sub]
  );

  revalidateFunds();
  return { error: null, ok: "Reimbursement recorded." };
}

export async function deleteMoneyTransfer(id: string) {
  await owner();
  await exec(`delete from public.money_transfers where id = $1`, [id]);
  revalidateFunds();
}

// -----------------------------------------------------------------------------
// VAT deposited to IRD
// -----------------------------------------------------------------------------

export async function addTaxPayment(
  _previous: FundsFormState,
  formData: FormData
): Promise<FundsFormState> {
  const session = await owner();
  const accountId = value(formData, "money_account_id");
  const amount = money2(formData.get("amount"));
  const paidOn = value(formData, "paid_on");
  if (!accountId) return { error: "Choose the account the VAT was paid from.", ok: null };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter the VAT amount paid.", ok: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { error: "Enter the date VAT was paid.", ok: null };

  const balance = (await loadLedger()).balances.find((item) => item.account.id === accountId);
  if (!balance) return { error: "That account is unavailable.", ok: null };
  if (amount > balance.balance + 0.001) {
    return { error: `Only ${balance.balance.toLocaleString("en-NP")} is in ${balance.account.name}.`, ok: null };
  }

  await exec(
    `insert into public.tax_payments (tax_type, money_account_id, amount, paid_on, period_label, reference, note, created_by)
     values ('vat',$1,$2,$3,$4,$5,$6,$7)`,
    [accountId, amount, paidOn, value(formData, "period_label") || null,
     value(formData, "reference") || null, value(formData, "note") || null, session.sub]
  );
  revalidateFunds();
  return { error: null, ok: "VAT payment recorded." };
}

export async function deleteTaxPayment(id: string) {
  await owner();
  await exec(`delete from public.tax_payments where id = $1`, [id]);
  revalidateFunds();
}

// -----------------------------------------------------------------------------
// Loans: company money lent to a person
//
// Lending moves money out of an account; paying it back moves it in again.
// Neither is an expense or income, so nothing here touches revenue, spending,
// VAT or profit — only the balance of the accounts involved.
// -----------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Lend money, or correct an existing loan when `loan_id` is posted. */
async function saveMoneyLoanUnguarded(
  _previous: FundsFormState,
  formData: FormData
): Promise<FundsFormState> {
  const session = await owner();
  const id = value(formData, "loan_id");
  const accountId = value(formData, "money_account_id");
  const borrower = value(formData, "borrower_name");
  const amount = money2(formData.get("amount"));
  const lentOn = value(formData, "lent_on");
  const note = value(formData, "note") || null;

  if (!borrower) return { error: "Who took the money?", ok: null };
  if (!accountId) return { error: "Choose the account the money came out of.", ok: null };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter how much was lent.", ok: null };
  if (!DATE_RE.test(lentOn)) return { error: "Enter the date the money was taken.", ok: null };

  const existing = id
    ? await one<{ money_account_id: string; amount: string; repaid_on: string | null }>(
        `select money_account_id, amount, repaid_on from public.money_loans where id = $1`,
        [id]
      )
    : null;
  if (id && !existing) return { error: "That loan no longer exists.", ok: null };
  if (existing?.repaid_on && lentOn > existing.repaid_on) {
    return { error: "The loan cannot start after the day it was paid back.", ok: null };
  }

  // Only money that is really free can be lent: VAT kept aside for IRD stays put.
  const balance = (await loadLedger()).balances.find((item) => item.account.id === accountId);
  if (!balance) return { error: "That account is unavailable.", ok: null };
  const alreadyOut =
    existing && !existing.repaid_on && existing.money_account_id === accountId
      ? Number(existing.amount)
      : 0;
  const available = balance.free + alreadyOut;
  if (amount > available + 0.001) {
    return {
      error: `Only ${Math.max(0, available).toLocaleString("en-NP")} can be lent from ${balance.account.name}${
        balance.vatReserved > 0 ? " — the rest is VAT kept aside for IRD" : ""
      }.`,
      ok: null,
    };
  }

  if (id) {
    await exec(
      `update public.money_loans
          set money_account_id = $1, borrower_name = $2, amount = $3, lent_on = $4, note = $5,
              updated_by = $6, updated_at = now()
        where id = $7`,
      [accountId, borrower, amount, lentOn, note, session.sub, id]
    );
  } else {
    await exec(
      `insert into public.money_loans (money_account_id, borrower_name, amount, lent_on, note, created_by)
       values ($1,$2,$3,$4,$5,$6)`,
      [accountId, borrower, amount, lentOn, note, session.sub]
    );
  }

  revalidateFunds();
  return {
    error: null,
    ok: id ? "Loan updated." : `Lent ${amount.toLocaleString("en-NP")} to ${borrower}. Mark it paid back when the money returns.`,
  };
}

/** The money came back: it returns to the chosen account (usually the same one). */
async function markLoanRepaidUnguarded(
  _previous: FundsFormState,
  formData: FormData
): Promise<FundsFormState> {
  const session = await owner();
  const id = value(formData, "loan_id");
  const repaidOn = value(formData, "repaid_on");
  const toAccountId = value(formData, "repaid_to_account_id");
  if (!id) return { error: "That loan no longer exists.", ok: null };
  if (!DATE_RE.test(repaidOn)) return { error: "Enter the date it was paid back.", ok: null };

  const loan = await one<{ lent_on: string; borrower_name: string; currency: string }>(
    `select l.lent_on, l.borrower_name, a.currency
       from public.money_loans l
       join public.money_accounts a on a.id = l.money_account_id
      where l.id = $1`,
    [id]
  );
  if (!loan) return { error: "That loan no longer exists.", ok: null };
  if (repaidOn < loan.lent_on) return { error: "It cannot be paid back before it was lent.", ok: null };

  const target = await one<{ currency: string; is_active: boolean }>(
    `select currency, is_active from public.money_accounts where id = $1`,
    [toAccountId]
  );
  if (!target?.is_active) return { error: "Choose the account the money came back into.", ok: null };
  if (target.currency !== loan.currency) {
    return { error: `Choose a ${loan.currency} account — the loan was in ${loan.currency}.`, ok: null };
  }

  await exec(
    `update public.money_loans
        set repaid_on = $1, repaid_to_account_id = $2, updated_by = $3, updated_at = now()
      where id = $4`,
    [repaidOn, toAccountId, session.sub, id]
  );
  revalidateFunds();
  return { error: null, ok: `${loan.borrower_name}'s loan marked as paid back.` };
}

/** Undo a "paid back" recorded by mistake. The loan is outstanding again. */
export async function undoLoanRepaid(id: string) {
  const session = await owner();
  await exec(
    `update public.money_loans
        set repaid_on = null, repaid_to_account_id = null, updated_by = $1, updated_at = now()
      where id = $2`,
    [session.sub, id]
  );
  revalidateFunds();
}

export async function deleteMoneyLoan(id: string) {
  await owner();
  await exec(`delete from public.money_loans where id = $1`, [id]);
  revalidateFunds();
}

/**
 * A save that fails on the server (database down, constraint, anything
 * unexpected) must come back as a message in the form — never as a blank
 * "Application error" screen. Everything runs in a transaction, so a failed
 * save leaves nothing half-written. Next.js redirects still pass through.
 */
async function guardSave(run: () => Promise<FundsFormState>): Promise<FundsFormState> {
  try {
    return await run();
  } catch (error) {
    const digest = (error as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_")) throw error;
    console.error("[save failed]", error);
    return {
      error: `Could not save: ${error instanceof Error ? error.message : "unexpected error"}. Nothing was saved — try again.`,
      ok: null,
    };
  }
}

export async function addCompanyBill(previous: FundsFormState, formData: FormData): Promise<FundsFormState> {
  return guardSave(() => addCompanyBillUnguarded(previous, formData));
}

export async function saveMoneyLoan(previous: FundsFormState, formData: FormData): Promise<FundsFormState> {
  return guardSave(() => saveMoneyLoanUnguarded(previous, formData));
}

export async function markLoanRepaid(previous: FundsFormState, formData: FormData): Promise<FundsFormState> {
  return guardSave(() => markLoanRepaidUnguarded(previous, formData));
}
