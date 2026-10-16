import { attachmentUrl, type Attachment } from "@/lib/attachments";
import Icon from "./Icons";

/** Links to scans or photos saved on a record ("Bill", "Bill 2"…). */
export default function FileLinks({ files, label }: { files: Attachment[]; label: string }) {
  if (!files.length) return null;
  return (
    <span className="flex flex-wrap gap-1 mt-1.5">
      {files.map((file, index) => (
        <a key={file.id} href={attachmentUrl(file.id)} target="_blank" rel="noopener" className="pill accent" title={file.file_name}>
          <Icon name="receipt" size={12} />
          {files.length > 1 ? `${label} ${index + 1}` : label}
        </a>
      ))}
    </span>
  );
}
