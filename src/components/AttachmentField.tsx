"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  ATTACHMENT_MAX_TOTAL_BYTES,
  formatFileSize,
  looksLikeAttachment,
} from "@/lib/attachments";
import { compressImage } from "@/lib/compress-image";
import Icon from "./Icons";

/**
 * File picker for bills, agreement pages and VAT bills.
 *
 * The chosen files live in a real `<input name={name} type="file">` (kept in
 * sync through DataTransfer), so they post with the surrounding form like any
 * other field. Picking more files adds to the list instead of replacing it;
 * each can be removed before saving. Photos are shrunk in the browser first, so
 * large phone pictures upload quickly and never hit a size limit.
 *
 * React resets a form after its action runs. When the action returned an error
 * and the form stays open, the chosen files are put straight back so the next
 * attempt still carries them.
 */
export default function AttachmentField({
  name,
  label,
  hint,
  required = false,
  existingCount = 0,
  emptyHelp,
  onBusyChange,
  onCountChange,
  resetKey,
}: {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  /** Files already saved on the record being edited. */
  existingCount?: number;
  /** Shown while nothing is chosen. */
  emptyHelp?: string;
  /** True while photos are being prepared; the form should not submit then. */
  onBusyChange?: (busy: boolean) => void;
  onCountChange?: (count: number) => void;
  /** Change it to clear the picker (e.g. after a standalone upload succeeds). */
  resetKey?: unknown;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<File[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const room = Math.max(0, ATTACHMENT_MAX_FILES - existingCount);

  function apply(next: File[]) {
    filesRef.current = next;
    setFiles(next);
    onCountChange?.(next.length);
    const input = inputRef.current;
    if (!input) return;
    try {
      const transfer = new DataTransfer();
      next.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
    } catch {
      // Very old browsers: the input keeps whatever was last picked natively.
    }
  }

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const restore = () => window.setTimeout(() => apply(filesRef.current), 0);
    form.addEventListener("reset", restore);
    return () => form.removeEventListener("reset", restore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Layout effect: it must clear the list before the reset handler above puts
  // the old files back, which happens on the next tick.
  useLayoutEffect(() => {
    if (resetKey === undefined) return;
    apply([]);
    setProblem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  async function add(picked: FileList | null) {
    const incoming = Array.from(picked ?? []);
    // The native input now holds only the new pick; show the merged list while
    // photos are prepared, then write the real list back.
    apply(filesRef.current);
    if (incoming.length === 0) return;

    setBusy(true);
    onBusyChange?.(true);
    const rejected: string[] = [];
    const accepted = [...filesRef.current];
    try {
      for (const original of incoming) {
        if (!looksLikeAttachment(original)) {
          rejected.push(`${original.name} is not a PDF or image`);
          continue;
        }
        if (accepted.length >= room) {
          rejected.push(`at most ${ATTACHMENT_MAX_FILES} files fit on one record`);
          break;
        }
        const file = await compressImage(original);
        if (file.size > ATTACHMENT_MAX_BYTES) {
          rejected.push(`${original.name} is ${formatFileSize(file.size)} (limit ${formatFileSize(ATTACHMENT_MAX_BYTES)})`);
          continue;
        }
        if (accepted.some((item) => item.name === file.name && item.size === file.size)) continue;
        const total = accepted.reduce((sum, item) => sum + item.size, 0) + file.size;
        if (total > ATTACHMENT_MAX_TOTAL_BYTES) {
          rejected.push(`${original.name} would take this save over ${formatFileSize(ATTACHMENT_MAX_TOTAL_BYTES)} — save, then add the rest`);
          continue;
        }
        accepted.push(file);
      }
    } finally {
      apply(accepted);
      setProblem(rejected.length ? `Skipped: ${rejected.join("; ")}.` : null);
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <div>
      <span className="field-label">
        {label}
        {required ? <span style={{ color: "var(--red)" }}> *</span> : <span className="muted"> (optional)</span>}
      </span>
      <label className={`bill-drop mt-1 ${room === 0 ? "bill-drop-full" : ""}`}>
        <input
          ref={inputRef}
          type="file"
          name={name}
          multiple
          accept={ATTACHMENT_ACCEPT}
          disabled={room === 0}
          onChange={(event) => void add(event.target.files)}
          className="sr-only"
        />
        <span className="bill-drop-icon">
          <Icon name="receipt" size={16} />
        </span>
        <span className="min-w-0">
          <strong>
            {busy
              ? "Preparing photos…"
              : room === 0
                ? "File limit reached"
                : files.length
                  ? "Add more pages / files"
                  : "Choose files or take photos"}
          </strong>
          <small>
            {hint ?? `PDF or photos · several at once · up to ${ATTACHMENT_MAX_FILES} per record`}
          </small>
        </span>
      </label>

      {files.length > 0 && (
        <ul className="bill-list mt-2">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${index}`}>
              <Icon name="receipt" size={13} />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="muted tnum">{formatFileSize(file.size)}</span>
              <button
                type="button"
                className="icon-btn !w-7 !h-7"
                aria-label={`Remove ${file.name}`}
                onClick={() => apply(files.filter((_, position) => position !== index))}
              >
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <p className="field-help" style={{ color: "var(--amber)" }}>
          {problem}
        </p>
      )}
      {files.length === 0 && !problem && emptyHelp && <p className="field-help">{emptyHelp}</p>}
    </div>
  );
}
