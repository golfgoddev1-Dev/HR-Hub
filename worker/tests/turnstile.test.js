import test from "node:test";
import assert from "node:assert/strict";

import { turnstileEnabled, verifyTurnstile } from "../src/turnstile.js";

function installFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("turnstileEnabled only accepts the exact string true", () => {
  assert.equal(turnstileEnabled({ TURNSTILE_ENABLED: "true" }), true);
  for (const value of ["false", "TRUE", "1", "", undefined]) {
    assert.equal(turnstileEnabled({ TURNSTILE_ENABLED: value }), false);
  }
});

test("verifyTurnstile posts the token and secret to Siteverify", async (t) => {
  const fake = installFetch(() => jsonResponse({ success: true }));
  t.after(() => fake.restore());

  const result = await verifyTurnstile("fake-turnstile-token", "203.0.113.9", "fake-secret");
  assert.deepEqual(result, { ok: true });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(fake.calls[0].init.method, "POST");
  assert.equal(fake.calls[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.ok(fake.calls[0].init.signal instanceof AbortSignal);

  const form = new URLSearchParams(fake.calls[0].init.body.toString());
  assert.equal(form.get("secret"), "fake-secret");
  assert.equal(form.get("response"), "fake-turnstile-token");
  assert.equal(form.get("remoteip"), "203.0.113.9");
});

test("verifyTurnstile omits remoteip when absent", async (t) => {
  const fake = installFetch(() => jsonResponse({ success: true }));
  t.after(() => fake.restore());

  await verifyTurnstile("fake-turnstile-token", "", "fake-secret");
  const form = new URLSearchParams(fake.calls[0].init.body.toString());
  assert.equal(form.has("remoteip"), false);
});

test("verifyTurnstile treats a rejected token as a failed verification", async (t) => {
  const fake = installFetch(() => jsonResponse({ success: false }));
  t.after(() => fake.restore());

  assert.deepEqual(await verifyTurnstile("fake-token", "unknown", "fake-secret"), {
    ok: false,
  });
});

test("verifyTurnstile throws on HTTP errors and unreadable responses", async (t) => {
  const cases = [
    () => jsonResponse({ success: true }, 500),
    () => new Response("not json", { status: 200 }),
  ];

  for (const responder of cases) {
    const fake = installFetch(responder);
    try {
      await assert.rejects(() => verifyTurnstile("fake-token", "unknown", "fake-secret"));
    } finally {
      fake.restore();
    }
  }
});

test("verifyTurnstile propagates transport failures", async (t) => {
  const fake = installFetch(() => {
    throw new Error("network unavailable");
  });
  t.after(() => fake.restore());

  await assert.rejects(() => verifyTurnstile("fake-token", "unknown", "fake-secret"));
});
