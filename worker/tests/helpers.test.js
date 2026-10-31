import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

import { sha256Hex, hmacSha256Hex, timingSafeEqualHex } from "../src/crypto.js";
import {
  parseCookies,
  sessionCookieName,
  sessionCookieOptions,
  serializeCookie,
} from "../src/cookie.js";
import { normalizeNationalId, nationalIdHash } from "../src/national-id.js";
import { validatePin, pinHash } from "../src/pin-rules.js";
import { getRequiredEnv } from "../src/env.js";

// Test-only values. Not real secrets, PINs or national IDs.
const FAKE_PEPPER = "test-pepper";
const FAKE_PEPPER_2 = "test-pepper-2";
const FAKE_PEPPER_3 = "test-pepper-3";
const FAKE_KEY_1 = "test-key-1";
const FAKE_KEY_2 = "test-key-2";
const FAKE_EMPLOYEE_ID = "TEST-EMP-001";
const FAKE_PIN = "135790";
const FAKE_NATIONAL_ID = "1-2345-67890-12-3";

// --- crypto ---------------------------------------------------------------

test("sha256Hex matches node:crypto for fixed inputs", async () => {
  const inputs = ["", "abc", "test value 3", "ข้อความทดสอบ"];
  for (const input of inputs) {
    const expected = createHash("sha256").update(input, "utf8").digest("hex");
    assert.equal(await sha256Hex(input), expected);
  }
});

test("hmacSha256Hex matches node:crypto for fixed inputs", async () => {
  const cases = [
    [FAKE_PEPPER, "test-value-1"],
    [FAKE_KEY_1, "another test value"],
    [FAKE_KEY_2, "ข้อความทดสอบ"],
  ];
  for (const [key, text] of cases) {
    const expected = createHmac("sha256", key).update(text, "utf8").digest("hex");
    assert.equal(await hmacSha256Hex(key, text), expected);
  }
});

test("sha256Hex and hmacSha256Hex return 64 lowercase hex characters", async () => {
  assert.match(await sha256Hex("abc"), /^[0-9a-f]{64}$/);
  assert.match(await hmacSha256Hex(FAKE_PEPPER, "abc"), /^[0-9a-f]{64}$/);
});

test("timingSafeEqualHex is true for equal hex", () => {
  const digest = "a".repeat(64);
  assert.equal(timingSafeEqualHex(digest, digest), true);
});

test("timingSafeEqualHex is false for different hex", () => {
  assert.equal(timingSafeEqualHex("a".repeat(63) + "b", "a".repeat(64)), false);
});

test("timingSafeEqualHex is false for non-hex or wrong length", () => {
  assert.equal(timingSafeEqualHex("g".repeat(64), "g".repeat(64)), false);
  assert.equal(timingSafeEqualHex("a".repeat(63), "a".repeat(63)), false);
  assert.equal(timingSafeEqualHex("a".repeat(65), "a".repeat(65)), false);
  assert.equal(timingSafeEqualHex("", ""), false);
});

test("timingSafeEqualHex compares hex values, not letter case", () => {
  assert.equal(timingSafeEqualHex("A".repeat(64), "a".repeat(64)), true);
  assert.equal(timingSafeEqualHex("A".repeat(63) + "B", "a".repeat(64)), false);
});

// --- national id ----------------------------------------------------------

test("normalizeNationalId strips every non-digit", () => {
  assert.equal(normalizeNationalId(FAKE_NATIONAL_ID), "1234567890123");
  assert.equal(normalizeNationalId(" 1234 5678 9012 3 "), "1234567890123");
  assert.equal(normalizeNationalId(""), "");
});

test("nationalIdHash matches node:crypto over the normalized digits", async () => {
  const normalized = normalizeNationalId(FAKE_NATIONAL_ID);
  const expected = createHmac("sha256", FAKE_PEPPER).update(normalized, "utf8").digest("hex");
  assert.equal(await nationalIdHash(normalized, FAKE_PEPPER), expected);
});

// --- pin ------------------------------------------------------------------

test("pinHash matches node:crypto over employeeId:pin", async () => {
  const expected = createHmac("sha256", FAKE_PEPPER_3)
    .update(`${FAKE_EMPLOYEE_ID}:${FAKE_PIN}`, "utf8")
    .digest("hex");
  assert.equal(await pinHash(FAKE_PEPPER_3, FAKE_EMPLOYEE_ID, FAKE_PIN), expected);
});

test("validatePin rejects PINs that are not six digits", () => {
  const message = "PIN ต้องเป็นตัวเลข 6 หลัก";
  for (const pin of ["12345", "1234567", "12a456", "", "๑๒๓๔๕๖"]) {
    assert.deepEqual(validatePin(pin), { ok: false, message });
  }
});

test("validatePin rejects repeated digits", () => {
  for (const pin of ["111111", "000000", "999999"]) {
    assert.deepEqual(validatePin(pin), { ok: false, message: "PIN ง่ายเกินไป กรุณาตั้งใหม่" });
  }
});

test("validatePin rejects sequential digits", () => {
  for (const pin of ["123456", "987654"]) {
    assert.deepEqual(validatePin(pin), { ok: false, message: "PIN ง่ายเกินไป กรุณาตั้งใหม่" });
  }
});

test("validatePin accepts an ordinary six-digit PIN", () => {
  assert.deepEqual(validatePin("135790"), { ok: true });
  assert.deepEqual(validatePin("246813"), { ok: true });
});

// --- cookies --------------------------------------------------------------

test("parseCookies parses normal pairs", () => {
  assert.deepEqual(parseCookies("hr_session=abc123; theme=dark"), {
    hr_session: "abc123",
    theme: "dark",
  });
});

test("parseCookies returns an empty object for an empty header", () => {
  assert.deepEqual(parseCookies(""), {});
  assert.deepEqual(parseCookies(undefined), {});
});

test("parseCookies ignores malformed pairs and keeps raw values on bad escapes", () => {
  assert.deepEqual(parseCookies("novalue; =empty; a=1; b=%E0%A4%A; c=2"), {
    a: "1",
    b: "%E0%A4%A",
    c: "2",
  });
});

test("parseCookies percent-decodes values", () => {
  assert.deepEqual(parseCookies("name=hello%20world; x=a%3Db"), {
    name: "hello world",
    x: "a=b",
  });
});

test("sessionCookieOptions defaults secure to true and uses fixed attributes", () => {
  assert.deepEqual(sessionCookieOptions(), {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    maxAge: 43200,
    secure: true,
  });
  assert.deepEqual(sessionCookieOptions({ secure: false }), {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    maxAge: 43200,
    secure: false,
  });
});

test("serializeCookie includes the required attributes", () => {
  const cookie = serializeCookie(sessionCookieName, "test-token", sessionCookieOptions({ secure: true }));
  assert.equal(
    cookie,
    "hr_session=test-token; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200; Secure"
  );
});

test("serializeCookie only adds Secure when secure is true", () => {
  assert.ok(serializeCookie("a", "b", { secure: true }).includes("Secure"));
  const insecure = serializeCookie("a", "b", { secure: false });
  assert.ok(!insecure.includes("Secure"));
  assert.equal(insecure, "a=b; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200");
});

test("serializeCookie clears with Max-Age=0", () => {
  const cleared = serializeCookie(sessionCookieName, "", { ...sessionCookieOptions(), maxAge: 0 });
  assert.ok(cleared.includes("Max-Age=0"));
  assert.ok(cleared.includes("Secure"));
});

// --- env ------------------------------------------------------------------

test("getRequiredEnv returns an existing value", () => {
  assert.equal(getRequiredEnv({ PIN_PEPPER: "test-pepper" }, "PIN_PEPPER"), "test-pepper");
});

test("getRequiredEnv throws on a missing value", () => {
  assert.throws(() => getRequiredEnv({}, "PIN_PEPPER"), {
    message: "missing env: PIN_PEPPER",
  });
  assert.throws(() => getRequiredEnv(undefined, "PIN_PEPPER"), {
    message: "missing env: PIN_PEPPER",
  });
});

test("getRequiredEnv throws on an empty string", () => {
  assert.throws(() => getRequiredEnv({ PIN_PEPPER: "" }, "PIN_PEPPER"), {
    message: "missing env: PIN_PEPPER",
  });
});
