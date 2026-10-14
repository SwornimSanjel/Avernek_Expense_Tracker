"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import { deleteAttachment } from "@/app/(app)/attachments/actions";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  attachmentUrl,
  formatFileSize,
  isImageAttachment,
  looksLikeAttachment,
  type Attachment,
  type AttachmentKind,
} from "@/lib/attachments";
import { compressImage } from "@/lib/compress-image";
import Icon from "./Icons";

/**
 * Website-style uploader: a grid of square tiles — files already saved, files
 * just picked (each uploading with its own progress), and a dashed "+" square
 * to add more. Click the square or drop files anywhere on the grid.
 *
 * Each picked file is shrunk (photos) and uploaded on its own to /api/files
 * straight away. The form then carries only the uploaded files' ids in hidden
 * `name` inputs, and saving the record attaches them. Uploading separately
 * keeps photo bytes out of the form post — Cloudflare's firewall sometimes
 * blocked those — and lets every file show its own progress, error and retry.
 *
 * `variant="pages"` numbers tiles Page 1, Page 2… for multi-page agreements;
 * `variant="bill"` is the compact version for bills and VAT bills.
 */

type Item = {
  key: string;
  file: File;
  preview: string | null;
  status: "uploading" | "done" | "error";
  progress: number;
  id?: string;
  error?: string;
};

let itemSeq = 0;

export default function FileUploader({
  name,
  kind,
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
  /** What the files are; checked again on the server when the form is saved. */
  kind: AttachmentKind;
  variant?: "pages" | "bill";
  /** Files already saved on the record. Removing one deletes it right away. */
  existing?: Attachment[];
  canRemoveExisting?: boolean;
  /** View and download only: no adding or deleting. */
  readOnly?: boolean;
  addLabel?: string;
  /** Extra confirmation text when removing the only saved file. */
  lastFileWarning?: string;
  /** True while files are still uploading; the form should not save then. */
  onBusyChange?: (busy: boolean) => void;
  /** How many files are uploaded and waiting to be saved. */
  onCountChange?: (count: number) => void;
  /** Change it to clear the picked files (after a standalone save). */
  resetKey?: unknown;
}) {
  const inputId = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
  const pages = variant === "pages";
  const room = Math.max(0, ATTACHMENT_MAX_FILES - existing.length - items.length);
  const uploading = preparing || items.some((item) => item.status === "uploading");
  const ready = items.filter((item) => item.status === "done");

  // Report "busy" and "ready count" to the form.
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const countCallback = useRef(onCountChange);
  countCallback.current = onCountChange;
  useEffect(() => {
    busyCallback.current?.(uploading);
  }, [uploading]);
  useEffect(() => {
    countCallback.current?.(ready.length);
  }, [ready.length]);
  useEffect(() => () => busyCallback.current?.(false), []);

  // Once saved, an uploaded file shows up among the saved ones: drop its
  // "new" tile so nothing is ever shown — or posted — twice.
  useEffect(() => {
    const savedIds = new Set(existing.map((file) => file.id));
    if (itemsRef.current.some((item) => item.id && savedIds.has(item.id))) {
      setItems((current) => {
        const next = current.filter((item) => !(item.id && savedIds.has(item.id)));
        current
          .filter((item) => item.id && savedIds.has(item.id))
          .forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
        return next;
      });
    }
  }, [existing]);

  // Layout effect so the list is clear before anything else re-renders it.
  useLayoutEffect(() => {
    if (resetKey === undefined) return;
    setItems((current) => {
      current.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
      return [];
    });
    setProblem(null);
  }, [resetKey]);

  useEffect(
    () => () => itemsRef.current.forEach((item) => item.preview && URL.revokeObjectURL(item.preview)),
    []
  );

  function patch(key: string, change: Partial<Item>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));
  }

  function upload(item: Item) {
    patch(item.key, { status: "uploading", progress: 0, error: undefined });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.setRequestHeader("Content-Type", item.file.type || "application/octet-stream");
    xhr.setRequestHeader("X-File-Kind", kind);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(item.file.name));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) patch(item.key, { progress: Math.round((event.loaded / event.total) * 100) });
    };
    xhr.onload = () => {
      let body: { file?: Attachment; error?: string } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.file) {
        patch(item.key, { status: "done", progress: 100, id: body.file.id });
      } else {
        patch(item.key, {
          status: "error",
          error:
            body?.error ??
            (xhr.status === 403
              ? "Blocked by the network firewall (403). Press Retry."
              : `Upload failed (HTTP ${xhr.status || "no answer"}). Press Retry.`),
        });
      }
    };
    xhr.onerror = () => patch(item.key, { status: "error", error: "No connection to the server. Press Retry." });
    xhr.send(item.file);
  }

  async function add(picked: FileList | File[] | null) {
    const incoming = Array.from(picked ?? []);
    if (incoming.length === 0) return;
    setPreparing(true);
    const rejected: string[] = [];
    let space = room;
    const created: Item[] = [];
    try {
      for (const original of incoming) {
        if (!looksLikeAttachment(original)) {
          rejected.push(`${original.name} is not a PDF or photo`);
          continue;
        }
        if (space <= 0) {
          rejected.push(`only ${ATTACHMENT_MAX_FILES} files fit here`);
          break;
        }
        const file = await compressImage(original);
        if (file.size > ATTACHMENT_MAX_BYTES) {
          rejected.push(`${original.name} is too large (${formatFileSize(file.size)})`);
          continue;
        }
        if (
          itemsRef.current.some((item) => item.file.name === file.name && item.file.size === file.size) ||
          created.some((item) => item.file.name === file.name && item.file.size === file.size)
        ) {
          continue;
        }
        space -= 1;
        created.push({
          key: `f${(itemSeq += 1)}`,
          file,
          preview: /^image\/(jpeg|png|webp|gif)$/.test(file.type) ? URL.createObjectURL(file) : null,
          status: "uploading",
          progress: 0,
        });
      }
    } finally {
      setPreparing(false);
    }
    if (created.length) {
      setItems((current) => [...current, ...created]);
      created.forEach(upload);
    }
    setProblem(rejected.length ? `Skipped: ${rejected.join("; ")}.` : null);
  }

  function discard(item: Item) {
    if (item.preview) URL.revokeObjectURL(item.preview);
    setItems((current) => current.filter((entry) => entry.key !== item.key));
  }

  function removeSaved(file: Attachment) {
    const last = existing.length === 1 && lastFileWarning ? `\n\n${lastFileWarning}` : "";
    if (!window.confirm(`Delete ${file.file_name}?${last}`)) return;
    setRemovingId(file.id);
    startRemoving(async () => {
      try {
        const result = await deleteAttachment(file.id);
        if (result.error) window.alert(result.error);
      } catch {
        window.alert("Could not delete the file — reload the page and try again.");
      }
      setRemovingId(null);
    });
  }

  const tileLabel = (index: number) => (pages ? `Page ${index + 1}` : null);
  const failed = items.filter((item) => item.status === "error").length;

  return (
    <div className={`uploader uploader-${variant}`}>
      {/* What the form posts: only files that finished uploading. */}
      {ready.map((item) => (
        <input key={item.key} type="hidden" name={name} value={item.id} />
      ))}
      <input
        id={inputId}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        onChange={(event) => {
          void add(event.target.files);
          event.target.value = "";
        }}
        className="sr-only"
        tabIndex={-1}
      />

      <div
        className={`uploader-grid ${dragging ? "uploader-grid-drag" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (room > 0 && !readOnly) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (room > 0 && !readOnly) void add(event.dataTransfer.files);
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

        {items.map((item, index) => (
          <figure
            key={item.key}
            className={`uploader-tile uploader-tile-new ${item.status === "error" ? "uploader-tile-error" : ""}`}
          >
            <div className="uploader-thumb">
              {item.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.preview} alt={item.file.name} />
              ) : (
                <DocFace type={item.file.type} name={item.file.name} />
              )}
            </div>
            <span className={`uploader-badge ${item.status === "done" ? "uploader-badge-new" : ""}`}>
              {tileLabel(existing.length + index) ?? (item.status === "done" ? "Ready" : "New")}
            </span>

            {item.status === "uploading" && (
              <div className="uploader-progress" aria-label={`Uploading ${item.progress}%`}>
                <span className="uploader-spinner" />
                <b>{item.progress}%</b>
              </div>
            )}
            {item.status === "error" && (
              <div className="uploader-failed">
                <b>Not uploaded</b>
                <small>{item.error}</small>
                <button type="button" className="btn !h-7 !px-3 text-[11px]" onClick={() => upload(item)}>
                  Retry
                </button>
              </div>
            )}

            <div className="uploader-tile-actions">
              <button
                type="button"
                className="uploader-action"
                aria-label={`Remove ${item.file.name}`}
                title="Remove"
                onClick={() => discard(item)}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
            <figcaption title={item.file.name}>
              {item.status === "done" ? "✓ " : ""}
              {item.file.name} · {formatFileSize(item.file.size)}
            </figcaption>
          </figure>
        ))}

        {room > 0 && !readOnly && (
          <label htmlFor={inputId} className={`uploader-add ${preparing ? "uploader-add-busy" : ""}`}>
            <span className="uploader-add-plus">
              {preparing ? <span className="uploader-spinner" /> : <Icon name="plus" size={22} />}
            </span>
            <strong>
              {preparing
                ? "Preparing…"
                : addLabel ?? (pages ? (existing.length + items.length ? "Add page" : "Upload pages") : "Add file")}
            </strong>
            <small>{preparing ? "Shrinking photos" : "Click or drop here"}</small>
          </label>
        )}
      </div>

      {readOnly && existing.length === 0 && <p className="uploader-foot">Nothing uploaded yet.</p>}
      {!readOnly && (
        <p className="uploader-foot">
          {uploading
            ? "Uploading… you can keep filling the form."
            : failed
              ? `${failed} file${failed === 1 ? "" : "s"} did not upload — press Retry on ${failed === 1 ? "it" : "them"} or remove ${failed === 1 ? "it" : "them"}.`
              : ready.length
                ? `${ready.length} file${ready.length === 1 ? "" : "s"} uploaded — attached when you press Save.`
                : "PDF or photos (JPG, PNG, HEIC) · several at once · big photos are shrunk automatically."}
        </p>
      )}
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
