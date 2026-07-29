import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui";
import AddRecurring from "@/components/AddRecurring";
import RecurringRow from "@/components/RecurringRow";
import { npr, usd } from "@/lib/format";
import type { AppUser, Category, Recurring, Vendor } from "@/lib/types";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { isAppOwner } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const session = await requireSession();
  const canManage = isAppOwner(session);

  // A failed share query used to surface as `error`; a throw here is caught by
  // the route's error boundary instead, so the page never renders subscriptions
  // with silently missing splits.
  const shareError = null;

  const [recs, shareRows, cats, vends, team] = await Promise.all([
    query<Recurring>(`select * from public.recurring order by next_renewal_date`),
    query<{ recurring_id: string }>(`select * from public.recurring_shares`),
    query<Category>(`select * from public.categories order by name`),
    query<Vendor>(`select * from public.vendors order by name`),
    query<AppUser>(`select * from public.users order by name`),
  ]);

  const recurring = recs.map((recurring) => ({
    ...recurring,
    recurring_shares: shareRows.filter(
      (share) => share.recurring_id === recurring.id
    ),
  })) as Recurring[];
  const categories = cats as Category[];
  const vendors = vends as Vendor[];
  const users = (team ?? []) as AppUser[];

  const vName = (id: string | null) => vendors.find((v) => v.id === id)?.name ?? "";
  const uName = (id: string | null) =>
    users.find((u) => u.id === id)?.name.split(" ")[0] ?? "—";

  return (
    <>
      <PageHeader
        title="Subscriptions"
        subtitle="Recurring costs that renew on their own."
        action={
          <AddRecurring
            categories={categories}
            vendors={vendors}
            users={users}
            meId={session.sub}
          />
        }
      />

      {shareError && (
        <div
          className="rounded-xl px-4 py-3 mb-4 text-sm"
          style={{ border: "1px solid var(--amber)", color: "var(--amber)" }}
        >
          Subscriptions are visible, but person splits need the Supabase migration
          <span className="font-medium"> 20260712_add_monthly_shares.sql</span>.
        </div>
      )}

      <div className="card divide-y" style={{ borderColor: "var(--line)" }}>
        {recurring.length === 0 && (
          <div className="p-8 text-center muted">No subscriptions yet.</div>
        )}
        {recurring.map((r) => {
          const days = differenceInCalendarDays(
            parseISO(r.next_renewal_date),
            new Date()
          );
          const soon = days >= 0 && days <= 7 && r.is_active;
          return (
            <div
              key={r.id}
              className={`p-4 flex flex-wrap items-center gap-3 ${
                r.is_active ? "" : "opacity-50"
              }`}
              style={{ borderColor: "var(--line)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {r.name}
                  {vName(r.vendor_id) && (
                    <span className="muted font-normal"> · {vName(r.vendor_id)}</span>
                  )}
                </div>
                <div className="text-xs muted mt-0.5">
                  {r.cycle} · renews {r.next_renewal_date} · {uName(r.paid_by_user_id)}
                  {soon && (
                    <span className="ml-2 font-medium" style={{ color: "var(--amber)" }}>
                      {days === 0 ? "renews today" : `renews in ${days}d`}
                    </span>
                  )}
                </div>
                {!!r.recurring_shares?.length && (
                  <div className="text-xs muted mt-1">
                    Split: {r.recurring_shares
                      .map(
                        (share) =>
                          `${uName(share.user_id)} ${r.currency === "USD" ? usd(share.amount) : npr(share.amount)}`
                      )
                      .join(" · ")}
                  </div>
                )}
              </div>
              <div className="tnum text-right">
                <div className="font-semibold">
                  {r.currency === "USD" ? usd(r.amount) : npr(r.amount)}
                </div>
                <div className="text-xs muted">/{r.cycle}</div>
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
                  shares={(r.recurring_shares ?? []).map((share) => ({
                    userId: share.user_id,
                    amount: Number(share.amount),
                  }))}
                  recurring={r}
                  categories={categories}
                  vendors={vendors}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs muted mt-3">
        "Mark paid" logs a real expense on the renewal date (freezing the NPR rate) and
        rolls the renewal forward one cycle.
      </p>
    </>
  );
}
