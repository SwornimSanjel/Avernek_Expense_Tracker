"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Icon from "@/components/Icons";

export type RailClient = {
  id: string;
  name: string;
  group: "Active" | "Pending" | "Paused" | "Inactive";
  dueNow: number;
  overdue: boolean;
  recurring: boolean;
};

const ORDER: RailClient["group"][] = ["Active", "Pending", "Paused", "Inactive"];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

/** Searchable client list, grouped by status, with a health dot per client. */
export default function ClientRail({ clients, selectedId }: { clients: RailClient[]; selectedId?: string }) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? clients.filter((client) => client.name.toLowerCase().includes(needle)) : clients;
  }, [clients, search]);

  return (
    <aside className="card p-2.5 lg:sticky lg:top-5 lg:max-h-[calc(100vh-40px)] overflow-y-auto">
      <div className="search-field mb-2">
        <Icon name="search" size={15} />
        <input className="input !w-full" placeholder="Find a client…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Find a client" />
      </div>
      <Link href="/clients" className={`rail-item ${!selectedId ? "rail-item-on" : ""}`}>
        <span className="rail-avatar"><Icon name="layers" size={14} /></span>
        <span className="flex-1 truncate">All clients</span>
        <span className="chip-count">{clients.length}</span>
      </Link>
      {ORDER.map((group) => {
        const items = visible.filter((client) => client.group === group);
        if (!items.length) return null;
        return (
          <div key={group} className="mt-3">
            <div className="px-2.5 pb-1 text-[12px] font-semibold muted-2">{group} · {items.length}</div>
            {items.map((client) => (
              <Link key={client.id} href={`/clients?client=${client.id}`} className={`rail-item ${selectedId === client.id ? "rail-item-on" : ""}`} title={client.name}>
                <span className="rail-avatar">{initials(client.name)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{client.name}</span>
                  {client.dueNow > 0 && (
                    <span className={`block text-[12px] tnum ${client.overdue ? "text-red" : "text-amber"}`}>
                      {client.overdue ? "Overdue" : "Due"} · {client.dueNow.toLocaleString("en-IN")}
                    </span>
                  )}
                </span>
                <span
                  className="dot"
                  title={client.overdue ? "Payment overdue" : client.dueNow > 0 ? "Payment due" : client.recurring ? "Recurring" : "Settled"}
                  style={{ color: client.overdue ? "var(--red)" : client.dueNow > 0 ? "var(--amber)" : client.recurring ? "var(--green)" : "var(--muted-2)" }}
                />
              </Link>
            ))}
          </div>
        );
      })}
      {visible.length === 0 && <p className="px-3 py-5 text-[13px] muted">No client matches “{search}”.</p>}
    </aside>
  );
}
