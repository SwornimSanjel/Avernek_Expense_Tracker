"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReceipts, scanReceipts, type PaidWith, type ReceiptSave } from "@/app/(app)/bills/actions";
import FileUploader from "./FileUploader";
import Icon from "./Icons";
import { billTypeLabel, claimVatByDefault, sortBillCategories, type BillCategory } from "@/lib/bill-types";
import { attachmentUrl } from "@/lib/attachments";
import { formatNumber } from "@/lib/format";
import { todayIso } from "@/lib/income";
import type { ReceiptScan } from "@/lib/receipts.server";

type Account = { id: string; name: string; kind: string; currency: string };
type Person = { id: string; name: string };

type Draft = {
  fileId: string;
  fileName: string;
  isImage: boolean;
  readBy: ReceiptScan["readBy"];
  costUsd: number | null;
  warnings: string[];
  duplicate: string | null;
  include: boolean;
  categoryId: string;
  vendorName: string;
  description: string;
  date: string;
  currency: "NPR" | "USD";
  total: string;
  vat: string;
  claimVat: boolean;
  tax: number | null;
  number: string | null;
  paid: string;
  actualNpr: string;
  reading: boolean;
  error: string | null;
};

function accountLabel(account: Account) {
  if (account.kind === "company_bank") return "VAT account";
  if (account.kind === "personal_custody") return "Non-VAT account";
  return account.name;
}

function toPaid(key: string): PaidWith | null {
  if (key === "skip") return { by: "skip" };
  if (key.startsWith("acct:")) return { by: "account", accountId: key.slice(5) };
  if (key.startsWith("person:")) return { by: "person", userId: key.slice(7) };
  return null;
}

/**
 * "Add bills & receipts": drop every bill at once — PDFs, photos, both.
 *
 *   1. Upload. PDF receipts (Claude, ChatGPT and other digital receipts) are
 *      read from their text straight away, free.
 *   2. Review. Photos are read by AI only when "Read with AI" is pressed
 *      (about a tenth of a US cent each), or typed in. Fix anything, pick who
 *      paid once for all, and save.
 *
 * Each NPR bill lands on the Bills page with its VAT and is counted as an
 * expense; each USD receipt becomes an expense with the receipt attached.
 */
export default function ReceiptIntake({
  categories,
  accounts,
  people,
  aiEnabled,
}: {
  categories: BillCategory[];
  accounts: Account[];
  people: Person[];
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"upload" | "review">("upload");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [resetKey, setResetKey] = useState(0);
  const uploaderRef = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => sortBillCategories(categories), [categories]);
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  function draftFrom(scan: ReceiptScan, previous?: Draft): Draft {
    const category = categories.find((item) => item.name === scan.category);
    const currency = scan.currency ?? previous?.currency ?? "NPR";
    const vat = currency === "NPR" ? scan.tax ?? 0 : 0;
    return {
      fileId: scan.fileId,
      fileName: scan.fileName,
      isImage: scan.contentType.startsWith("image/"),
      readBy: scan.readBy,
      costUsd: scan.costUsd,
      warnings: scan.warnings,
      duplicate: scan.duplicate,
      include: previous?.include ?? !(scan.total === 0 || scan.duplicate),
      categoryId: previous?.categoryId || category?.id || "",
      vendorName: scan.vendor ?? previous?.vendorName ?? "",
      description: scan.description ?? previous?.description ?? "",
      date: scan.date ?? previous?.date ?? todayIso(),
      currency,
      total: scan.total != null ? String(scan.total) : previous?.total ?? "",
      vat: vat ? String(vat) : previous?.vat ?? "",
      claimVat: vat > 0 && claimVatByDefault(category?.name),
      tax: currency === "USD" ? scan.tax : null,
      number: scan.number ?? previous?.number ?? null,
      paid: previous?.paid ?? "",
      actualNpr: previous?.actualNpr ?? "",
      reading: false,
      error: null,
    };
  }

  function update(fileId: string, patch: Partial<Draft>) {
    setDrafts((list) => list.map((draft) => (draft.fileId === fileId ? { ...draft, ...patch } : draft)));
  }

  function uploadedIds(): string[] {
    const inputs = uploaderRef.current?.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="receipt_files"]') ?? [];
    return [...inputs].map((input) => input.value).filter(Boolean);
  }

  function readFiles() {
    const ids = uploadedIds();
    setError(null);
    start(async () => {
      const result = await scanReceipts(ids, false);
      if (result.error) return setError(result.error);
      setDrafts((current) => {
        const known = new Map(current.map((draft) => [draft.fileId, draft]));
        return result.scans.map((scan) => known.get(scan.fileId) ?? draftFrom(scan));
      });
      setStage("review");
    });
  }

  function readWithAi(targets: Draft[]) {
    for (const target of targets) update(target.fileId, { reading: true, error: null });
    start(async () => {
      const result = await scanReceipts(targets.map((draft) => draft.fileId), true);
      setDrafts((list) =>
        list.map((draft) => {
          const scan = result.scans.find((item) => item.fileId === draft.fileId);
          if (!targets.some((target) => target.fileId === draft.fileId)) return draft;
          if (!scan) return { ...draft, reading: false, error: result.error ?? "Could not read it." };
          return draftFrom(scan, draft);
        })
      );
    });
  }

  function setPaidForAll(key: string) {
    setDrafts((list) =>
      list.map((draft) => {
        if (key === "skip" && draft.currency === "USD") return draft;
        return { ...draft, paid: key };
      })
    );
  }

  const included = drafts.filter((draft) => draft.include);
  const unreadPhotos = drafts.filter((draft) => draft.isImage && draft.readBy === "none" && !draft.reading);

  function problemOf(draft: Draft): string | null {
    const category = categoryById.get(draft.categoryId);
    const counts = category ? category.counts_as_expense : true;
    if (!(Number(draft.total) > 0)) return "Enter the amount paid.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return "Enter the date.";
    if (!draft.vendorName.trim() && !draft.description.trim()) return "Say what it was for.";
    if (draft.currency === "NPR" && !counts) return null;
    if (!toPaid(draft.paid)) return "Choose who paid.";
    if (draft.currency === "USD" && draft.paid === "skip") return "Choose who paid.";
    const account = draft.paid.startsWith("acct:") ? accounts.find((item) => `acct:${item.id}` === draft.paid) : null;
    if (draft.currency === "USD" && account?.currency === "NPR" && !(Number(draft.actualNpr) > 0)) {
      return "Enter the NPR the bank charged (from the bank statement).";
    }
    return null;
  }

  function save() {
    const problems = included.map((draft) => [draft.fileId, problemOf(draft)] as const).filter(([, problem]) => problem);
    if (problems.length) {
      setDrafts((list) => list.map((draft) => ({ ...draft, error: problems.find(([id]) => id === draft.fileId)?.[1] ?? null })));
      setError(`${problems.length} ${problems.length === 1 ? "bill needs" : "bills need"} a fix before saving.`);
      return;
    }
    setError(null);
    const items: ReceiptSave[] = included.map((draft) => {
      const category = categoryById.get(draft.categoryId);
      const counts = category ? category.counts_as_expense : true;
      return {
        fileId: draft.fileId,
        categoryId: draft.categoryId || null,
        vendorName: draft.vendorName,
        description: draft.description,
        date: draft.date,
        currency: draft.currency,
        total: Number(draft.total),
        vat: draft.currency === "NPR" ? Number(draft.vat || 0) : 0,
        claimVat: draft.claimVat,
        number: draft.number,
        paid: draft.currency === "NPR" && !counts ? { by: "skip" } : toPaid(draft.paid)!,
        actualNpr: draft.actualNpr ? Number(draft.actualNpr) : null,
      };
    });
    start(async () => {
      const result = await saveReceipts(items);
      const failedIds = new Set(result.failed.map((item) => item.fileId));
      setDrafts((list) =>
        list
          .filter((draft) => !draft.include || failedIds.has(draft.fileId))
          .map((draft) => ({ ...draft, error: result.failed.find((item) => item.fileId === draft.fileId)?.error ?? null }))
      );
      router.refresh();
      if (result.failed.length) {
        setError(`${result.saved} saved · ${result.failed.length} could not be saved — see below.`);
        return;
      }
      setMessage(`${result.saved} ${result.saved === 1 ? "bill" : "bills"} saved.`);
      close(true);
    });
  }

  function close(keepMessage = false) {
    setOpen(false);
    setStage("upload");
    setDrafts([]);
    setError(null);
    setResetKey((key) => key + 1);
    if (!keepMessage) setMessage(null);
  }

  const paidOptions = (draft: Draft | null) => (
    <>
      <option value="">Who paid?</option>
      <optgroup label="Company money">
        {accounts.map((account) => (
          <option key={account.id} value={`acct:${account.id}`}>
            {accountLabel(account)}
            {draft?.currency === "USD" && account.currency === "NPR" ? " (card in NPR)" : ""}
          </option>
        ))}
      </optgroup>
      <optgroup label="Own money (partner)">
        {people.map((person) => (
          <option key={person.id} value={`person:${person.id}`}>
            {person.name}&apos;s own money
          </option>
        ))}
      </optgroup>
      {(!draft || draft.currency === "NPR") && <option value="skip">Already in Expenses — don&apos;t add again</option>}
    </>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary">
        <Icon name="receipt" size={16} /> Add bills &amp; receipts
      </button>
      {message && !open && <span className="text-[13px] text-green self-center">{message}</span>}

      {open && (
        <div className="modal-backdrop">
          <div className="modal-panel md:max-w-3xl p-5 md:p-6 space-y-4">
            <div className="modal-header">
              <div>
                <h2 className="text-lg font-bold">{stage === "upload" ? "Add bills & receipts" : `Check ${drafts.length} ${drafts.length === 1 ? "bill" : "bills"}`}</h2>
                <p className="text-[13.5px] muted mt-1">
                  {stage === "upload"
                    ? "Drop all of them at once — PDF receipts and photos of paper bills."
                    : "Fix anything that looks wrong, choose who paid, then save."}
                </p>
              </div>
              <button type="button" onClick={() => close()} className="icon-btn" aria-label="Close">
                <Icon name="close" size={16} />
              </button>
            </div>

            <div ref={uploaderRef} hidden={stage !== "upload"} className="space-y-3">
              <FileUploader
                name="receipt_files"
                kind="company_bill"
                addLabel="Add files"
                onBusyChange={setBusy}
                onCountChange={setCount}
                resetKey={resetKey}
              />
              <div className="receipt-hint">
                <Icon name="sparkles" size={15} />
                <span>
                  <strong>PDF receipts</strong> (Claude, ChatGPT, online bills) are read for free.{" "}
                  <strong>Photos</strong> of paper bills are read by AI only if you press “Read with AI” — about NPR 0.15 each — or you type them in.
                </span>
              </div>
              {error && <p className="text-sm text-red">{error}</p>}
              <button type="button" disabled={busy || count === 0 || pending} onClick={readFiles} className="btn btn-primary w-full !h-12">
                {pending ? "Reading…" : busy ? "Uploading…" : count ? `Continue with ${count} ${count === 1 ? "file" : "files"}` : "Add files first"}
              </button>
            </div>

            {stage === "review" && (
              <>
                <div className="receipt-toolbar">
                  <label className="receipt-paid-all">
                    <span className="muted">Who paid all of these?</span>
                    <select className="input !h-9" defaultValue="" onChange={(event) => event.target.value && setPaidForAll(event.target.value)}>
                      {paidOptions(null)}
                    </select>
                  </label>
                  {aiEnabled && unreadPhotos.length > 0 && (
                    <button type="button" className="btn btn-sm" disabled={pending} onClick={() => readWithAi(unreadPhotos)}>
                      <Icon name="sparkles" size={14} /> Read {unreadPhotos.length} {unreadPhotos.length === 1 ? "photo" : "photos"} with AI
                    </button>
                  )}
                </div>

                <div className="space-y-3 max-h-[58vh] overflow-y-auto pr-1">
                  {drafts.map((draft) => {
                    const category = categoryById.get(draft.categoryId);
                    const counts = category ? category.counts_as_expense : true;
                    const account = draft.paid.startsWith("acct:") ? accounts.find((item) => `acct:${item.id}` === draft.paid) : null;
                    return (
                      <div key={draft.fileId} className={`receipt-card ${draft.include ? "" : "receipt-card-off"}`}>
                        <a href={attachmentUrl(draft.fileId)} target="_blank" rel="noopener" className="receipt-thumb" title={draft.fileName}>
                          {draft.isImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={attachmentUrl(draft.fileId)} alt={draft.fileName} />
                          ) : (
                            <Icon name="file" size={26} />
                          )}
                        </a>
                        <div className="min-w-0 flex-1 space-y-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="flex items-center gap-2 text-[14px] font-semibold min-w-0">
                              <input type="checkbox" checked={draft.include} onChange={(event) => update(draft.fileId, { include: event.target.checked })} />
                              <span className="truncate">{draft.fileName}</span>
                            </label>
                            <span className={`pill ${draft.readBy === "none" ? "" : "ok"}`}>
                              {draft.reading
                                ? "Reading…"
                                : draft.readBy === "text"
                                  ? "Read from PDF · free"
                                  : draft.readBy === "ai"
                                    ? `Read by AI${draft.costUsd != null ? ` · $${draft.costUsd.toFixed(4)}` : ""}`
                                    : "Not read — type it in"}
                            </span>
                            {aiEnabled && draft.isImage && draft.readBy === "none" && !draft.reading && (
                              <button type="button" className="btn btn-sm" disabled={pending} onClick={() => readWithAi([draft])}>
                                <Icon name="sparkles" size={13} /> Read with AI
                              </button>
                            )}
                          </div>

                          {(draft.duplicate || draft.warnings.length > 0) && (
                            <ul className="receipt-warnings">
                              {draft.duplicate && <li>{draft.duplicate}</li>}
                              {draft.warnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                              ))}
                            </ul>
                          )}

                          {draft.include && (
                            <>
                              <div className="grid sm:grid-cols-2 gap-2.5">
                                <label className="block">
                                  <span className="field-label">Type</span>
                                  <select
                                    className="input mt-1"
                                    value={draft.categoryId}
                                    onChange={(event) => {
                                      const next = categoryById.get(event.target.value);
                                      update(draft.fileId, { categoryId: event.target.value, claimVat: Number(draft.vat) > 0 && claimVatByDefault(next?.name) });
                                    }}
                                  >
                                    <option value="">Choose a type</option>
                                    {sorted.map((item) => (
                                      <option key={item.id} value={item.id}>
                                        {billTypeLabel(item.name)}
                                        {item.counts_as_expense ? "" : " — not a company expense"}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="block">
                                  <span className="field-label">Shop / company</span>
                                  <input className="input mt-1" value={draft.vendorName} onChange={(event) => update(draft.fileId, { vendorName: event.target.value })} placeholder="e.g. Himalayan Java" />
                                </label>
                                <label className="block sm:col-span-2">
                                  <span className="field-label">What for</span>
                                  <input className="input mt-1" value={draft.description} onChange={(event) => update(draft.fileId, { description: event.target.value })} placeholder="e.g. Team lunch, A4 paper" />
                                </label>
                                <label className="block">
                                  <span className="field-label">Date</span>
                                  <input type="date" className="input mt-1" value={draft.date} onChange={(event) => update(draft.fileId, { date: event.target.value })} />
                                </label>
                                <div className="grid grid-cols-[96px_1fr] gap-2">
                                  <label className="block">
                                    <span className="field-label">Currency</span>
                                    <select className="input mt-1" value={draft.currency} onChange={(event) => update(draft.fileId, { currency: event.target.value as "NPR" | "USD" })}>
                                      <option value="NPR">NPR</option>
                                      <option value="USD">USD</option>
                                    </select>
                                  </label>
                                  <label className="block">
                                    <span className="field-label">Total paid</span>
                                    <input type="number" min="0" step="0.01" className="input tnum mt-1" value={draft.total} onChange={(event) => update(draft.fileId, { total: event.target.value })} />
                                  </label>
                                </div>
                              </div>

                              {draft.currency === "NPR" ? (
                                <div className="grid sm:grid-cols-2 gap-2.5 items-end">
                                  <label className="block">
                                    <span className="field-label">VAT printed on the bill (0 for a PAN bill)</span>
                                    <input type="number" min="0" step="0.01" className="input tnum mt-1" value={draft.vat} onChange={(event) => update(draft.fileId, { vat: event.target.value })} placeholder="0" />
                                  </label>
                                  {Number(draft.vat) > 0 && (
                                    <label className="checkbox-row !py-2">
                                      <input type="checkbox" checked={draft.claimVat} onChange={(event) => update(draft.fileId, { claimVat: event.target.checked })} />
                                      <span>
                                        <strong>Claim this VAT from IRD</strong>
                                        <small>Usually not for food and drinks.</small>
                                      </span>
                                    </label>
                                  )}
                                </div>
                              ) : (
                                <p className="text-[13px] muted">
                                  Foreign receipt{draft.tax ? ` — includes $${formatNumber(draft.tax)} foreign tax` : ""}: the whole amount is the expense. Foreign tax is not Nepali VAT, so it can&apos;t be claimed.
                                </p>
                              )}

                              {draft.currency === "NPR" && !counts ? (
                                <p className="receipt-note">
                                  <Icon name="info" size={14} /> {billTypeLabel(category?.name)} is not a company expense: kept as a bill only, not counted in expenses.
                                </p>
                              ) : (
                                <div className="grid sm:grid-cols-2 gap-2.5">
                                  <label className="block">
                                    <span className="field-label">Who paid</span>
                                    <select className="input mt-1" value={draft.paid} onChange={(event) => update(draft.fileId, { paid: event.target.value })}>
                                      {paidOptions(draft)}
                                    </select>
                                  </label>
                                  {draft.currency === "USD" && (
                                    <label className="block">
                                      <span className="field-label">NPR the bank charged {account?.currency === "NPR" ? "" : "(optional)"}</span>
                                      <input type="number" min="0" step="0.01" className="input tnum mt-1" value={draft.actualNpr} onChange={(event) => update(draft.fileId, { actualNpr: event.target.value })} placeholder="From the bank statement" />
                                    </label>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                          {draft.error && <p className="text-[13px] text-red">{draft.error}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {error && <p className="text-sm text-red">{error}</p>}
                <div className="flex gap-2">
                  <button type="button" className="btn !h-12" onClick={() => setStage("upload")}>
                    Back
                  </button>
                  <button type="button" disabled={pending || included.length === 0} onClick={save} className="btn btn-primary flex-1 !h-12">
                    {pending ? "Saving…" : included.length ? `Save ${included.length} ${included.length === 1 ? "bill" : "bills"}` : "Nothing selected"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
