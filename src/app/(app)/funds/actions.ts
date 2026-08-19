"use server";

import { revalidatePath } from "next/cache";
import { exec, one } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { assertAppOwner } from "@/lib/authz";
import type { Currency, MoneyAccountKind } from "@/lib/types";

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
