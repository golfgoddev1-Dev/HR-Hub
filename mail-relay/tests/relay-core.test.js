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

const LONG_TOKEN = "a".repeat(32);

test("validatePayload accepts exactly to, subject and text", () => {
  assert.deepEqual(core.validatePayload(VALID), { ok: true });
  assert.equal(core.MAX_SUBJECT_LENGTH, 120);
  assert.equal(core.MAX_TEXT_LENGTH, 4000);
  assert.equal(core.MAX_BODY_BYTES, 16384);
  assert.equal(core.MIN_TOKEN_LENGTH, 32);
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
    "<a@b.co>",
    "a@b.co,c@d.co",
    "a@b.co; c@d.co",
    "a b@c.co",
    "a@b.co\r\nBcc: c@d.co",
    "a@b.co\u0001c",
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

test("sameMinuteKey is the Bangkok minute", () => {
  assert.equal(
    core.sameMinuteKey(new Date("2026-11-07T17:30:45Z")),
    "2026-11-08T00:30"
  );
  assert.equal(
    core.sameMinuteKey(new Date("2026-11-07T16:59:59Z")),
    "2026-11-07T23:59"
  );
  assert.equal(
    core.sameMinuteKey(new Date("2026-11-07T17:30:00Z"), "UTC"),
    "2026-11-07T17:30"
  );
  assert.match(core.sameMinuteKey(new Date()), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

// --- token -----------------------------------------------------------------

test("verifyRequestToken refuses a missing or too-short configured token", () => {
  // No configured token at all.
  assert.deepEqual(
    core.verifyRequestToken({ queryString: "token=value", expected: null }),
    { ok: false, code: "unauthorized" }
  );
  // A short configured token refuses every request, even a matching one.
  assert.deepEqual(
    core.verifyRequestToken({ queryString: "token=short", expected: "short" }),
    { ok: false, code: "unauthorized" }
  );
  assert.deepEqual(
    core.verifyRequestToken({ queryString: `token=${LONG_TOKEN.slice(1)}`, expected: LONG_TOKEN.slice(1) }),
    { ok: false, code: "unauthorized" }
  );
});

test("verifyRequestToken refuses a missing query token", () => {
  for (const queryString of [null, undefined, "", "   "]) {
    assert.deepEqual(
      core.verifyRequestToken({ queryString, expected: LONG_TOKEN }),
      { ok: false, code: "unauthorized" },
      String(queryString)
    );
  }
});

test("verifyRequestToken accepts exactly one matching query token", () => {
  assert.deepEqual(
    core.verifyRequestToken({ queryString: `token=${LONG_TOKEN}`, expected: LONG_TOKEN }),
    { ok: true }
  );
  // The token may be percent-encoded by URLSearchParams; decoding must happen.
  // The configured token must still be at least 32 characters, so the sample is padded.
  const special = "a&b=c d" + "x".repeat(30);
  assert.ok(special.length >= core.MIN_TOKEN_LENGTH);
  assert.deepEqual(
    core.verifyRequestToken({
      queryString: `token=${encodeURIComponent(special)}&`,
      expected: special,
    }),
    { ok: true }
  );
  assert.deepEqual(
    core.verifyRequestToken({
      queryString: `token=${LONG_TOKEN.replace(/a/g, "%61")}`,
      expected: LONG_TOKEN,
    }),
    { ok: true }
  );
});

test("verifyRequestToken refuses a duplicate token parameter", () => {
  assert.deepEqual(
    core.verifyRequestToken({
      queryString: `token=${LONG_TOKEN}&token=${LONG_TOKEN}`,
      expected: LONG_TOKEN,
    }),
    { ok: false, code: "bad_request" }
  );
});

test("verifyRequestToken refuses any parameter other than token", () => {
  for (const queryString of [
    `token=${LONG_TOKEN}&next=https://evil.example`,
    `token=${LONG_TOKEN}&html=1`,
    `token=${LONG_TOKEN}&token2=x`,
  ]) {
    assert.deepEqual(
      core.verifyRequestToken({ queryString, expected: LONG_TOKEN }),
      { ok: false, code: "bad_request" },
      queryString
    );
  }
});

test("verifyRequestToken requires an exposed header to match", () => {
  assert.deepEqual(
    core.verifyRequestToken({
      queryString: `token=${LONG_TOKEN}`,
      headers: { "x-relay-token": LONG_TOKEN },
      expected: LONG_TOKEN,
    }),
    { ok: true }
  );
  assert.deepEqual(
    core.verifyRequestToken({
      queryString: `token=${LONG_TOKEN}`,
      headers: { "X-Relay-Token": LONG_TOKEN },
      expected: LONG_TOKEN,
    }),
    { ok: true }
  );
  assert.deepEqual(
    core.verifyRequestToken({
      queryString: `token=${LONG_TOKEN}`,
      headers: { "X-Relay-Token": "a".repeat(31) + "b" },
      expected: LONG_TOKEN,
    }),
    { ok: false, code: "unauthorized" }
  );
  // A header that is present but empty still has to match: it never does.
  assert.deepEqual(
    core.verifyRequestToken({
      queryString: `token=${LONG_TOKEN}`,
      headers: { "X-Relay-Token": "" },
      expected: LONG_TOKEN,
    }),
    { ok: false, code: "unauthorized" }
  );
});

test("a token in the body is refused, never read as a token", () => {
  assert.deepEqual(core.validatePayload({ ...VALID, token: LONG_TOKEN }), {
    ok: false,
    code: "bad_request",
  });
  // And the token reader only ever looks at the query string.
  assert.deepEqual(
    core.verifyRequestToken({ queryString: "", headers: {}, token: LONG_TOKEN, expected: LONG_TOKEN }),
    { ok: false, code: "unauthorized" }
  );
});

test("tokenFromQuery reports the parsed value and never the expected one", () => {
  assert.deepEqual(core.tokenFromQuery(`token=${LONG_TOKEN}`), {
    ok: true,
    token: LONG_TOKEN,
  });
  assert.deepEqual(core.tokenFromQuery(""), { ok: false, code: "unauthorized" });
  assert.deepEqual(core.tokenFromQuery("token=a&x=1"), { ok: false, code: "bad_request" });
});

// --- kill switch -----------------------------------------------------------

test("relayEnabled is true only for the exact string", () => {
  assert.equal(core.relayEnabled("true"), true);
  for (const value of ["false", "1", "", "TRUE", " true", "yes", null, undefined, true]) {
    assert.equal(core.relayEnabled(value), false, String(value));
    assert.deepEqual(core.failure("disabled"), { ok: false, code: "disabled" });
  }
});

// --- recipient allowlist ---------------------------------------------------

test("checkRecipientDomain fails closed when no allowlist is configured", () => {
  for (const allowed of [null, undefined, "", "   ", " , ,"]) {
    assert.deepEqual(core.checkRecipientDomain(VALID.to, allowed), {
      ok: false,
      code: "config",
    });
  }
});

test("checkRecipientDomain matches the domain case-insensitively", () => {
  for (const allowed of ["example.com", "EXAMPLE.COM", " company.co.th , example.com "]) {
    assert.deepEqual(core.checkRecipientDomain("Approver@Example.COM", allowed), { ok: true });
  }
  assert.deepEqual(core.checkRecipientDomain("a@example.com", "gmail.com,example.com"), {
    ok: true,
  });
});

test("checkRecipientDomain does not treat a subdomain as a match", () => {
  assert.deepEqual(core.checkRecipientDomain("a@evil.company.co.th", "company.co.th"), {
    ok: false,
    code: "recipient_not_allowed",
  });
  assert.deepEqual(core.checkRecipientDomain("a@company.co.th.evil.example", "company.co.th"), {
    ok: false,
    code: "recipient_not_allowed",
  });
  // Nor does a parent domain match a listed subdomain.
  assert.deepEqual(core.checkRecipientDomain("a@company.co.th", "mail.company.co.th"), {
    ok: false,
    code: "recipient_not_allowed",
  });
});

test("checkRecipientDomain refuses display names, angle brackets and lists", () => {
  for (const to of [
    "Approver <approver@example.com>",
    "<approver@example.com>",
    "approver@example.com,other@example.com",
    "approver@example.com;other@example.com",
    "approver @example.com",
    "approver@example.com\u0000",
  ]) {
    assert.deepEqual(
      core.checkRecipientDomain(to, "example.com"),
      { ok: false, code: "recipient_not_allowed" },
      to
    );
  }
});

test("a recipient refusal never contains the address", () => {
  const address = "someone@not-allowed.example";
  const refusal = core.checkRecipientDomain(address, "example.com");
  const serialized = JSON.stringify(refusal);

  assert.deepEqual(refusal, { ok: false, code: "recipient_not_allowed" });
  assert.equal(serialized.includes(address), false);
  assert.equal(serialized.includes("not-allowed"), false);
  assert.deepEqual(Object.keys(refusal).sort(), ["code", "ok"]);
});

// --- caps ------------------------------------------------------------------

test("limitOrDefault applies the documented defaults", () => {
  assert.equal(core.limitOrDefault(null, 30), 30);
  assert.equal(core.limitOrDefault(undefined, 30), 30);
  assert.equal(core.limitOrDefault("", 30), 30);
  assert.equal(core.limitOrDefault("   ", 30), 30);
  assert.equal(core.limitOrDefault("abc", 30), 30);
  assert.equal(core.limitOrDefault("-5", 30), 30);
  assert.equal(core.limitOrDefault("1.5", 30), 30);
  assert.equal(core.limitOrDefault("12", 30), 12);
  assert.equal(core.limitOrDefault("0", 30), 0);
  assert.equal(core.limitOrDefault(7, 30), 7);
});

test("checkCaps applies defaults when a limit is unset", () => {
  assert.equal(core.DEFAULT_MAX_PER_MINUTE, 30);
  assert.equal(core.DEFAULT_MAX_PER_DAY, 300);

  assert.deepEqual(
    core.checkCaps({ minuteCount: 29, dayCount: 0, remainingDaily: 1000 }),
    { ok: true }
  );
  assert.deepEqual(core.checkCaps({ minuteCount: 30, dayCount: 0, remainingDaily: 1000 }), {
    ok: false,
    code: "rate_limited",
  });
  assert.deepEqual(core.checkCaps({ minuteCount: 0, dayCount: 299, remainingDaily: 1000 }), {
    ok: true,
  });
  assert.deepEqual(core.checkCaps({ minuteCount: 0, dayCount: 300, remainingDaily: 1000 }), {
    ok: false,
    code: "quota",
  });
});

test("checkCaps refuses at the per-minute cap before the daily cap", () => {
  assert.deepEqual(
    core.checkCaps({
      minuteCount: 5,
      maxPerMinute: 5,
      dayCount: 300,
      maxPerDay: 300,
      remainingDaily: 1000,
    }),
    { ok: false, code: "rate_limited" }
  );
  assert.deepEqual(
    core.checkCaps({
      minuteCount: 4,
      maxPerMinute: 5,
      dayCount: 299,
      maxPerDay: 300,
      remainingDaily: 1000,
    }),
    { ok: true }
  );
});

test("checkCaps keeps Google's remaining-quota safety margin", () => {
  assert.deepEqual(
    core.checkCaps({ minuteCount: 0, dayCount: 0, remainingDaily: 101 }),
    { ok: true }
  );
  assert.deepEqual(core.checkCaps({ minuteCount: 0, dayCount: 0, remainingDaily: 100 }), {
    ok: false,
    code: "quota",
  });
  assert.deepEqual(core.checkCaps({ minuteCount: 0, dayCount: 0 }), {
    ok: false,
    code: "quota",
  });
});

test("recordAttempt counts an attempt before the send, so failures count too", () => {
  // Code.gs increments the counters before MailApp.sendEmail, which means a send
  // that throws still consumed the allowance. These two steps are the pure part
  // of that rule.
  const counters = { minuteCount: 0, dayCount: 0 };
  const afterFirst = core.recordAttempt(counters);
  assert.deepEqual(afterFirst, { minuteCount: 1, dayCount: 1 });

  // The send throws here: the counters are already at the cap, so the next
  // attempt is refused instead of looping forever.
  assert.deepEqual(
    core.checkCaps({
      minuteCount: afterFirst.minuteCount,
      maxPerMinute: 1,
      dayCount: afterFirst.dayCount,
      maxPerDay: 300,
      remainingDaily: 1000,
    }),
    { ok: false, code: "rate_limited" }
  );

  assert.deepEqual(core.recordAttempt(null), { minuteCount: 1, dayCount: 1 });
  assert.deepEqual(core.recordAttempt({ minuteCount: -3, dayCount: "x" }), {
    minuteCount: 1,
    dayCount: 1,
  });
});

// --- body limits -----------------------------------------------------------

test("a body over 16 KiB is refused before parsing", () => {
  assert.equal(core.utf8ByteLength("a"), 1);
  assert.equal(core.utf8ByteLength("ก"), 3);
  assert.equal(core.utf8ByteLength("😀"), 4);

  assert.equal(core.bodyTooLarge("x".repeat(core.MAX_BODY_BYTES), null), false);
  assert.equal(core.bodyTooLarge("x".repeat(core.MAX_BODY_BYTES + 1), null), true);
  // Thai text is three bytes per character.
  assert.equal(core.bodyTooLarge("ก".repeat(6000), null), true);
  // A declared length over the cap is refused even before the text is measured.
  assert.equal(core.bodyTooLarge(null, core.MAX_BODY_BYTES + 1), true);
  assert.equal(core.bodyTooLarge(null, core.MAX_BODY_BYTES), false);
  assert.equal(core.bodyTooLarge(null, null), false);
});

test("isJsonContentType accepts JSON with a charset and nothing else", () => {
  for (const type of ["application/json", "application/json; charset=utf-8", "Application/JSON"]) {
    assert.equal(core.isJsonContentType(type), true, type);
  }
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "", null, undefined]) {
    assert.equal(core.isJsonContentType(type), false, String(type));
  }
});

// --- responses -------------------------------------------------------------

test("failure only returns an allowed code and no message content", () => {
  const address = "approver@example.com";
  const subject = "HR Hub: มีใบลารออนุมัติ";
  const text = "รายละเอียดใบลาและลิงก์";
  const token = LONG_TOKEN;

  for (const code of core.ALLOWED_CODES) {
    const response = core.failure(code);
    assert.deepEqual(response, { ok: false, code });
    assert.deepEqual(Object.keys(response).sort(), ["code", "ok"]);

    const serialized = JSON.stringify(response);
    for (const secret of [address, subject, text, token]) {
      assert.equal(serialized.includes(secret), false, code);
    }
    for (const allowed of ["bad_request", "unauthorized", "disabled", "config", "recipient_not_allowed", "rate_limited", "quota", "send_failed"]) {
      assert.ok(core.ALLOWED_CODES.includes(allowed));
    }
  }

  // An unknown code is normalised, never passed through.
  assert.deepEqual(core.failure("something_else"), { ok: false, code: "bad_request" });
  assert.deepEqual(core.failure(undefined), { ok: false, code: "bad_request" });
  assert.deepEqual(core.failure("quota; recipient=approver@example.com"), {
    ok: false,
    code: "bad_request",
  });
});
