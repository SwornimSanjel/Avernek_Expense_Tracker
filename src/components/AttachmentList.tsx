"use client";

import { useState, useTransition } from "react";
import { deleteAttachment } from "@/app/(app)/attachments/actions";
import {
  attachmentUrl,
  formatFileSize,
  isImageAttachment,
  type Attachment,
} from "@/lib/attachments";
import Icon from "./Icons";

/**
 * Files already saved on a record: open, download, or remove each one.
 * `layout="pages"` shows image thumbnails — for multi-page agreements, where
 * seeing the pages matters more than the file names.
 */
export default function AttachmentList({
  files,
  canRemove,
  layout = "list",
  lastFileWarning,
}: {
  files: Attachment[];
  canRemove?: boolean;
  layout?: "list" | "pages";
  /** Extra confirmation text when removing the only remaining file. */
  lastFileWarning?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);
  if (files.length === 0) return null;

  function remove(file: Attachment) {
    const last = files.length === 1 && lastFileWarning ? `\n\n${lastFileWarning}` : "";
    if (!window.confirm(`Remove ${file.file_name}?${last}`)) return;
    setRemoving(file.id);
    startTransition(async () => {
      const result = await deleteAttachment(file.id);
      if (result.error) window.alert(result.error);
      setRemoving(null);
    });
  }

  if (layout === "pages") {
    return (
      <div className="page-grid">
        {files.map((file, index) => (
          <figure key={file.id} className={`page-tile ${removing === file.id ? "opacity-40" : ""}`}>
            <a href={attachmentUrl(file.id)} target="_blank" rel="noopener" className="page-thumb">
              {isImageAttachment(file.content_type) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attachmentUrl(file.id)} alt={`Page ${index + 1}`} loading="lazy" />
              ) : (
                <span className="page-thumb-doc">
                  <Icon name="receipt" size={22} />
                  {file.content_type === "application/pdf" ? "PDF" : "File"}
                </span>
              )}
            </a>
            <figcaption>
              <span className="min-w-0 flex-1 truncate" title={file.file_name}>
                {index + 1}. {file.file_name}
              </span>
              <a href={attachmentUrl(file.id, true)} className="icon-btn !w-7 !h-7" aria-label={`Download ${file.file_name}`} title="Download">
                <Icon name="download" size={12} />
              </a>
              {canRemove && (
                <button
                  type="button"
                  disabled={pending}
                  className="icon-btn !w-7 !h-7"
                  style={{ color: "var(--red)" }}
                  aria-label={`Remove ${file.file_name}`}
                  title="Remove"
                  onClick={() => remove(file)}
                >
                  <Icon name="trash" size={12} />
                </button>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
    );
  }

  return (
    <ul className="bill-list">
      {files.map((file) => (
        <li key={file.id} className={removing === file.id ? "opacity-40" : ""}>
          <Icon name="receipt" size={13} />
          <a
            href={attachmentUrl(file.id)}
            target="_blank"
            rel="noopener"
            className="min-w-0 flex-1 truncate hover:underline"
          >
            {file.file_name}
          </a>
          <span className="muted tnum">{formatFileSize(file.size_bytes)}</span>
          <a
            href={attachmentUrl(file.id, true)}
            className="icon-btn !w-7 !h-7"
            aria-label={`Download ${file.file_name}`}
            title="Download"
          >
            <Icon name="download" size={12} />
          </a>
          {canRemove && (
            <button
              type="button"
              disabled={pending}
              className="icon-btn !w-7 !h-7"
              style={{ color: "var(--red)" }}
              aria-label={`Remove ${file.file_name}`}
              title="Remove"
              onClick={() => remove(file)}
            >
              <Icon name="trash" size={12} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
