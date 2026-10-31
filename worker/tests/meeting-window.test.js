import test from "node:test";
import assert from "node:assert/strict";

import { validateWindow, buildRegisterUrl, newQrToken } from "../src/meeting-window.js";

// Test-only values. Not real tokens or origins.
const FAKE_ORIGIN = "https://hr-hub.example.com";
const FAKE_TOKEN = "a".repeat(64);

const TIME_FORMAT_MESSAGE = "รูปแบบเวลาไม่ถูกต้อง";
const TIME_ORDER_MESSAGE = "เวลาเปิดรับต้องก่อนเวลาปิดรับ";

// --- validateWindow ----------------------------------------------------------

test("validateWindow accepts a valid HH:mm pair", () => {
  assert.deepEqual(validateWindow({ openTime: "08:30", cutoffTime: "12:00" }), { ok: true });
  assert.deepEqual(validateWindow({ openTime: "00:00", cutoffTime: "23:59" }), { ok: true });
});

test("validateWindow rejects malformed times", () => {
  for (const [openTime, cutoffTime] of [
    ["8:30", "12:00"],
    ["08:5", "12:00"],
    ["08:60", "12:00"],
    ["24:00", "12:00"],
    ["ab:cd", "12:00"],
    ["09:0am", "12:00"],
    ["", ""],
    ["09:00:00", "12:00:00"],
  ]) {
    assert.deepEqual(validateWindow({ openTime, cutoffTime }), {
      ok: false,
      message: TIME_FORMAT_MESSAGE,
    });
  }
});

test("validateWindow rejects open at or after cutoff", () => {
  assert.deepEqual(validateWindow({ openTime: "12:00", cutoffTime: "12:00" }), {
    ok: false,
    message: TIME_ORDER_MESSAGE,
  });
  assert.deepEqual(validateWindow({ openTime: "13:00", cutoffTime: "12:00" }), {
    ok: false,
    message: TIME_ORDER_MESSAGE,
  });
});

test("validateWindow checks the format before the order", () => {
  assert.deepEqual(validateWindow({ openTime: "25:00", cutoffTime: "10:00" }), {
    ok: false,
    message: TIME_FORMAT_MESSAGE,
  });
});

test("validateWindow rejects non-string values", () => {
  for (const [openTime, cutoffTime] of [[null, null], [8, 12], [undefined, undefined]]) {
    assert.deepEqual(validateWindow({ openTime, cutoffTime }), {
      ok: false,
      message: TIME_FORMAT_MESSAGE,
    });
  }
});

// --- buildRegisterUrl ---------------------------------------------------------

test("buildRegisterUrl appends the token to the trimmed origin", () => {
  assert.equal(
    buildRegisterUrl(FAKE_ORIGIN, FAKE_TOKEN),
    `${FAKE_ORIGIN}/meeting/register?t=${FAKE_TOKEN}`
  );
});

test("buildRegisterUrl removes the trailing slash", () => {
  assert.equal(
    buildRegisterUrl(`${FAKE_ORIGIN}/`, FAKE_TOKEN),
    `${FAKE_ORIGIN}/meeting/register?t=${FAKE_TOKEN}`
  );
  assert.equal(
    buildRegisterUrl(`${FAKE_ORIGIN}///`, FAKE_TOKEN),
    `${FAKE_ORIGIN}/meeting/register?t=${FAKE_TOKEN}`
  );
});

test("buildRegisterUrl trims surrounding whitespace", () => {
  assert.equal(
    buildRegisterUrl(`  ${FAKE_ORIGIN}  `, FAKE_TOKEN),
    `${FAKE_ORIGIN}/meeting/register?t=${FAKE_TOKEN}`
  );
});

test("buildRegisterUrl encodes the token", () => {
  const url = buildRegisterUrl(FAKE_ORIGIN, FAKE_TOKEN);
  assert.ok(url.includes("?t="));
  assert.ok(url.endsWith(encodeURIComponent(FAKE_TOKEN)));
});

test("buildRegisterUrl throws when the origin is missing or blank", () => {
  for (const origin of [undefined, null, "", "   "]) {
    assert.throws(() => buildRegisterUrl(origin, FAKE_TOKEN));
  }
});

// --- newQrToken ---------------------------------------------------------------

test("newQrToken returns 64 lowercase hex characters", () => {
  for (let i = 0; i < 8; i += 1) {
    const token = newQrToken();
    assert.match(token, /^[0-9a-f]{64}$/);
  }
});

test("newQrToken returns different tokens each time", () => {
  const tokens = new Set();
  for (let i = 0; i < 20; i += 1) {
    tokens.add(newQrToken());
  }
  assert.equal(tokens.size, 20);
});
