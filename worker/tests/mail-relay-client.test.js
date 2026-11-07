// Client for the mail relay Worker. The API Worker only knows the relay URL and
// the shared secret; the provider key stays in the relay. Nothing here may log
// a recipient, subject, body or secret.
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SUBJECT_LENGTH,
  MAX_TEXT_LENGTH,
  RELAY_SEND_PATH,
  readRelayConfig,
  sendRelayEmail,
  validateOutgoingMessage,
} from "../src/email/relay.js";
import relayWorker from "../../mail-relay/src/app.js";

const TO = "approver@example.com";
const SUBJECT = "HR Hub: มีใบลารออนุมัติ";
const TEXT = "รายละเอียดใบลา\nลิงก์: https://hr.example/approve/token";

const ENV = {
  MAIL_RELAY_URL: "https://relay.example.workers.dev",
  MAIL_RELAY_SECRET: "relay-secret-value",
};

function fakeFetch({ status = 202, throws = false, waitForAbort = false } = {}) {
  const calls = [];
  return {
    calls,
    impl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (waitForAbort) {
        await new Promise((resolve) => {
          if (init.signal?.aborted) return resolve();
          init.signal?.addEventListener("abort", resolve, { once: true });
        });
        throw new Error("aborted");
      }
      if (throws) throw new Error("network down");
      return new Response(JSON.stringify({ ok: status < 400 }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
}

test("sends exactly to, subject and text to the relay with the shared secret", async () => {
  const fake = fakeFetch();
  const result = await sendRelayEmail(ENV, {
    to: TO,
    subject: SUBJECT,
    text: TEXT,
    fetchImpl: fake.impl,
  });

  assert.deepEqual(result, { ok: true, status: 202 });
  assert.equal(fake.calls.length, 1);

  const [{ url, init }] = fake.calls;
  assert.equal(url, `https://relay.example.workers.dev${RELAY_SEND_PATH}`);
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer relay-secret-value");
  assert.equal(init.headers["Content-Type"], "application/json");

  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), ["subject", "text", "to"]);
  assert.deepEqual(body, { to: TO, subject: SUBJECT, text: TEXT });
  assert.equal(init.body.includes("html"), false);
});

test("readRelayConfig trims a trailing slash, requires both values and refuses unsafe URLs", () => {
  assert.deepEqual(
    readRelayConfig({ MAIL_RELAY_URL: "https://r.example/", MAIL_RELAY_SECRET: "s" }),
    { ok: true, baseUrl: "https://r.example", secret: "s" }
  );
  assert.deepEqual(
    readRelayConfig({ MAIL_RELAY_URL: "https://r.example", MAIL_RELAY_SECRET: "s" }),
    { ok: true, baseUrl: "https://r.example", secret: "s" }
  );

  for (const env of [
    {},
    { MAIL_RELAY_SECRET: "s" },
    { MAIL_RELAY_URL: "https://r.example" },
    { MAIL_RELAY_URL: "https://r.example", MAIL_RELAY_SECRET: "   " },
    { MAIL_RELAY_URL: "http://r.example", MAIL_RELAY_SECRET: "s" },
    { MAIL_RELAY_URL: "ftp://r.example", MAIL_RELAY_SECRET: "s" },
    { MAIL_RELAY_URL: "not a url", MAIL_RELAY_SECRET: "s" },
    { MAIL_RELAY_URL: "https://r.example?x=1", MAIL_RELAY_SECRET: "s" },
  ]) {
    assert.deepEqual(readRelayConfig(env), { ok: false, reason: "config" }, JSON.stringify(env));
  }
});

test("an unconfigured relay never reaches the network", async () => {
  const fake = fakeFetch();
  for (const env of [
    {},
    { MAIL_RELAY_SECRET: "s" },
    { MAIL_RELAY_URL: "https://relay.example.workers.dev" },
    { MAIL_RELAY_URL: "http://relay.example.com", MAIL_RELAY_SECRET: "s" },
  ]) {
    assert.deepEqual(
      await sendRelayEmail(env, {
        to: TO,
        subject: SUBJECT,
        text: TEXT,
        fetchImpl: fake.impl,
      }),
      { ok: false, reason: "config" }
    );
  }
  assert.equal(fake.calls.length, 0);
});

test("a loopback http relay is allowed for local wrangler dev", async () => {
  for (const url of ["http://127.0.0.1:8788", "http://localhost:8788"]) {
    const fake = fakeFetch();
    const result = await sendRelayEmail(
      { MAIL_RELAY_URL: url, MAIL_RELAY_SECRET: "s" },
      { to: TO, subject: SUBJECT, text: TEXT, fetchImpl: fake.impl }
    );
    assert.deepEqual(result, { ok: true, status: 202 });
    assert.equal(fake.calls[0].url, `${url}${RELAY_SEND_PATH}`);
  }
});

test("an invalid message is refused before any request", async () => {
  const fake = fakeFetch();
  const cases = [
    { to: "", subject: SUBJECT, text: TEXT },
    { to: "not-an-email", subject: SUBJECT, text: TEXT },
    { to: "a@b.co\r\nBcc: x@y.z", subject: SUBJECT, text: TEXT },
    { to: TO, subject: "", text: TEXT },
    { to: TO, subject: "  padded  ", text: TEXT },
    { to: TO, subject: "a\nb", text: TEXT },
    { to: TO, subject: "s".repeat(MAX_SUBJECT_LENGTH + 1), text: TEXT },
    { to: TO, subject: SUBJECT, text: "" },
    { to: TO, subject: SUBJECT, text: "   " },
    { to: TO, subject: SUBJECT, text: "x".repeat(MAX_TEXT_LENGTH + 1) },
  ];

  for (const message of cases) {
    assert.deepEqual(
      await sendRelayEmail(ENV, { ...message, fetchImpl: fake.impl }),
      { ok: false, reason: "invalid" }
    );
  }
  assert.equal(fake.calls.length, 0);
});

test("validateOutgoingMessage keeps only the three fields", () => {
  assert.deepEqual(validateOutgoingMessage({ to: TO, subject: SUBJECT, text: TEXT }), {
    to: TO,
    subject: SUBJECT,
    text: TEXT,
  });
  assert.equal(validateOutgoingMessage(null), null);
  assert.equal(validateOutgoingMessage({ to: TO }), null);
});

test("a relay refusal is reported without throwing", async () => {
  for (const status of [400, 401, 429, 500, 503]) {
    const fake = fakeFetch({ status });
    assert.deepEqual(
      await sendRelayEmail(ENV, {
        to: TO,
        subject: SUBJECT,
        text: TEXT,
        fetchImpl: fake.impl,
      }),
      { ok: false, reason: "upstream", status }
    );
  }
});

test("a network failure is reported and logs nothing personal", async () => {
  const logged = [];
  const originals = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  };
  for (const name of Object.keys(originals)) {
    console[name] = (...args) =>
      logged.push(
        args
          .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
          .join(" ")
      );
  }

  try {
    const fake = fakeFetch({ throws: true });
    assert.deepEqual(
      await sendRelayEmail(ENV, {
        to: TO,
        subject: SUBJECT,
        text: TEXT,
        fetchImpl: fake.impl,
      }),
      { ok: false, reason: "network" }
    );
  } finally {
    for (const [name, fn] of Object.entries(originals)) console[name] = fn;
  }

  const text = logged.join("\n");
  for (const secret of [TO, SUBJECT, TEXT, ENV.MAIL_RELAY_SECRET, ENV.MAIL_RELAY_URL]) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test("a slow relay is aborted at the timeout", async () => {
  const fake = fakeFetch({ waitForAbort: true });
  const result = await sendRelayEmail(ENV, {
    to: TO,
    subject: SUBJECT,
    text: TEXT,
    fetchImpl: fake.impl,
    timeoutMs: 20,
  });

  assert.deepEqual(result, { ok: false, reason: "network" });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].init.signal.aborted, true);
});

test("the relay accepts the exact request this client builds", async () => {
  // 1. The client's request, captured instead of sent.
  const client = fakeFetch();
  await sendRelayEmail(ENV, {
    to: TO,
    subject: SUBJECT,
    text: TEXT,
    fetchImpl: client.impl,
  });
  const [{ init }] = client.calls;

  // 2. The relay handles that same request; its provider call is faked.
  const providerCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, providerInit = {}) => {
    providerCalls.push({ url: String(url), init: providerInit });
    return new Response(JSON.stringify({ id: "provider-id" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  let response;
  try {
    response = await relayWorker.fetch(
      new Request(`${ENV.MAIL_RELAY_URL}${RELAY_SEND_PATH}`, {
        method: "POST",
        headers: init.headers,
        body: init.body,
      }),
      {
        MAIL_RELAY_SECRET: ENV.MAIL_RELAY_SECRET,
        RESEND_API_KEY: "provider-key",
        MAIL_FROM: "HR Hub <no-reply@hr.example>",
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true });

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].url, "https://api.resend.com/emails");
  assert.deepEqual(JSON.parse(providerCalls[0].init.body), {
    from: "HR Hub <no-reply@hr.example>",
    to: [TO],
    subject: SUBJECT,
    text: TEXT,
  });
});
