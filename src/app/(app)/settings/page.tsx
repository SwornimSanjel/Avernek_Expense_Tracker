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
      <PageHeader title="Settings" subtitle="You, the team, and categories." />

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Your profile */}
        <div className="card p-5">
          <h2 className="font-semibold mb-3">Your name</h2>
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
        <div className="card p-5">
          <h2 className="font-semibold mb-3">Team</h2>
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-3 py-1">
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
            <div className="card p-5">
              <h2 className="font-semibold mb-3">Add member</h2>
              <AddMemberForm />
            </div>

            <div className="card p-5">
              <h2 className="font-semibold mb-3">Set a password</h2>
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
        <div className="card p-5 lg:col-span-2">
          <h2 className="font-semibold mb-3">Categories &amp; budgets</h2>
          <div className="space-y-1">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-3 py-1.5">
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
                inputMode="decimal"
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
