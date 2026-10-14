"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { deleteAttachment } from "@/app/(app)/attachments/actions";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  ATTACHMENT_MAX_TOTAL_BYTES,
  attachmentUrl,
  formatFileSize,
  isImageAttachment,
  looksLikeAttachment,
  type Attachment,
} from "@/lib/attachments";
import { compressImage } from "@/lib/compress-image";
import Icon from "./Icons";

/**
 * Website-style uploader: a grid of square tiles — files already saved, files
 * just picked (with a live preview), and a dashed "+" square to add more. Click
 * the square or drop files anywhere on the grid.
 *
 * `variant="pages"` is for multi-page documents (signed agreements): bigger
 * tiles numbered Page 1, Page 2… `variant="bill"` is the compact version for
 * bills and VAT bills.
 *
 * Picked files live in a real `<input name={name} type="file">` kept in sync
 * through DataTransfer, so they post with the surrounding form. Photos are
 * shrunk in the browser first so large phone pictures never hit a size limit.
 * React resets a form after its action; if the save failed and the form stays
 * open, the picked files are put straight back.
 */
export default function FileUploader({
  name,
  variant = "bill",
  existing = [],
  canRemoveExisting = true,
  readOnly = false,
  addLabel,
  lastFileWarning,
  onBusyChange,
  onCountChange,
  resetKey,
}: {
  name: string;
  variant?: "pages" | "bill";
  /** Files already saved on the record. Removing one deletes it right away. */
  existing?: Attachment[];
  canRemoveExisting?: boolean;
  /** View and download only: no adding or deleting. */
  readOnly?: boolean;
  addLabel?: string;
  /** Extra confirmation text when removing the only saved file. */
  lastFileWarning?: string;
  /** True while photos are being prepared; the form should not submit then. */
  onBusyChange?: (busy: boolean) => void;
  onCountChange?: (count: number) => void;
  /** Change it to clear the picked files (after a standalone upload). */
  resetKey?: unknown;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<File[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();
  const room = Math.max(0, ATTACHMENT_MAX_FILES - existing.length - files.length);
  const pages = variant === "pages";

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
      // Very old browsers keep whatever was last picked natively.
    }
  }

  // Put picked files back after React resets the form following a failed save.
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const restore = () => window.setTimeout(() => apply(filesRef.current), 0);
    form.addEventListener("reset", restore);
    return () => form.removeEventListener("reset", restore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Layout effect so it clears before the reset handler above restores files.
  useLayoutEffect(() => {
    if (resetKey === undefined) return;
    apply([]);
    setProblem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Never leave the parent form locked if this unmounts mid-preparation.
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => () => busyCallback.current?.(false), []);

  const previews = useMemo(
    () =>
      files.map((file) =>
        /^image\/(jpeg|png|webp|gif)$/.test(file.type) ? URL.createObjectURL(file) : null
      ),
    [files]
  );
  useEffect(() => () => previews.forEach((url) => url && URL.revokeObjectURL(url)), [previews]);

  async function add(picked: FileList | File[] | null) {
    const incoming = Array.from(picked ?? []);
    // The native input now holds only the new pick; restore the full list first.
    apply(filesRef.current);
    if (incoming.length === 0) return;

    setBusy(true);
    onBusyChange?.(true);
    const rejected: string[] = [];
    const accepted = [...filesRef.current];
    try {
      for (const original of incoming) {
        if (!looksLikeAttachment(original)) {
          rejected.push(`${original.name} is not a PDF or photo`);
          continue;
        }
        if (existing.length + accepted.length >= ATTACHMENT_MAX_FILES) {
          rejected.push(`only ${ATTACHMENT_MAX_FILES} files fit here`);
          break;
        }
        const file = await compressImage(original);
        if (file.size > ATTACHMENT_MAX_BYTES) {
          rejected.push(`${original.name} is too large (${formatFileSize(file.size)})`);
          continue;
        }
        if (accepted.some((item) => item.name === file.name && item.size === file.size)) continue;
        const total = accepted.reduce((sum, item) => sum + item.size, 0) + file.size;
        if (total > ATTACHMENT_MAX_TOTAL_BYTES) {
          rejected.push(`${original.name} would make this save too large — save first, then add it`);
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

  function removeSaved(file: Attachment) {
    const last = existing.length === 1 && lastFileWarning ? `\n\n${lastFileWarning}` : "";
    if (!window.confirm(`Delete ${file.file_name}?${last}`)) return;
    setRemovingId(file.id);
    startRemoving(async () => {
      const result = await deleteAttachment(file.id);
      if (result.error) window.alert(result.error);
      setRemovingId(null);
    });
  }

  const tileLabel = (index: number) => (pages ? `Page ${index + 1}` : null);

  return (
    <div className={`uploader uploader-${variant}`}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        name={name}
        multiple
        accept={ATTACHMENT_ACCEPT}
        onChange={(event) => void add(event.target.files)}
        className="sr-only"
        tabIndex={-1}
      />

      <div
        className={`uploader-grid ${dragging ? "uploader-grid-drag" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (room > 0) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (room > 0) void add(event.dataTransfer.files);
        }}
      >
        {existing.map((file, index) => (
          <figure
            key={file.id}
            className={`uploader-tile ${removingId === file.id ? "uploader-tile-removing" : ""}`}
          >
            <a href={attachmentUrl(file.id)} target="_blank" rel="noopener" className="uploader-thumb" title={`Open ${file.file_name}`}>
              {isImageAttachment(file.content_type) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attachmentUrl(file.id)} alt={file.file_name} loading="lazy" />
              ) : (
                <DocFace type={file.content_type} />
              )}
            </a>
            {tileLabel(index) && <span className="uploader-badge">{tileLabel(index)}</span>}
            <div className="uploader-tile-actions">
              <a href={attachmentUrl(file.id, true)} className="uploader-action" aria-label={`Download ${file.file_name}`} title="Download">
                <Icon name="download" size={12} />
              </a>
              {canRemoveExisting && !readOnly && (
                <button
                  type="button"
                  disabled={removing}
                  className="uploader-action uploader-action-danger"
                  aria-label={`Delete ${file.file_name}`}
                  title="Delete"
                  onClick={() => removeSaved(file)}
                >
                  <Icon name="trash" size={12} />
                </button>
              )}
            </div>
            <figcaption title={file.file_name}>{file.file_name}</figcaption>
          </figure>
        ))}

        {files.map((file, index) => (
          <figure key={`${file.name}-${file.size}-${index}`} className="uploader-tile uploader-tile-new">
            <div className="uploader-thumb">
              {previews[index] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previews[index]!} alt={file.name} />
              ) : (
                <DocFace type={file.type} name={file.name} />
              )}
            </div>
            <span className="uploader-badge uploader-badge-new">
              {tileLabel(existing.length + index) ?? "New"}
            </span>
            <div className="uploader-tile-actions">
              <button
                type="button"
                className="uploader-action"
                aria-label={`Remove ${file.name}`}
                title="Remove"
                onClick={() => apply(files.filter((_, position) => position !== index))}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
            <figcaption title={file.name}>
              {file.name} · {formatFileSize(file.size)}
            </figcaption>
          </figure>
        ))}

        {room > 0 && !readOnly && (
          <label htmlFor={inputId} className={`uploader-add ${busy ? "uploader-add-busy" : ""}`}>
            <span className="uploader-add-plus">{busy ? <span className="uploader-spinner" /> : <Icon name="plus" size={22} />}</span>
            <strong>
              {busy
                ? "Preparing…"
                : addLabel ?? (pages ? (existing.length + files.length ? "Add page" : "Upload pages") : "Add file")}
            </strong>
            <small>{busy ? "Shrinking photos" : "Click or drop here"}</small>
          </label>
        )}
      </div>

      {readOnly && existing.length === 0 && <p className="uploader-foot">Nothing uploaded yet.</p>}
      {!readOnly && <p className="uploader-foot">
        {files.length > 0
          ? `${files.length} new file${files.length === 1 ? "" : "s"} — saved when you press Save.`
          : "PDF or photos (JPG, PNG, HEIC) · several at once · big photos are shrunk automatically."}
      </p>}
      {problem && (
        <p className="uploader-foot" style={{ color: "var(--amber)" }}>
          {problem}
        </p>
      )}
    </div>
  );
}

function DocFace({ type, name }: { type: string; name?: string }) {
  const isPdf = type === "application/pdf" || /\.pdf$/i.test(name ?? "");
  return (
    <span className="uploader-doc">
      <Icon name="receipt" size={24} />
      <b>{isPdf ? "PDF" : /hei[cf]/i.test(type + (name ?? "")) ? "HEIC" : "FILE"}</b>
    </span>
  );
}
