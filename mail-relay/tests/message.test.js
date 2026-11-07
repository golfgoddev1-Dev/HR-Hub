// The relay's message contract: one recipient, one subject, one plain-text
// body. Unknown keys are rejected, so an `html` field can never be smuggled in.
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_BODY_BYTES,
  MAX_RECIPIENT_LENGTH,
  MAX_SUBJECT_LENGTH,
  MAX_TEXT_LENGTH,
  isPlainEmail,
  validateRelayMessage,
} from "../src/message.js";

const VALID = {
  to: "approver@example.com",
  subject: "HR Hub: มีใบลารออนุมัติ",
  text: "รายละเอียดใบลา\nลิงก์: https://hr.example/approve/token",
};

test("a valid message keeps only the three allowed fields", () => {
  const result = validateRelayMessage(VALID);
  assert.equal(result.ok, true);
  assert.deepEqual(result.message, VALID);
});

test("anything but exactly to, subject and text is refused", () => {
  for (const input of [
    null,
    undefined,
    "message",
    [],
    {},
    { ...VALID, html: "<p>x</p>" },
    { ...VALID, cc: "x@y.z" },
    { ...VALID, extra: "x" },
    { to: VALID.to, subject: VALID.subject },
    { to: VALID.to, text: VALID.text },
    { subject: VALID.subject, text: VALID.text },
  ]) {
    assert.deepEqual(
      validateRelayMessage(input),
      { ok: false, code: "invalid_message" },
      JSON.stringify(input)
    );
  }
});

test("the recipient is one bare address", () => {
  assert.equal(isPlainEmail(VALID.to), true);
  for (const to of [
    "",
    "plain",
    "a@b",
    "a@b.c\r\nBcc: x@y.z",
    "A <a@b.co>",
    "a@b.co,c@d.co",
    "a b@c.co",
    42,
    null,
  ]) {
    assert.equal(isPlainEmail(to), false, String(to));
  }

  const longest =
    "a".repeat(MAX_RECIPIENT_LENGTH - "@b.co".length) + "@b.co";
  assert.equal(longest.length, MAX_RECIPIENT_LENGTH);
  assert.equal(isPlainEmail(longest), true);
});

test("the subject is a header value, not a body", () => {
  for (const subject of [
    "",
    "   ",
    "hi\nthere",
    "hi\rthere",
    "a".repeat(MAX_SUBJECT_LENGTH + 1),
    5,
    null,
  ]) {
    assert.deepEqual(
      validateRelayMessage({ ...VALID, subject }),
      { ok: false, code: "invalid_message" },
      String(subject)
    );
  }
  assert.equal(
    validateRelayMessage({ ...VALID, subject: "a".repeat(MAX_SUBJECT_LENGTH) }).ok,
    true
  );
});

test("the body is plain text with a bounded length", () => {
  for (const text of [
    "",
    "  \n ",
    "x".repeat(MAX_TEXT_LENGTH + 1),
    "a\u0000b",
    42,
    null,
  ]) {
    assert.deepEqual(validateRelayMessage({ ...VALID, text }), {
      ok: false,
      code: "invalid_message",
    });
  }

  assert.equal(
    validateRelayMessage({ ...VALID, text: "ก".repeat(MAX_TEXT_LENGTH) }).ok,
    true
  );
  // The approval email is multi-line: newlines and tabs are allowed.
  assert.equal(
    validateRelayMessage({ ...VALID, text: "บรรทัด 1\n\tบรรทัด 2" }).ok,
    true
  );
});

test("the byte limit still fits a full Thai message at the character limit", () => {
  const worstCase = JSON.stringify({
    to: "a@b.co",
    subject: "ส".repeat(MAX_SUBJECT_LENGTH),
    text: "ก".repeat(MAX_TEXT_LENGTH),
  });
  assert.ok(new TextEncoder().encode(worstCase).length <= MAX_BODY_BYTES);
});
