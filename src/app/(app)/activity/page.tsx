import Link from "@/components/AppLink";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { Avatar, EmptyState, Kpi, PageHeader } from "@/components/ui";
import UrlFilters from "@/components/UrlFilters";
import { formatNumber } from "@/lib/format";
import { monthName, shiftMonth } from "@/lib/dates";
import { todayIso } from "@/lib/income";

export const dynamic = "force-dynamic";

type LogRow = {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string | null;
  table_name: string;
  operation: "insert" | "update" | "delete" | "sign_in";
  record_id: string | null;
  summary: string | null;
  amount: string | null;
  changes: Record<string, [unknown, unknown]> | null;
};

/** What each table means to a person reading the log. */
const AREAS: Record<string, string> = {
  expenses: "Expense",
  income_agreements: "Client",
  income_payments: "Client payment",
  other_income: "Other income",
  money_transfers: "Transfer / reimbursement",
  capital_inflows: "Funds added",
  company_bills: "Bill",
  tax_payments: "VAT payment",
  money_loans: "Loan",
  money_accounts: "Account",
  recurring: "Subscription",
  settlements: "Contribution",
  attachments: "File",
  categories: "Category",
  vendors: "Vendor",
  users: "Team member",
};

const VERB: Record<LogRow["operation"], { text: string; tone: string }> = {
  insert: { text: "added", tone: "var(--green)" },
  update: { text: "edited", tone: "var(--blue)" },
  delete: { text: "deleted", tone: "var(--red)" },
  sign_in: { text: "signed in", tone: "var(--muted)" },
};

function verbFor(row: LogRow) {
  if (row.table_name === "attachments" && row.operation === "insert") return { text: "uploaded", tone: "var(--accent)" };
  return VERB[row.operation];
}

function label(key: string) {
  const text = key.replace(/_/g, " ").replace(/\bnpr\b/i, "NPR").replace(/\bvat\b/i, "VAT").replace(/\btds\b/i, "TDS");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return formatNumber(value);
  const text = String(value);
  if (/^-?\d+(\.\d+)?$/.test(text)) return formatNumber(Number(text));
  if (/^[a-z]+(_[a-z]+)+$/.test(text)) return text.replace(/_/g, " ");
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** "Amount 15,000 → 16,000 · Note changed" — at most four fields. */
function describeChanges(changes: LogRow["changes"]) {
  if (!changes) return null;
  const parts = Object.entries(changes).map(([key, [before, after]]) =>
    key.endsWith("_id") ? `${label(key.replace(/_id$/, ""))} changed` : `${label(key)} ${show(before)} → ${show(after)}`
  );
  if (!parts.length) return null;
  return parts.length > 4 ? `${parts.slice(0, 4).join(" · ")} · +${parts.length - 4} more` : parts.join(" · ");
}

function recordHref(row: LogRow) {
  if (row.operation === "delete" || !row.record_id) return null;
  if (row.table_name === "income_agreements") return `/income/${row.record_id}`;
  if (row.table_name === "money_loans") return "/loans";
  if (row.table_name === "company_bills") return "/bills";
  if (row.table_name === "other_income") return "/other-income";
  if (row.table_name === "tax_payments") return "/vat";
  if (row.table_name === "recurring") return "/subscriptions";
  return null;
}

function dayLabel(iso: string, today: string) {
  const day = iso.slice(0, 10);
  if (day === today) return "Today";
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === yesterday.toISOString().slice(0, 10)) return "Yesterday";
  return new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kathmandu" }).format(new Date(iso));
}

const timeFmt = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kathmandu" });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" });

/**
 * Who added, edited, deleted or uploaded what, and when — every change to
 * money records, recorded by a database trigger so nothing can skip it.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ who?: string; area?: string; month?: string; action?: string }>;
}) {
  const session = await requireSession();
  if (!isAppOwner(session)) {
    return (
      <>
        <PageHeader title="Activity log" subtitle="Who changed what, and when." />
        <div className="card">
          <EmptyState title="Administrators only" description="Ask an administrator if you need to see the activity log." icon="shield" />
        </div>
      </>
    );
  }

  const filters = await searchParams;
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const month = filters.month && /^\d{4}-\d{2}$/.test(filters.month) ? filters.month : "";

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.who === "system") {
    conditions.push("actor_id is null");
  } else if (filters.who && /^[0-9a-f-]{36}$/i.test(filters.who)) {
    params.push(filters.who);
    conditions.push(`actor_id = $${params.length}::uuid`);
  }
  if (filters.area && AREAS[filters.area]) {
    params.push(filters.area);
    conditions.push(`table_name = $${params.length}`);
  }
  if (filters.action && ["insert", "update", "delete", "sign_in"].includes(filters.action)) {
    params.push(filters.action);
    conditions.push(`operation = $${params.length}`);
  }
  if (month) {
    params.push(`${month}-01`);
    conditions.push(
      `occurred_at >= ($${params.length}::date)::timestamp at time zone 'Asia/Kathmandu'
       and occurred_at < (($${params.length}::date + interval '1 month'))::timestamp at time zone 'Asia/Kathmandu'`
    );
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";

  const [rows, people, counts] = await Promise.all([
    query<LogRow>(
      `select id, occurred_at, actor_id, actor_name, table_name, operation, record_id, summary, amount, changes
         from public.activity_log ${where}
        order by occurred_at desc, id desc
        limit 400`,
      params
    ),
    query<{ actor_id: string; actor_name: string }>(
      `select distinct on (actor_id) actor_id, actor_name from public.activity_log
        where actor_id is not null order by actor_id, occurred_at desc`
    ),
    query<{ operation: string; total: string }>(
      `select operation, count(*) as total from public.activity_log
        where occurred_at >= now() - interval '30 days' and operation <> 'sign_in'
        group by operation`
    ),
  ]);
  const last30 = (operation: string) => Number(counts.find((row) => row.operation === operation)?.total ?? 0);

  const days: { key: string; label: string; rows: LogRow[] }[] = [];
  for (const row of rows) {
    const key = dayKeyFmt.format(new Date(row.occurred_at));
    let day = days.at(-1);
    if (!day || day.key !== key) {
      day = { key, label: dayLabel(row.occurred_at, today), rows: [] };
      days.push(day);
    }
    day.rows.push(row);
  }

  const months = Array.from({ length: 12 }, (_, index) => shiftMonth(thisMonth, -index));

  return (
    <>
      <PageHeader title="Activity log" subtitle="Who added, edited, deleted or uploaded what, and when." />

      <div className="kpi-grid">
        <Kpi label="Added · 30 days" icon="plus" tone="green" value={formatNumber(last30("insert"))} foot="New records" />
        <Kpi label="Edited · 30 days" icon="edit" tone="blue" value={formatNumber(last30("update"))} foot="Changes to existing records" />
        <Kpi label="Deleted · 30 days" icon="trash" tone="amber" value={formatNumber(last30("delete"))} foot="Removed records" />
        <Kpi label="People" icon="users" tone="accent" value={formatNumber(people.length)} foot="Who made changes" />
      </div>

      <section className="section">
        <UrlFilters
          values={filters as Record<string, string | undefined>}
          fields={[
            {
              name: "who",
              label: "Everyone",
              options: [
                ...people.map((person) => ({ value: person.actor_id, label: person.actor_name })),
                { value: "system", label: "System" },
              ],
            },
            {
              name: "area",
              label: "Everything",
              options: Object.entries(AREAS).map(([value, text]) => ({ value, label: text })),
            },
            {
              name: "action",
              label: "Any action",
              options: [
                { value: "insert", label: "Added" },
                { value: "update", label: "Edited" },
                { value: "delete", label: "Deleted" },
                { value: "sign_in", label: "Signed in" },
              ],
            },
            {
              name: "month",
              label: "Any month",
              options: months.map((key) => ({ value: key, label: `${monthName(key, "long")} ${key.slice(0, 4)}` })),
            },
          ]}
        />

        {days.length === 0 ? (
          <div className="card mt-3">
            <EmptyState
              title="Nothing here yet"
              description="Every add, edit, delete and upload from now on shows up here."
              icon="clock"
            />
          </div>
        ) : (
          days.map((day) => (
            <div key={day.key} className="card mt-3 overflow-hidden">
              <div className="activity-day">
                {day.label}
                <span>{day.rows.length} change{day.rows.length === 1 ? "" : "s"}</span>
              </div>
              {day.rows.map((row) => {
                const verb = verbFor(row);
                const href = recordHref(row);
                const changes = row.operation === "update" ? describeChanges(row.changes) : null;
                const what = (
                  <>
                    <span className="activity-area">{AREAS[row.table_name] ?? row.table_name}</span>
                    {row.summary && <span className="activity-summary">{row.summary}</span>}
                  </>
                );
                return (
                  <div key={row.id} className="activity-row">
                    <span className="activity-time tnum">{timeFmt.format(new Date(row.occurred_at))}</span>
                    <Avatar name={row.actor_name ?? "System"} size={30} round />
                    <div className="min-w-0 flex-1">
                      <div className="activity-line">
                        <strong>{row.actor_name ?? "System"}</strong>
                        <span style={{ color: verb.tone }}>{verb.text}</span>
                        {href ? (
                          <Link href={href} className="activity-link">
                            {what}
                          </Link>
                        ) : (
                          what
                        )}
                      </div>
                      {changes && <div className="activity-changes">{changes}</div>}
                    </div>
                    {row.amount != null && row.operation !== "sign_in" && (
                      <span className="activity-amount tnum">NPR {formatNumber(Number(row.amount))}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
        {rows.length === 400 && (
          <p className="text-[13px] muted mt-3">Showing the latest 400 changes. Pick a month or a person to see older ones.</p>
        )}
      </section>
    </>
  );
}
