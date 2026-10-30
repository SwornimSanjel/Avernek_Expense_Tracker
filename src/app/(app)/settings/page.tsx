import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { Avatar, PageHeader } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import type { Category, TeamMember } from "@/lib/types";
import { addCategory, updateMyName } from "./actions";
import TeamToggle, { PartnerToggle } from "@/components/TeamToggle";
import AddMemberForm from "@/components/AddMemberForm";
import SetPasswordForm from "@/components/SetPasswordForm";
import ThemeToggle from "@/components/ThemeToggle";
import { isAppOwner } from "@/lib/authz";
import Icon, { type IconName } from "@/components/Icons";
import { displayName, personTone } from "@/lib/people";
import AiUsagePanel from "@/components/assistant/AiUsagePanel";
import MemberAccess from "@/components/MemberAccess";
import { describeAccess, hasEverything, resolveAccess } from "@/lib/access";
import { isAiEnabled } from "@/lib/ai/config";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  const [categories, users, usage] = await Promise.all([
    query<Category>(`select * from public.categories order by name`),
    // Never select password_hash: these rows are handed to client components.
    query<TeamMember & { removed: boolean; access: unknown }>(
      `select id, name, email, is_core_member, is_admin, is_partner,
              (password_hash is not null) as can_sign_in,
              (removed_at is not null) as removed, access
         from public.users
        order by (removed_at is not null), is_partner desc, name`
    ),
    query<{ category_id: string; count: string; total: string }>(
      `select category_id, count(*) as count, coalesce(sum(amount_npr), 0) as total
         from public.expenses where category_id is not null group by category_id`
    ),
  ]);
  const me = users.find((u) => u.id === session.sub);
  const canManage = isAppOwner(session);
  // The team list and category totals show everyone's money, so people with
  // limited access see only their own profile here.
  const seesTeam = hasEverything(session.access);
  const usageById = new Map(usage.map((row) => [row.category_id, row]));
  const current = users.filter((u) => !u.removed);
  const removedCount = users.length - current.length;
  const partners = current.filter((u) => u.is_partner);
  const others = current.filter((u) => !u.is_partner);

  return (
    <>
      <PageHeader title="Settings" subtitle="Your profile, the team, sign-in access and spending categories." />

      <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
        {/* profile */}
        <div className="card overflow-hidden rise flex flex-col">
          <Head icon="user" title="Your profile" text="How you appear across the workspace" />
          <div className="p-5 space-y-5">
            <div className="flex items-center gap-4">
              <Avatar name={me?.name ?? "Admin"} size={52} round />
              <div className="min-w-0">
                <div className="text-[17px] font-semibold">{displayName(me?.name)}</div>
                <div className="text-[13.5px] muted truncate">{me?.email}</div>
                <span className="pill accent mt-1.5">{me?.is_admin ? "Administrator" : "View only"}</span>
              </div>
            </div>
            {canManage ? (
              <form action={updateMyName} className="space-y-2">
                <label className="field-label" htmlFor="profile-name">Display name</label>
                <div className="flex gap-2">
                  <input id="profile-name" name="name" defaultValue={me?.name ?? ""} placeholder="e.g. Swornim Sanjel" className="input flex-1" />
                  <button className="btn btn-primary">Save</button>
                </div>
              </form>
            ) : null}
            <div className="card-soft p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-[14px] font-semibold">Appearance</div>
                <div className="text-[13px] muted">Dark or light. Collapse the sidebar with ⌘B.</div>
              </div>
              <ThemeToggle />
            </div>
          </div>
        </div>

        {canManage && (
          <>
          <div className="card overflow-hidden rise rise-2">
            <Head icon="plus" title="Add a person" text="A partner, or a sign-in account" tone="var(--green)" />
            <div className="p-5"><AddMemberForm /></div>
          </div>
          <div className="card overflow-hidden rise rise-2">
            <Head icon="shield" title="Sign-in access" text="Set or replace someone's password" tone="var(--amber)" />
            <div className="p-5">
              <SetPasswordForm members={current.map((u) => ({ id: u.id, name: u.name, email: u.email, can_sign_in: u.can_sign_in }))} />
            </div>
          </div>
          </>
        )}
      </div>

      {seesTeam && (
      <>
      <div className="mt-4">
        <div className="card overflow-hidden rise rise-1">
          <Head
            icon="users"
            title="Team"
            text={`${partners.length} partners · ${others.length} sign-in account${others.length === 1 ? "" : "s"}${removedCount ? ` · ${removedCount} removed` : ""}`}
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Sign-in</th>
                  <th title="Partners appear in investment totals, rankings and payer / split lists">Partner</th>
                  <th title="Only used for old expenses saved without an exact split">Old default split</th>
                  <th>Can view</th>
                  {canManage && <th className="w-[1%]" />}
                </tr>
              </thead>
              <tbody>
                {users.map((u, index) => (
                  <tr key={u.id} className={u.removed ? "opacity-60" : u.is_partner ? "" : "opacity-80"}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} size={34} round color={u.is_partner ? personTone(index) : "var(--muted)"} />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{displayName(u.name)}</div>
                          <div className="text-[12.5px] muted truncate max-w-[240px]">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {u.removed ? (
                        <span className="pill danger">Removed</span>
                      ) : u.is_admin ? (
                        <span className="pill accent">Admin</span>
                      ) : u.can_sign_in ? (
                        <span className="pill info">Can sign in</span>
                      ) : (
                        <span className="pill">No login</span>
                      )}
                    </td>
                    <td>{canManage ? <PartnerToggle id={u.id} isPartner={u.is_partner} /> : <span className="pill">{u.is_partner ? "Partner" : "—"}</span>}</td>
                    <td>{canManage ? <TeamToggle id={u.id} isCore={u.is_core_member} /> : <span className="pill">{u.is_core_member ? "Included" : "—"}</span>}</td>
                    <td className="text-[13px] max-w-[260px]">
                      <span className={u.removed ? "muted" : ""}>{u.removed ? "Nothing · removed" : describeAccess(resolveAccess(u))}</span>
                    </td>
                    {canManage && (
                      <td>
                        <MemberAccess
                          id={u.id}
                          name={displayName(u.name)}
                          isAdmin={u.is_admin}
                          isSelf={u.id === session.sub}
                          removed={u.removed}
                          access={resolveAccess(u)}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-[13px] muted border-t">
            Only partners are shown in investment totals, rankings and payer lists. Turning a partner off hides them — every amount they paid or were split into stays exactly as it is.
            Removing someone only ends their sign-in: their payments, splits and investments keep counting.
          </p>
        </div>
      </div>

      {/* categories */}
      <div className="card overflow-hidden mt-4 rise rise-3">
        <Head icon="tag" title="Categories & budgets" text={`${categories.length} categories · used to group spending everywhere`} />
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-px bg-[var(--line)]">
          {categories.map((c) => {
            const used = usageById.get(c.id);
            return (
              <div key={c.id} className="flex items-center gap-3 px-5 py-3.5 bg-[var(--surface)]">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color && c.color !== "#1e3a5f" ? c.color : "var(--accent)" }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium truncate">{c.name}</div>
                  <div className="text-[12.5px] muted">{used ? `${used.count} expense${used.count === "1" ? "" : "s"} · NPR ${formatNumber(Number(used.total))}` : "Not used yet"}</div>
                </div>
                <span className="text-[13px] muted tnum whitespace-nowrap">
                  {c.monthly_budget != null ? `${formatNumber(Number(c.monthly_budget))}/mo` : "No budget"}
                </span>
              </div>
            );
          })}
        </div>
        {canManage && (
          <form action={addCategory} className="flex flex-wrap gap-2 p-4 border-t bg-[var(--surface-2)]">
            <input name="name" required placeholder="New category name" className="input flex-1 min-w-[200px]" />
            <input name="monthly_budget" type="number" min="0" step="0.01" placeholder="Monthly budget (optional)" className="input tnum !w-[220px]" />
            <button className="btn btn-primary"><Icon name="plus" size={15} /> Add category</button>
          </form>
        )}
      </div>

      </>
      )}

      {/* AI assistant usage: administrators, when the assistant is configured */}
      {canManage && isAiEnabled() && (
        <div className="mt-4">
          <AiUsagePanel />
        </div>
      )}
    </>
  );
}

function Head({ icon, title, text, tone = "var(--accent-ink)" }: { icon: IconName; title: string; text: string; tone?: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b">
      <div className="row-icon !w-9 !h-9" style={{ "--tone": tone, "--tone-soft": `color-mix(in srgb, ${tone} 14%, transparent)` } as React.CSSProperties}>
        <Icon name={icon} size={17} />
      </div>
      <div>
        <h2 className="text-[15.5px] font-semibold">{title}</h2>
        <p className="text-[13px] muted">{text}</p>
      </div>
    </div>
  );
}
