import Icon from "@/components/Icons";
import { query } from "@/lib/db";

type Row = {
  kind: string;
  tool: string | null;
  status: string;
  n: number;
  cost: number;
  avg_ms: number | null;
  prompt_tokens: number;
  completion_tokens: number;
};

/**
 * Admin view of the AI assistant's last 30 days, from ai_audit_log: model
 * calls, tokens, cost, latency, transcriptions, the most used tools and the
 * changes confirmed. Server component; renders nothing until the migration
 * has created the table.
 */
export default async function AiUsagePanel() {
  let rows: Row[];
  try {
    rows = await query<Row>(
      `select kind, tool, status, count(*)::int as n,
              coalesce(sum(cost_usd), 0)::float8 as cost,
              avg(latency_ms)::float8 as avg_ms,
              coalesce(sum(prompt_tokens), 0)::int as prompt_tokens,
              coalesce(sum(completion_tokens), 0)::int as completion_tokens
         from public.ai_audit_log
        where created_at > now() - interval '30 days'
        group by kind, tool, status`
    );
  } catch {
    return null;
  }

  const of = (kind: string) => rows.filter((row) => row.kind === kind);
  const count = (list: Row[]) => list.reduce((sum, row) => sum + row.n, 0);
  const cost = (list: Row[]) => list.reduce((sum, row) => sum + row.cost, 0);
  const avgMs = (list: Row[]) => {
    const n = list.reduce((sum, row) => sum + (row.avg_ms == null ? 0 : row.n), 0);
    return n ? Math.round(list.reduce((sum, row) => sum + (row.avg_ms ?? 0) * row.n, 0) / n) : null;
  };
  const chats = of("chat");
  const transcriptions = of("transcription");
  const confirms = of("confirm");
  const tools = new Map<string, { n: number; errors: number }>();
  for (const row of [...of("tool"), ...of("form")]) {
    if (!row.tool) continue;
    const entry = tools.get(row.tool) ?? { n: 0, errors: 0 };
    entry.n += row.n;
    if (row.status === "error" || row.status === "denied") entry.errors += row.n;
    tools.set(row.tool, entry);
  }
  const topTools = [...tools.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  const usd = (value: number) => `$${value.toFixed(value < 1 ? 4 : 2)}`;
  const totalCost = cost(rows);

  const stats = [
    { label: "Model calls", value: String(count(chats)), hint: `${chats.reduce((s, r) => s + r.prompt_tokens + r.completion_tokens, 0).toLocaleString("en-US")} tokens` },
    { label: "Cost, 30 days", value: usd(totalCost), hint: "As charged by OpenRouter" },
    { label: "Avg. model time", value: avgMs(chats) == null ? "—" : `${(avgMs(chats)! / 1000).toFixed(1)}s` },
    { label: "Voice messages", value: String(count(transcriptions)), hint: avgMs(transcriptions) == null ? undefined : `avg ${(avgMs(transcriptions)! / 1000).toFixed(1)}s` },
    {
      label: "Changes confirmed",
      value: String(count(confirms.filter((r) => r.status === "ok"))),
      hint: `${count(confirms.filter((r) => r.status === "cancelled"))} cancelled · ${count(confirms.filter((r) => r.status === "error" || r.status === "denied"))} failed`,
    },
  ];

  const tone = "var(--accent-ink)";
  return (
    <div className="card overflow-hidden">
      {/* Same header as the other Settings sections. */}
      <div className="flex items-center gap-3 px-5 py-4 border-b">
        <div
          className="row-icon !w-9 !h-9"
          style={{ "--tone": tone, "--tone-soft": `color-mix(in srgb, ${tone} 14%, transparent)` } as React.CSSProperties}
        >
          <Icon name="sparkles" size={17} />
        </div>
        <div>
          <h2 className="text-[15.5px] font-semibold">AI assistant usage</h2>
          <p className="text-[13px] muted">Last 30 days, from the assistant&apos;s audit log</p>
        </div>
      </div>
      <div className="p-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="card-soft p-3 rounded-xl" style={{ background: "var(--surface-2)" }}>
            <div className="text-[11px] muted">{stat.label}</div>
            <div className="text-lg font-semibold tnum">{stat.value}</div>
            {stat.hint && <div className="text-[10.5px] muted">{stat.hint}</div>}
          </div>
        ))}
      </div>
      {topTools.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] muted mb-1">Most used</div>
          <div className="flex flex-wrap gap-2">
            {topTools.map(([tool, entry]) => (
              <span key={tool} className="pill tnum">
                {tool.replace(/_/g, " ")} · {entry.n}
                {entry.errors ? ` · ${entry.errors} failed` : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
