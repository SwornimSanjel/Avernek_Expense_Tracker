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

  return (
    <div
      className="rounded-xl p-3 space-y-2"
      style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Who shares this cost?</div>
          <div className="text-xs muted">Optional — add people for an exact split.</div>
        </div>
        <button type="button" onClick={addRow} className="btn !h-8 !px-3 text-xs">
          + Person
        </button>
      </div>

      {rows.map((row) => (
        <div key={row.key} className="flex gap-2">
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
              inputMode="decimal"
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
            className="w-9 rounded-lg"
            style={{ color: "var(--red)" }}
            aria-label="Remove person"
          >
            ✕
          </button>
        </div>
      ))}

      {rows.length > 0 && (
        <div
          className="text-xs tnum"
          style={{ color: Math.abs(remaining) <= 0.01 ? "var(--green)" : "var(--amber)" }}
        >
          Allocated {allocated.toFixed(2)} {currency} · {Math.abs(remaining).toFixed(2)}{" "}
          {currency} {remaining >= 0 ? "remaining" : "over"}
        </div>
      )}
    </div>
  );
}
