import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { EmptyState, Kpi, Money, PageHeader } from "@/components/ui";
import AddRecurring from "@/components/AddRecurring";
import RecurringRow from "@/components/RecurringRow";
import BulkSelect, { SelectBox, SelectToggle } from "@/components/BulkSelect";
import { deleteRecurrings } from "./actions";
import { formatNumber, npr, usd } from "@/lib/format";
import type { AppUser, Category, Recurring, Vendor } from "@/lib/types";
import { isAppOwner } from "@/lib/authz";
import Icon from "@/components/Icons";
import { USER_COLUMNS, displayName } from "@/lib/people";
import { daysUntilDate } from "@/lib/income";
import { nepalToday, shortDate } from "@/lib/dates";
import { getCachedUsdSellRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const session = await requireSession();
  const canManage = isAppOwner(session);
  const today = nepalToday();

  const [recs, shareRows, categories, vendors, users, rate] = await Promise.all([
    query<Recurring>(`select * from public.recurring order by is_active desc, next_renewal_date`),
    query<{ recurring_id: string }>(`select * from public.recurring_shares`),
    query<Category>(`select * from public.categories order by name`),
    query<Vendor>(`select * from public.vendors order by name`),
    query<AppUser>(`select ${USER_COLUMNS} from public.users order by name`),
    getCachedUsdSellRate(),
  ]);

  const recurring = recs.map((item) => ({
    ...item,
    recurring_shares: shareRows.filter((share) => share.recurring_id === item.id),
  })) as Recurring[];

  const vName = (id: string | null) => vendors.find((v) => v.id === id)?.name ?? "";
  const uName = (id: string | null) => displayName(users.find((u) => u.id === id)?.name).split(" ")[0] ?? "—";
  const toNpr = (item: Recurring) => (item.currency === "USD" ? Number(item.amount) * (rate?.rate ?? 0) : Number(item.amount));
  const active = recurring.filter((item) => item.is_active);
  const monthlyCost = active.reduce((sum, item) => sum + (item.cycle === "annual" ? toNpr(item) / 12 : toNpr(item)), 0);
  const dueSoon = active.filter((item) => {
    const days = daysUntilDate(item.next_renewal_date, today);
    return days >= 0 && days <= 7;
  });
  const late = active.filter((item) => daysUntilDate(item.next_renewal_date, today) < 0);

  return (
    <>
      <PageHeader
        title="Subscriptions"
        subtitle="Software and services that renew — what they cost and when they are due."
        action={canManage ? <AddRecurring categories={categories} vendors={vendors} users={users} meId={session.sub} /> : undefined}
      />

      <div className="kpi-grid mb-6">
        <Kpi label="Active plans" icon="subscription" value={<span className="tnum">{active.length}</span>} foot={`${recurring.length - active.length} paused`} />
        <Kpi label="Cost per month" icon="wallet" tone="blue" value={<Money value={Math.round(monthlyCost)} />} foot={rate ? `USD at NRB ${rate.rate.toFixed(2)} · annual ÷ 12` : "Annual plans ÷ 12"} />
        <Kpi label="Due in 7 days" icon="clock" tone={dueSoon.length ? "amber" : "green"} value={<span className="tnum">{dueSoon.length}</span>} foot={dueSoon[0] ? `${dueSoon[0].name} · ${shortDate(dueSoon[0].next_renewal_date)}` : "Nothing renewing this week"} />
        <Kpi label="Past renewal date" icon="alert" tone={late.length ? "red" : "muted"} value={<span className="tnum">{late.length}</span>} foot={late.length ? "Mark them paid or update the date" : "All up to date"} />
      </div>

      <BulkSelect
        ids={recurring.map((r) => r.id)}
        noun={{ one: "subscription", many: "subscriptions" }}
        onDelete={canManage ? deleteRecurrings : undefined}
      >
        {recurring.length > 1 && (
          <div className="flex justify-end mb-2">
            <SelectToggle />
          </div>
        )}
        <div className="card overflow-hidden">
          {recurring.length === 0 && (
            <EmptyState title="No subscriptions yet" description="Add recurring software or service costs to see renewal timing here." icon="subscription" />
          )}
          <div className="row-list">
            {recurring.map((r) => {
              const days = daysUntilDate(r.next_renewal_date, today);
              const soon = r.is_active && days >= 0 && days <= 7;
              const overdue = r.is_active && days < 0;
              return (
                <div key={r.id} className={`row-item flex-wrap ${r.is_active ? "" : "opacity-55"}`}>
                  <SelectBox id={r.id} label={r.name} />
                  <div className="row-icon" style={{ "--tone": overdue ? "var(--red)" : soon ? "var(--amber)" : "var(--accent-ink)", "--tone-soft": overdue ? "var(--red-soft)" : soon ? "var(--amber-soft)" : "var(--accent-soft)" } as React.CSSProperties}>
                    <Icon name="subscription" size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="row-title">{r.name}</span>
                      {vName(r.vendor_id) && <span className="text-[13px] muted">{vName(r.vendor_id)}</span>}
                      {!r.is_active && <span className="pill">Paused</span>}
                      {overdue && <span className="pill danger">{-days} day{days === -1 ? "" : "s"} past</span>}
                      {soon && <span className="pill warn">{days === 0 ? "Renews today" : `In ${days} day${days === 1 ? "" : "s"}`}</span>}
                    </div>
                    <div className="row-meta">
                      {r.cycle === "annual" ? "Yearly" : "Monthly"} · renews {shortDate(r.next_renewal_date)} · paid by {uName(r.paid_by_user_id)}
                      {r.recurring_shares?.length
                        ? ` · split ${r.recurring_shares.map((share) => `${uName(share.user_id)} ${r.currency === "USD" ? usd(Number(share.amount)) : formatNumber(Number(share.amount))}`).join(", ")}`
                        : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="row-amount">{r.currency === "USD" ? usd(r.amount) : npr(r.amount)}</div>
                    <div className="row-sub">
                      /{r.cycle === "annual" ? "year" : "month"}
                      {r.currency === "USD" && rate ? ` · ≈ NPR ${formatNumber(Math.round(toNpr(r)))}` : ""}
                    </div>
                  </div>
                  {canManage && (
                    <RecurringRow
                      id={r.id}
                      isActive={r.is_active}
                      amount={Number(r.amount)}
                      currency={r.currency}
                      cycle={r.cycle}
                      nextRenewalDate={r.next_renewal_date}
                      paidByUserId={r.paid_by_user_id}
                      users={users}
                      shares={(r.recurring_shares ?? []).map((share) => ({ userId: share.user_id, amount: Number(share.amount) }))}
                      recurring={r}
                      categories={categories}
                      vendors={vendors}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </BulkSelect>
      <p className="text-[13px] muted mt-3">
        “Mark paid” records a real expense dated the day you pay (today by default) and moves the renewal forward one cycle.
      </p>
    </>
  );
}
