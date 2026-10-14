import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui";
import { npr } from "@/lib/format";
import type { Category, TeamMember } from "@/lib/types";
import { addCategory, updateMyName } from "./actions";
import TeamToggle from "@/components/TeamToggle";
import AddMemberForm from "@/components/AddMemberForm";
import SetPasswordForm from "@/components/SetPasswordForm";
import { isAppOwner } from "@/lib/authz";
import Icon from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  const [cats, team] = await Promise.all([
    query<Category>(`select * from public.categories order by name`),
    // Never select password_hash: these rows are handed to client components.
    query<TeamMember>(
      `select id, name, email, is_core_member, is_admin,
              (password_hash is not null) as can_sign_in
         from public.users
        order by name`
    ),
  ]);
  const categories = cats as Category[];
  const users = team as TeamMember[];
  const me = users.find((u) => u.id === session.sub);
  const canManage = isAppOwner(session);

  return (
    <>
      <PageHeader eyebrow="Workspace control" title="Settings" subtitle="Manage your profile, access, participants, and financial categories." />

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Your profile */}
        <div className="card p-5 md:p-6">
          <div className="flex items-center gap-3 mb-4"><div className="stat-icon" style={{ color: "#b8a0fb" }}><Icon name="user" size={16} /></div><div><h2 className="section-title">Your profile</h2><p className="section-kicker mt-0.5">Identity used across the workspace</p></div></div>
          <p className="text-xs muted mb-3">
            Shown everywhere instead of your email.
          </p>
          {canManage ? (
            <form action={updateMyName} className="flex gap-2">
              <input
                name="name"
                defaultValue={me?.name ?? ""}
                placeholder="e.g. Swornim Sanjel"
                className="input flex-1"
              />
              <button className="btn btn-primary">Save</button>
            </form>
          ) : (
            <div className="input flex items-center">{me?.name ?? "Team member"}</div>
          )}
          <p className="text-xs muted mt-2">Signed in as {me?.email}</p>
        </div>

        {/* Team */}
        <div className="card p-5 md:p-6">
          <div className="flex items-center gap-3 mb-4"><div className="stat-icon" style={{ color: "var(--blue)" }}><Icon name="users" size={16} /></div><div><h2 className="section-title">Team</h2><p className="section-kicker mt-0.5">Participants and allocation defaults</p></div></div>
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="list-row flex items-center gap-3 p-2 -mx-2 rounded-xl">
                <div className="avatar !w-9 !h-9">{u.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {u.name}
                    {u.is_admin && <span className="pill ml-2">Admin</span>}
                  </div>
                  <div className="text-xs muted truncate">
                    {u.can_sign_in ? u.email : `${u.email} · no login`}
                  </div>
                </div>
                {canManage ? (
                  <TeamToggle id={u.id} isCore={u.is_core_member} />
                ) : (
                  <span className="pill">
                    {u.is_core_member ? "Default split" : "Manual only"}
                  </span>
                )}
              </div>
            ))}
            {users.length === 0 && (
              <p className="text-sm muted">No participants yet.</p>
            )}
          </div>
          <p className="text-xs muted mt-3">
            “Default split” is used only for older expenses without exact shares;
            named splits always override it.
          </p>
        </div>

        {canManage && (
          <>
            <div className="card p-5 md:p-6">
              <div className="flex items-center gap-3 mb-4"><div className="stat-icon" style={{ color: "var(--green)" }}><Icon name="plus" size={16} /></div><div><h2 className="section-title">Add member</h2><p className="section-kicker mt-0.5">Create a participant or login account</p></div></div>
              <AddMemberForm />
            </div>

            <div className="card p-5 md:p-6">
              <div className="flex items-center gap-3 mb-4"><div className="stat-icon" style={{ color: "var(--amber)" }}><Icon name="settings" size={16} /></div><div><h2 className="section-title">Login access</h2><p className="section-kicker mt-0.5">Set or replace a member password</p></div></div>
              <SetPasswordForm
                members={users.map((u) => ({
                  id: u.id,
                  name: u.name,
                  email: u.email,
                  can_sign_in: u.can_sign_in,
                }))}
              />
            </div>
          </>
        )}

        {/* Categories */}
        <div className="card p-5 md:p-6 lg:col-span-2">
          <div className="flex items-center gap-3 mb-4"><div className="stat-icon" style={{ color: "#b8a0fb" }}><Icon name="wallet" size={16} /></div><div><h2 className="section-title">Categories &amp; budgets</h2><p className="section-kicker mt-0.5">Structure reporting and optional monthly limits</p></div></div>
          <div className="grid sm:grid-cols-2 gap-2">
            {categories.map((c) => (
              <div key={c.id} className="card-soft flex items-center gap-3 px-3 py-2.5">
                <span className="flex-1">{c.name}</span>
                <span className="tnum text-sm muted">
                  {c.monthly_budget != null
                    ? `${npr(c.monthly_budget)}/mo`
                    : "no budget"}
                </span>
              </div>
            ))}
          </div>
          {canManage && (
            <form action={addCategory} className="flex gap-2 mt-4">
              <input
                name="name"
                required
                placeholder="New category"
                className="input flex-1"
              />
              <input
                name="monthly_budget"
                type="number"
                min="0"
                step="0.01"
                placeholder="Budget"
                className="input tnum !w-28"
              />
              <button className="btn btn-primary">Add</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
