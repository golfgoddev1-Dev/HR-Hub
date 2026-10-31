import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { pinHmacHex } from "../src/pin.js";

// Test-only values, not real secrets.
const PEPPER = "spike-test-pepper";
const OTHER_PEPPER = "spike-test-pepper-2";
const PIN = "1234";

test("same inputs give the same output", async () => {
  const first = await pinHmacHex(PEPPER, PIN);
  const second = await pinHmacHex(PEPPER, PIN);
  assert.equal(first, second);
});

test("different pepper gives a different output", async () => {
  const withPepper = await pinHmacHex(PEPPER, PIN);
  const withOtherPepper = await pinHmacHex(OTHER_PEPPER, PIN);
  assert.notEqual(withPepper, withOtherPepper);
});

test("output is 64 lowercase hex characters", async () => {
  const digest = await pinHmacHex(PEPPER, PIN);
  assert.equal(digest.length, 64);
  assert.match(digest, /^[0-9a-f]{64}$/);
});

// Cross-check against the standard definition. Fake values only: the fake pepper is shaped like a
// real one (64 hex chars) so key length is exercised too.
test("matches node:crypto createHmac for the same key and message", async () => {
  const FAKE_PEPPER = "0123456789abcdef".repeat(4);
  const FAKE_PIN = "975310";
  const expected = createHmac("sha256", FAKE_PEPPER).update(FAKE_PIN).digest("hex");

  assert.equal(await pinHmacHex(FAKE_PEPPER, FAKE_PIN), expected);
});
