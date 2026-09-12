"use server";

import { revalidatePath } from "next/cache";
import { exec, one } from "@/lib/db";
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

  const balanceRow = await one<{ balance: number | string }>(
    `select
       coalesce((select sum(p.amount) from public.income_payments p where p.money_account_id = $1), 0)
       + coalesce((select sum(t.to_amount) from public.money_transfers t where t.to_account_id = $1), 0)
       - coalesce((
           select sum(
             case
               when e.currency = a.currency then e.amount
               when a.currency = 'NPR' then e.amount_npr
               else 0
             end
           )
           from public.expenses e
           join public.money_accounts a on a.id = $1
           where e.money_account_id = $1 and e.funding_source = 'company_funds'
         ), 0)
       - coalesce((select sum(t.from_amount) from public.money_transfers t where t.from_account_id = $1), 0)
       as balance`,
    [fromAccountId]
  );
  if (fromAmount > Number(balanceRow?.balance ?? 0) + 0.001) {
    return { error: `Only ${Number(balanceRow?.balance ?? 0).toLocaleString("en-NP")} is available in ${fromAccount.name}.`, ok: null };
  }

  await exec(
    `insert into public.money_transfers
       (from_account_id, to_account_id, from_amount, to_amount, transfer_date, note, created_by)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [fromAccountId, toAccountId, fromAmount, toAmount, transferDate, note, session.sub]
  );

  revalidatePath("/funds");
  revalidatePath("/");
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
