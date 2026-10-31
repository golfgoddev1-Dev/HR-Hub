// Meeting window QR helpers, ported from server/meeting-window.js.
// No Node APIs: tokens come from crypto.getRandomValues.

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TIME_FORMAT_MESSAGE = "รูปแบบเวลาไม่ถูกต้อง";
export const TIME_ORDER_MESSAGE = "เวลาเปิดรับต้องก่อนเวลาปิดรับ";

/** HH:mm only; open must be before cutoff. Both messages match the Express code. */
export function validateWindow({ openTime, cutoffTime }) {
  if (!TIME_PATTERN.test(openTime) || !TIME_PATTERN.test(cutoffTime)) {
    return { ok: false, message: TIME_FORMAT_MESSAGE };
  }
  if (openTime >= cutoffTime) {
    return { ok: false, message: TIME_ORDER_MESSAGE };
  }
  return { ok: true };
}

export function buildRegisterUrl(origin, token) {
  if (typeof origin !== "string" || origin.trim().length === 0) {
    throw new Error("origin is required");
  }
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("token is required");
  }
  const base = origin.trim().replace(/\/+$/, "");
  return `${base}/meeting/register?t=${encodeURIComponent(token)}`;
}

/** 32 random bytes as 64 lowercase hex characters, like randomBytes(32).toString("hex"). */
export function newQrToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
