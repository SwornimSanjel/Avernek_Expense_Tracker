"use client";

import { useMemo, useState } from "react";
import type { AppUser } from "@/lib/types";

interface Row {
  key: number;
  userId: string;
  amount: string;
}

export default function ShareAllocationFields({
  users,
  total,
  currency,
  initialShares = [],
}: {
  users: AppUser[];
  total: string;
  currency: "NPR" | "USD";
  initialShares?: { userId: string; amount: number }[];
}) {
  const [nextKey, setNextKey] = useState(initialShares.length);
  const [rows, setRows] = useState<Row[]>(
    initialShares.map((share, key) => ({
      key,
      userId: share.userId,
      amount: String(share.amount),
    }))
  );
  const allocated = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    [rows]
  );
  const remaining = (Number(total) || 0) - allocated;

  function addRow() {
    const chosen = new Set(rows.map((row) => row.userId));
    const available = users.find((user) => !chosen.has(user.id));
    if (!available) return;
    setRows((current) => [
      ...current,
      { key: nextKey, userId: available.id, amount: "" },
    ]);
    setNextKey((key) => key + 1);
  }

  function splitAcrossAll() {
    const totalValue = Number(total) || 0;
    if (!users.length || totalValue <= 0) return;
    const base = Math.floor((totalValue / users.length) * 100) / 100;
    let allocatedValue = 0;
    const nextRows = users.map((user, index) => {
      const value = index === users.length - 1 ? totalValue - allocatedValue : base;
      allocatedValue += value;
      return { key: nextKey + index, userId: user.id, amount: value.toFixed(2) };
    });
    setRows(nextRows);
    setNextKey((key) => key + users.length);
  }

  return (
    <div className="card-soft p-3.5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Who shares this cost?</div>
          <div className="text-xs muted">Optional — add people for an exact split.</div>
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={splitAcrossAll} disabled={!total || Number(total) <= 0} className="btn !h-8 !px-2.5 text-[11px]">Split all</button>
          <button type="button" onClick={addRow} className="btn !h-8 !px-2.5 text-[11px]">＋ Person</button>
        </div>
      </div>

      {rows.map((row) => (
        <div key={row.key} className="flex gap-2 p-2 rounded-xl" style={{ background: "var(--surface)" }}>
          <select
            name="share_user_id"
            value={row.userId}
            onChange={(event) =>
              setRows((current) =>
                current.map((item) =>
                  item.key === row.key ? { ...item, userId: event.target.value } : item
                )
              )
            }
            className="input flex-1"
          >
            {users.map((user) => (
              <option
                key={user.id}
                value={user.id}
                disabled={rows.some(
                  (other) => other.key !== row.key && other.userId === user.id
                )}
              >
                {user.name}
              </option>
            ))}
          </select>
          <div className="relative w-32">
            <input
              name="share_amount"
            type="number"
            min="0"
            step="0.01"
              required
              value={row.amount}
              onChange={(event) =>
                setRows((current) =>
                  current.map((item) =>
                    item.key === row.key ? { ...item, amount: event.target.value } : item
                  )
                )
              }
              placeholder="0"
              className="input tnum !pr-12"
            />
            <span className="absolute right-3 top-3 text-xs muted">{currency}</span>
          </div>
          <button
            type="button"
            onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
            className="icon-btn !w-9 !h-[46px]"
            style={{ color: "var(--red)" }}
            aria-label="Remove person"
          >
            ✕
          </button>
        </div>
      ))}

      {rows.length > 0 && (
        <div className="flex items-center justify-between gap-3 text-[11px] tnum">
          <span className="muted">Allocated {allocated.toFixed(2)} {currency}</span>
          <span className={Math.abs(remaining) <= 0.01 ? "pill ok" : "pill warn"}>
            {Math.abs(remaining) <= 0.01 ? "Fully allocated" : `${Math.abs(remaining).toFixed(2)} ${currency} ${remaining >= 0 ? "left" : "over"}`}
          </span>
        </div>
      )}
    </div>
  );
}
