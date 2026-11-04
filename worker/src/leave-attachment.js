// Medical certificate upload rules (pure).
//
// The file lives in the private Supabase Storage bucket `leave-certificates`,
// addressed by an object path — never a public URL:
//   leave/<employee_id>/<request_code>/<safe-file-name>
//
// Nothing here does I/O: the route reads the upload, this module decides whether
// it is acceptable and where it goes, and src/leave-storage.js talks to Storage.

export const CERTIFICATE_BUCKET = "leave-certificates";
export const CERTIFICATE_PREFIX = "leave";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const SIGNED_URL_EXPIRES_IN = 60;
export const ATTACHMENT_NAME_MAX_LENGTH = 80;

export const ATTACHMENT_MESSAGES = {
  empty: "ไฟล์แนบว่างเปล่า",
  typeInvalid: "ไฟล์แนบต้องเป็น JPG, PNG หรือ PDF",
  sizeTooLarge: "ไฟล์แนบต้องมีขนาดไม่เกิน 10 MB",
  contentMismatch: "เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์ที่แจ้ง",
  invalidTarget: "ไม่สามารถกำหนดที่เก็บไฟล์แนบได้",
  notFound: "ไม่พบไฟล์แนบของใบลานี้",
  notStored: "ไฟล์แนบของใบลานี้ไม่ได้เก็บในระบบ",
  uploadFailed: "อัปโหลดไฟล์แนบไม่สำเร็จ กรุณาลองใหม่",
};

/** Audio/video and office formats are not medical certificates. */
export const ALLOWED_ATTACHMENT_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

const TYPE_ALIASES = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
};

/** Allowed type in canonical form, or null. */
export function normalizeContentType(value) {
  if (typeof value !== "string") return null;
  const base = value.split(";")[0].trim().toLowerCase();
  if (base.length === 0) return null;
  const canonical = TYPE_ALIASES[base] ?? base;
  return ALLOWED_ATTACHMENT_TYPES.includes(canonical) ? canonical : null;
}

export function extensionFor(contentType) {
  if (contentType === "image/png") return "png";
  if (contentType === "application/pdf") return "pdf";
  return "jpg";
}

function firstBytes(bytes, count) {
  if (bytes instanceof Uint8Array) return bytes.subarray(0, count);
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes.slice(0, count));
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, Math.min(count, bytes.byteLength));
  }
  return null;
}

/** Magic-number check, so a renamed executable is not stored as a PDF. */
export function matchesSignature(bytes, contentType) {
  const head = firstBytes(bytes, 8);
  if (!head || head.length < 4) return false;

  if (contentType === "image/jpeg") {
    return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  }
  if (contentType === "image/png") {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return head.length >= 8 && png.every((byte, index) => head[index] === byte);
  }
  if (contentType === "application/pdf") {
    return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  }
  return false;
}

/**
 * Accepts or rejects one upload. `bytes` is optional; when given, the content
 * has to match the declared type.
 */
export function validateAttachment({ contentType, size, bytes } = {}) {
  const type = normalizeContentType(contentType);
  if (!type) return { ok: false, message: ATTACHMENT_MESSAGES.typeInvalid };

  if (typeof size !== "number" || Number.isFinite(size) === false || size <= 0) {
    return { ok: false, message: ATTACHMENT_MESSAGES.empty };
  }
  if (size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, message: ATTACHMENT_MESSAGES.sizeTooLarge };
  }
  if (bytes !== undefined && bytes !== null && matchesSignature(bytes, type) === false) {
    return { ok: false, message: ATTACHMENT_MESSAGES.contentMismatch };
  }

  return { ok: true, contentType: type };
}

/**
 * A file name that is safe as an object key: no directory parts, no leading
 * dots, ASCII letters/digits/dot/dash/underscore only, and the extension always
 * follows the declared content type.
 */
export function safeAttachmentName(rawName, contentType) {
  const type = normalizeContentType(contentType) ?? "application/pdf";
  const base = String(rawName ?? "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.[A-Za-z0-9]{1,8}$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/-+$/g, "")
    .slice(0, ATTACHMENT_NAME_MAX_LENGTH);

  const stem = base.length > 0 ? base : "certificate";
  return `${stem}.${extensionFor(type)}`;
}

/** "leave/<employee>/<request code>/<file>", or null for unusable parts. */
export function attachmentPath({ employeeId, requestCode, fileName } = {}) {
  const id = typeof employeeId === "string" ? employeeId.trim() : "";
  const code = typeof requestCode === "string" ? requestCode.trim() : "";
  const name = typeof fileName === "string" ? fileName.trim() : "";

  if (id.length === 0 || code.length === 0 || name.length === 0) return null;
  if (/^[A-Za-z0-9-]+$/.test(id) === false) return null;
  if (/^[A-Za-z0-9-]+$/.test(code) === false) return null;
  if (/^[A-Za-z0-9._-]+$/.test(name) === false) return null;
  if (name.includes("..")) return null;

  const path = `${CERTIFICATE_PREFIX}/${id}/${code}/${name}`;
  return path.length <= 500 ? path : null;
}

/** True only for an object path this system writes; anything else is not ours. */
export function isCertificatePath(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.startsWith(`${CERTIFICATE_PREFIX}/`) === false) return false;
  if (trimmed.includes("..") || trimmed.includes("\\")) return false;
  const parts = trimmed.split("/");
  return parts.length === 4 && parts.every((part) => part.length > 0);
}
