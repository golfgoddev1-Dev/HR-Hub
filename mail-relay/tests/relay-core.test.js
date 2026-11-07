// Pure relay logic. Importing relay-core.js publishes RelayCore on the global
// object, which is how the same pasted file also works in Apps Script.
import test from "node:test";
import assert from "node:assert/strict";

import "../relay-core.js";

const core = globalThis.RelayCore;

const VALID = {
  to: "approver@example.com",
  subject: "HR Hub: มีใบลารออนุมัติ",
  text: "รายละเอียดใบลา\nลิงก์: https://hr.example/approve/token",
};

test("validatePayload accepts exactly to, subject and text", () => {
  assert.deepEqual(core.validatePayload(VALID), { ok: true });
  assert.equal(core.MAX_SUBJECT_LENGTH, 120);
  assert.equal(core.MAX_TEXT_LENGTH, 4000);
});

test("validatePayload refuses anything but the three allowed keys", () => {
  for (const body of [
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
      core.validatePayload(body),
      { ok: false, code: "bad_request" },
      JSON.stringify(body)
    );
  }
});

test("validatePayload refuses an invalid or multi-address recipient", () => {
  for (const to of [
    "",
    "plain",
    "a@b",
    "A <a@b.co>",
    "a@b.co,c@d.co",
    "a@b.co; c@d.co",
    "a b@c.co",
    "a@b.co\r\nBcc: c@d.co",
    42,
    null,
  ]) {
    assert.deepEqual(
      core.validatePayload({ ...VALID, to }),
      { ok: false, code: "bad_request" },
      String(to)
    );
  }
});

test("validatePayload refuses empty, long or header-breaking subjects", () => {
  for (const subject of [
    "",
    "   ",
    "line\nBcc: x@y.z",
    "line\rBcc: x@y.z",
    "nul\u0000byte",
    "s".repeat(core.MAX_SUBJECT_LENGTH + 1),
    7,
    null,
  ]) {
    assert.deepEqual(
      core.validatePayload({ ...VALID, subject }),
      { ok: false, code: "bad_request" },
      String(subject)
    );
  }

  assert.deepEqual(
    core.validatePayload({ ...VALID, subject: "s".repeat(core.MAX_SUBJECT_LENGTH) }),
    { ok: true }
  );
});

test("validatePayload refuses empty or long bodies", () => {
  for (const text of ["", "   ", "x".repeat(core.MAX_TEXT_LENGTH + 1), 42, null]) {
    assert.deepEqual(core.validatePayload({ ...VALID, text }), {
      ok: false,
      code: "bad_request",
    });
  }

  assert.deepEqual(
    core.validatePayload({ ...VALID, text: "ก".repeat(core.MAX_TEXT_LENGTH) }),
    { ok: true }
  );
  // The approval email is multi-line, so line breaks and tabs are allowed.
  assert.deepEqual(core.validatePayload({ ...VALID, text: "บรรทัด 1\n\tบรรทัด 2" }), {
    ok: true,
  });
});

test("checkToken compares the whole value and never matches a missing expected value", () => {
  assert.equal(core.checkToken("same-token-value", "same-token-value"), true);
  assert.equal(core.checkToken("same-token-value", "same-token-valuX"), false);
  assert.equal(core.checkToken("short", "much-longer-value"), false);
  assert.equal(core.checkToken("", ""), false);
  assert.equal(core.checkToken("something", ""), false);
  assert.equal(core.checkToken(null, "expected"), false);
  assert.equal(core.checkToken("expected", null), false);
  assert.equal(core.checkToken(123, "expected"), false);
});

test("decideQuota keeps the safety margin back", () => {
  assert.equal(core.decideQuota(1500), "send");
  assert.equal(core.decideQuota(101), "send");
  assert.equal(core.decideQuota(100), "refuse");
  assert.equal(core.decideQuota(99), "refuse");
  assert.equal(core.decideQuota(0), "refuse");
  assert.equal(core.decideQuota(-5), "refuse");
  assert.equal(core.decideQuota(null), "refuse");

  assert.equal(core.decideQuota(6, 5), "send");
  assert.equal(core.decideQuota(5, 5), "refuse");
  assert.equal(core.decideQuota(4, 5), "refuse");
});

test("sameDayKey rolls over at Bangkok midnight", () => {
  assert.equal(core.sameDayKey(new Date("2026-11-07T17:30:00Z")), "2026-11-08");
  assert.equal(core.sameDayKey(new Date("2026-11-07T16:59:59Z")), "2026-11-07");
  assert.equal(core.sameDayKey(new Date("2026-11-07T00:00:00Z")), "2026-11-07");
  assert.equal(
    core.sameDayKey(new Date("2026-11-07T17:30:00Z"), "UTC"),
    "2026-11-07"
  );
  assert.match(core.sameDayKey(new Date("2026-11-07T17:30:00Z")), /^\d{4}-\d{2}-\d{2}$/);
});
