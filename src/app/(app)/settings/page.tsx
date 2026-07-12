import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { npr } from "@/lib/format";
import type { AppUser, Category } from "@/lib/types";
import { addCategory, updateMyName } from "./actions";
import TeamToggle from "@/components/TeamToggle";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: cats }, { data: team }] = await Promise.all([
    supabase.from("categories").select("*").order("name"),
    supabase.from("users").select("*").order("name"),
  ]);
  const categories = (cats ?? []) as Category[];
  const users = (team ?? []) as AppUser[];
  const me = users.find((u) => u.id === user!.id);

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
          <form action={updateMyName} className="flex gap-2">
            <input
              name="name"
              defaultValue={me?.name ?? ""}
              placeholder="e.g. Swornim Sanjel"
              className="input flex-1"
            />
            <button className="btn btn-primary">Save</button>
          </form>
          <p className="text-xs muted mt-2">Signed in as {me?.email}</p>
        </div>

        {/* Team */}
        <div className="card p-5">
          <h2 className="font-semibold mb-3">Team</h2>
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-3 py-1">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{u.name}</div>
                  <div className="text-xs muted truncate">
                    {u.email.endsWith("@local.expense") ? "participant only" : u.email}
                  </div>
                </div>
                <TeamToggle id={u.id} isCore={u.is_core_member} />
              </div>
            ))}
            {users.length === 0 && (
              <p className="text-sm muted">No participants yet.</p>
            )}
          </div>
          <p className="text-xs muted mt-3">
            Participants do not need login accounts. Exact named shares override the
            core/guest fallback.
          </p>
        </div>

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
        </div>
      </div>
    </>
  );
}
