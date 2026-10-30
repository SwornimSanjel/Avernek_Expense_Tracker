import { query } from "@/lib/db";
import { requireSection } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { Avatar, EmptyState, PageHeader } from "@/components/ui";
import { LendMoney, MarkLoanRepaid, UndoLoanRepaid } from "@/components/LoanActions";
import { ConfirmDelete } from "@/components/VatBillsActions";
import Icon from "@/components/Icons";
import { accountShortName } from "@/lib/funds";
import { loadLedger } from "@/lib/ledger";
import { formatServiceDate, todayIso } from "@/lib/income";
import { formatNumber } from "@/lib/format";
import { USER_COLUMNS, partnersOf } from "@/lib/people";
import { daysUntil } from "@/lib/tax-calendar";
import { deleteMoneyLoan } from "../funds/actions";

export const dynamic = "force-dynamic";

/**
 * Company money lent to people: who has it, from which account, since when,
 * and what came back. A loan leaves the account the day it is lent (so balances
 * show what is really there) and returns when it is marked paid back.
 */
export default async function LoansPage() {
  const session = await requireSection("loans");
  const canManage = isAppOwner(session);
  const [ledger, people] = await Promise.all([
    loadLedger(),
    query<{ id: string; name: string; is_partner: boolean }>(`select ${USER_COLUMNS} from public.users order by name`),
  ]);
  const { accounts, balances, loans } = ledger;
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const partnerNames = partnersOf(people).map((person) => person.name);
  const today = todayIso();

  const open = loans.filter((loan) => !loan.repaid_on).sort((a, b) => a.lent_on.localeCompare(b.lent_on));
  const repaid = loans.filter((loan) => loan.repaid_on).sort((a, b) => b.repaid_on!.localeCompare(a.repaid_on!));
  const sum = (list: typeof loans) => list.reduce((total, loan) => total + Number(loan.amount), 0);
  const owedBy = [...open.reduce((map, loan) => map.set(loan.borrower_name, (map.get(loan.borrower_name) ?? 0) + Number(loan.amount)), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1]);
  const accountName = (id: string | null) => accountShortName(accountById.get(id ?? ""));

  return (
    <>
      <PageHeader
        title="Loans"
        subtitle="Company money lent to people, and what has come back."
        action={canManage ? <LendMoney balances={balances} people={partnerNames} /> : undefined}
      />

      <div className="loan-figures rise">
        <LoanFigure
          icon="arrowUpRight"
          tone="blue"
          label="Still owed to Avernek"
          value={sum(open)}
          sub={open.length ? `${open.length} loan${open.length === 1 ? "" : "s"} not paid back yet` : "Nothing out right now"}
        />
        <LoanFigure icon="arrowDownLeft" tone="green" label="Paid back" value={sum(repaid)} sub={`${repaid.length} loan${repaid.length === 1 ? "" : "s"} returned`} />
        <LoanFigure icon="wallet" tone="accent" label="Lent in total" value={sum(loans)} sub="Every loan since the start" />
      </div>

      {owedBy.length > 1 && (
        <div className="flex flex-wrap gap-2 mt-4">
          {owedBy.map(([name, amount]) => (
            <span key={name} className="loan-person">
              <Avatar name={name} size={24} round />
              {name} owes <strong className="tnum">NPR {formatNumber(amount)}</strong>
            </span>
          ))}
        </div>
      )}

      <section className="section">
        <div className="card overflow-hidden">
          <div className="card-head">
            <div>
              <h3>Not paid back yet</h3>
              <p>Already taken out of the account it came from. Press “Paid back” when the money returns.</p>
            </div>
          </div>
          {open.length === 0 ? (
            <EmptyState title="No open loans" description="When company money is lent to someone, record it with “Lend money”." icon="arrowUpRight" />
          ) : (
            <div className="row-list">
              {open.map((loan) => {
                const days = -daysUntil(loan.lent_on, today);
                return (
                  <div key={loan.id} className="row-item flex-wrap">
                    <Avatar name={loan.borrower_name} size={38} round />
                    <div className="min-w-0 flex-1">
                      <div className="row-title">{loan.borrower_name}</div>
                      <div className="row-meta !whitespace-normal">
                        Taken {formatServiceDate(loan.lent_on)} ({days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}) · from {accountName(loan.money_account_id)}
                        {loan.note ? ` · ${loan.note}` : ""}
                      </div>
                    </div>
                    <div className="row-amount text-blue">{formatNumber(Number(loan.amount))}</div>
                    {canManage && (
                      <div className="flex items-center gap-1.5">
                        <MarkLoanRepaid loan={loan} accounts={accounts} />
                        <LendMoney balances={balances} people={partnerNames} loan={loan} />
                        <ConfirmDelete
                          id={loan.id}
                          action={deleteMoneyLoan}
                          message={`Delete this loan record? Only if it was entered by mistake: NPR ${formatNumber(Number(loan.amount))} goes back into ${accountName(loan.money_account_id)} in the books.`}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="card overflow-hidden">
          <div className="card-head">
            <div>
              <h3>Paid back</h3>
              <p>Loans that came back, newest first.</p>
            </div>
          </div>
          {repaid.length === 0 ? (
            <EmptyState title="Nothing paid back yet" description="Loans marked “Paid back” move here." icon="arrowDownLeft" />
          ) : (
            <div className="row-list">
              {repaid.map((loan) => (
                <div key={loan.id} className="row-item flex-wrap">
                  <Avatar name={loan.borrower_name} size={38} round />
                  <div className="min-w-0 flex-1">
                    <div className="row-title">{loan.borrower_name}</div>
                    <div className="row-meta !whitespace-normal">
                      Taken {formatServiceDate(loan.lent_on)} from {accountName(loan.money_account_id)} → back {formatServiceDate(loan.repaid_on!)} into {accountName(loan.repaid_to_account_id)}
                      {loan.note ? ` · ${loan.note}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="row-amount">{formatNumber(Number(loan.amount))}</div>
                    <span className="pill ok">Paid back</span>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1.5">
                      <UndoLoanRepaid id={loan.id} />
                      <ConfirmDelete
                        id={loan.id}
                        action={deleteMoneyLoan}
                        message="Delete this loan record? It was paid back, so balances stay the same; only the history goes."
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="loan-explain">
        <Icon name="info" size={17} />
        <p>
          <strong>How loans count.</strong> The money leaves the account the day it is lent, so account balances always show what is really there;
          Company money shows it as “Lent out”. A loan is not an expense and not income. When it comes back, press “Paid back” and choose the account
          it came into.
        </p>
      </div>
    </>
  );
}

function LoanFigure({
  icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: "arrowUpRight" | "arrowDownLeft" | "wallet";
  tone: string;
  label: string;
  value: number;
  sub: string;
}) {
  return (
    <div className={`loan-figure tone-${tone}`}>
      <span className="loan-figure-icon">
        <Icon name={icon} size={17} />
      </span>
      <div className="loan-figure-label">{label}</div>
      <div className="loan-figure-value">
        <small>NPR</small> {formatNumber(value)}
      </div>
      <div className="loan-figure-sub">{sub}</div>
    </div>
  );
}
