// Pure PIN rules. The spike's src/pin.js stays untouched.

import { hmacSha256Hex } from "./crypto.js";

const PIN_PATTERN = /^\d{6}$/;
const REPEATED_PIN = /^(\d)\1{5}$/;
const SEQUENTIAL_PINS = ["0123456789", "9876543210"];

const MESSAGE_FORMAT = "PIN ต้องเป็นตัวเลข 6 หลัก";
const MESSAGE_TOO_SIMPLE = "PIN ง่ายเกินไป กรุณาตั้งใหม่";

/** Same rules and order as the Express helper. */
export function validatePin(pin) {
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    return { ok: false, message: MESSAGE_FORMAT };
  }

  if (REPEATED_PIN.test(pin)) {
    return { ok: false, message: MESSAGE_TOO_SIMPLE };
  }

  if (SEQUENTIAL_PINS.some((sequence) => sequence.includes(pin))) {
    return { ok: false, message: MESSAGE_TOO_SIMPLE };
  }

  return { ok: true };
}

/** HMAC-SHA256 over "employeeId:pin", keyed with the pepper. */
export async function pinHash(pepper, employeeId, pin) {
  return hmacSha256Hex(pepper, `${employeeId}:${pin}`);
}
