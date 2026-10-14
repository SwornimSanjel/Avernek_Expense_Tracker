"use client";

import { useState, useTransition } from "react";
import { deleteSettlement, updateSettlement } from "@/app/(app)/settlements/actions";
import type { AppUser, Settlement } from "@/lib/types";

export default function SettlementRowActions({
  settlement,
  users,
}: {
  settlement: Settlement;
  users: AppUser[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn !h-8 !px-3 text-xs">
        Edit
      </button>
      {open && (
        <div className="modal-backdrop">
          <form
            action={(formData) =>
              start(async () => {
                const result = await updateSettlement(formData);
                if (result.error) window.alert(result.error);
                else setOpen(false);
              })
            }
            className="modal-panel md:max-w-md p-5 md:p-6 space-y-4"
          >
            <input type="hidden" name="settlement_id" value={settlement.id} />
            <div className="modal-header">
              <h2 className="text-lg font-bold">Edit reimbursement</h2>
              <button type="button" onClick={() => setOpen(false)} className="icon-btn">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs muted">
                From
                <select name="from_user_id" defaultValue={settlement.from_user_id} className="input mt-1">
                  {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
              </label>
              <label className="block text-xs muted">
                To
                <select name="to_user_id" defaultValue={settlement.to_user_id} className="input mt-1">
                  {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
              </label>
              <label className="block text-xs muted">
                Amount (NPR)
                <input
                  name="amount_npr"
                  inputMode="decimal"
                  required
                  defaultValue={settlement.amount_npr}
                  className="input tnum mt-1"
                />
              </label>
              <label className="block text-xs muted">
                Date
                <input
                  name="settled_on"
                  type="date"
                  required
                  defaultValue={settlement.settled_on}
                  className="input mt-1"
                />
              </label>
            </div>
            <label className="block text-xs muted">
              Note
              <input name="note" defaultValue={settlement.note ?? ""} className="input mt-1" />
            </label>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="btn btn-primary flex-1">
                {busy ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                disabled={busy}
                className="btn"
                style={{ color: "var(--red)" }}
                onClick={() => {
                  if (!window.confirm("Delete this reimbursement record?")) return;
                  start(async () => {
                    const result = await deleteSettlement(settlement.id);
                    if (result.error) window.alert(result.error);
                    else setOpen(false);
                  });
                }}
              >
                Delete
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
