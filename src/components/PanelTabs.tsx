"use client";

import { useState } from "react";
import { Tabs } from "@/components/controls";

/**
 * Tabs over server-rendered panels: each panel is rendered on the server and
 * passed in as content, so switching is instant and needs no request.
 */
export default function PanelTabs({
  tabs,
  initial,
}: {
  tabs: { key: string; label: string; count?: number; content: React.ReactNode }[];
  initial?: string;
}) {
  const [value, setValue] = useState(initial ?? tabs[0]?.key ?? "");
  const current = tabs.find((tab) => tab.key === value) ?? tabs[0];
  return (
    <div className="card overflow-hidden rise">
      <div className="px-3">
        <Tabs value={value} onChange={setValue} options={tabs.map((tab) => ({ value: tab.key, label: tab.label, count: tab.count }))} />
      </div>
      <div key={current?.key}>{current?.content}</div>
    </div>
  );
}
