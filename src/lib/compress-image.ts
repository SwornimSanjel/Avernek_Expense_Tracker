/**
 * Shrink a photographed bill or agreement page in the browser before upload.
 *
 * A phone photo is often 4–12 MB; re-encoded at 2400 px on the long side it is
 * still easily readable and usually under 1 MB. That keeps saves fast on mobile
 * data and keeps uploads well inside every size limit.
 *
 * Never fails: if the browser cannot decode the file (HEIC outside Safari, a
 * corrupt image) or compression would not help, the original file is returned
 * unchanged and the server's own checks decide.
 */

const MAX_EDGE = 2400;
const QUALITY = 0.85;
const LEAVE_ALONE_BELOW = 1.5 * 1024 * 1024;

function isImage(file: File) {
  return (
    /^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
  );
}

function isHeic(file: File) {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

export async function compressImage(file: File): Promise<File> {
  if (!isImage(file)) return file;
  // Small JPG/PNG/WEBP are already fine. HEIC is converted whenever possible,
  // because only Safari can display it.
  if (!isHeic(file) && file.size <= LEAVE_ALONE_BELOW) return file;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    // JPEG has no transparency: paint white so transparent PNG areas stay white.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY)
    );
    if (!blob) return file;
    if (!isHeic(file) && blob.size >= file.size) return file;

    const name = file.name.replace(/\.[a-z0-9]+$/i, "") || "photo";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}
