// Strict plain-text message validation for the HR Hub mail relay.
//
// The relay accepts exactly one recipient, one subject and one plain-text
// body. There is no `html` field, no cc/bcc, no attachments and no custom
// headers, and unknown keys are rejected instead of ignored, so a caller
// cannot turn a relay message into arbitrary HTML.
//
// Limits are small on purpose but leave room for the Phase 2a approval email,
// which carries a full leave detail block plus one link (roughly 1.5k
// characters of Thai text).

export const MAX_RECIPIENT_LENGTH = 254;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_TEXT_LENGTH = 4000;

// Thai text costs three bytes per character in UTF-8, so the byte limit is
// generous compared with MAX_TEXT_LENGTH characters and still bounded.
export const MAX_BODY_BYTES = 16384;

export const MESSAGE_KEYS = Object.freeze(["to", "subject", "text"]);

const EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
// A subject is a mail header: no CR/LF and no other control character.
const HEADER_CONTROL = /[\u0000-\u001f\u007f]/;
// A body may contain line breaks and tabs, but no other control character.
const BODY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** UTF-8 byte length, used for the request size guard. */
export function byteLength(text) {
  return new TextEncoder().encode(String(text)).length;
}

/** One bare address, no display name, no list, no header injection. */
export function isPlainEmail(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_RECIPIENT_LENGTH &&
    !HEADER_CONTROL.test(value) &&
    EMAIL_PATTERN.test(value)
  );
}

/**
 * Returns { ok: true, message } with only the three allowed fields, or
 * { ok: false, code: "invalid_message" }. The failure never says which field
 * was wrong, so the relay cannot be used to probe addresses.
 */
export function validateRelayMessage(input) {
  const invalid = { ok: false, code: "invalid_message" };

  if (!isPlainObject(input)) return invalid;
  const keys = Object.keys(input);
  if (keys.length !== MESSAGE_KEYS.length) return invalid;
  for (const key of keys) {
    if (!MESSAGE_KEYS.includes(key)) return invalid;
  }

  const { to, subject, text } = input;
  if (!isPlainEmail(to)) return invalid;

  if (
    typeof subject !== "string" ||
    subject.length < 1 ||
    subject.length > MAX_SUBJECT_LENGTH ||
    subject !== subject.trim() ||
    HEADER_CONTROL.test(subject)
  ) {
    return invalid;
  }

  if (
    typeof text !== "string" ||
    text.length < 1 ||
    text.length > MAX_TEXT_LENGTH ||
    text.trim().length === 0 ||
    BODY_CONTROL.test(text)
  ) {
    return invalid;
  }

  return { ok: true, message: { to, subject, text } };
}
