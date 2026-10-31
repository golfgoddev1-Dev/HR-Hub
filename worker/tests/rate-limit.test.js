import test from "node:test";
import assert from "node:assert/strict";

import { sha256Hex } from "../src/crypto.js";
import {
  RATE_LIMIT_MESSAGE,
  SERVICE_UNAVAILABLE_MESSAGE,
  checkRateLimit,
  clientIp,
  ipRateLimitKey,
  tokenRateLimitKey,
} from "../src/rate-limit.js";

const RAW_TOKEN = "a".repeat(64);

function requestWith(headers = {}) {
  return new Request("https://app.test/api/register/context", { headers });
}

function fakeNamespace({ success = true, throws = false, status = 200, body } = {}) {
  const calls = [];
  return {
    calls,
    idFromName(key) {
      calls.push({ idFromName: key });
      return `id:${key}`;
    },
    get(id) {
      calls.push({ get: id });
      return {
        async fetch(url, init = {}) {
          calls.push({ fetch: url, method: init.method });
          if (throws) throw new Error("binding unavailable");
          const payload = body === undefined ? { success } : body;
          return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        },
      };
    },
  };
}

test("clientIp reads CF-Connecting-IP and falls back to unknown", () => {
  assert.equal(clientIp(requestWith({ "CF-Connecting-IP": "203.0.113.9" })), "203.0.113.9");
  assert.equal(clientIp(requestWith({ "CF-Connecting-IP": "" })), "unknown");
  assert.equal(clientIp(requestWith()), "unknown");
});

test("ipRateLimitKey keeps the scope and IP", () => {
  assert.equal(ipRateLimitKey("context", "203.0.113.9"), "context|203.0.113.9");
  assert.equal(ipRateLimitKey("submit", "unknown"), "submit|unknown");
});

test("tokenRateLimitKey hashes the token and never returns it", async () => {
  const key = await tokenRateLimitKey(RAW_TOKEN);
  assert.equal(key, `submit|${await sha256Hex(RAW_TOKEN)}`);
  assert.match(key, /^submit\|[0-9a-f]{64}$/);
  assert.equal(key.includes(RAW_TOKEN), false);
});

test("checkRateLimit passes the key to the namespace and accepts success", async () => {
  const namespace = fakeNamespace();
  const env = { RL_TEST: namespace };

  assert.deepEqual(await checkRateLimit(env, "RL_TEST", "context|203.0.113.9"), { ok: true });
  assert.deepEqual(namespace.calls[0], { idFromName: "context|203.0.113.9" });
  assert.deepEqual(namespace.calls[1], { get: "id:context|203.0.113.9" });
  assert.equal(namespace.calls[2].fetch, "https://rate-limit.internal/check");
  assert.equal(namespace.calls[2].method, "POST");
});

test("checkRateLimit returns 429 when the object says over limit", async () => {
  const env = { RL_TEST: fakeNamespace({ success: false }) };
  assert.deepEqual(await checkRateLimit(env, "RL_TEST", "submit|x"), {
    ok: false,
    status: 429,
    message: RATE_LIMIT_MESSAGE,
  });
});

test("checkRateLimit fails closed when the binding is missing or malformed", async () => {
  for (const env of [{}, { RL_TEST: {} }, { RL_TEST: { idFromName() {} } }]) {
    assert.deepEqual(await checkRateLimit(env, "RL_TEST", "x"), {
      ok: false,
      status: 503,
      message: SERVICE_UNAVAILABLE_MESSAGE,
    });
  }
});

test("checkRateLimit fails closed when the object throws or returns an error", async () => {
  for (const namespace of [
    fakeNamespace({ throws: true }),
    fakeNamespace({ status: 500 }),
  ]) {
    assert.deepEqual(await checkRateLimit({ RL_TEST: namespace }, "RL_TEST", "x"), {
      ok: false,
      status: 503,
      message: SERVICE_UNAVAILABLE_MESSAGE,
    });
  }
});

test("checkRateLimit fails closed on a malformed response", async () => {
  for (const body of [{}, { success: "true" }, "not json"]) {
    assert.deepEqual(
      await checkRateLimit({ RL_TEST: fakeNamespace({ body }) }, "RL_TEST", "x"),
      {
        ok: false,
        status: 503,
        message: SERVICE_UNAVAILABLE_MESSAGE,
      }
    );
  }
});
