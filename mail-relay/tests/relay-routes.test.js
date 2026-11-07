// Relay route tests. The provider is a fake fetch, so nothing leaves the test:
// no real email is sent and no provider key is used.
import test from "node:test";
import assert from "node:assert/strict";

import relayWorker from "../src/app.js";
import { MAX_BODY_BYTES, MAX_TEXT_LENGTH } from "../src/message.js";

const SECRET = "relay-shared-secret";
const PROVIDER_KEY = "provider-key-for-test";
const FROM = "HR Hub <no-reply@hr.example>";

const ENV = {
  MAIL_RELAY_SECRET: SECRET,
  RESEND_API_KEY: PROVIDER_KEY,
  MAIL_FROM: FROM,
};

const MESSAGE = {
  to: "approver@example.com",
  subject: "HR Hub: มีใบลารออนุมัติ",
  text: "มีใบลารออนุมัติ\n\nพนักงาน: ทดสอบ ระบบ\nลิงก์: https://hr.example/approve/token",
};

function requestFor({
  body = MESSAGE,
  token = SECRET,
  method = "POST",
  contentType = "application/json",
  path = "/send",
} = {}) {
  const headers = {};
  if (contentType !== null) headers["Content-Type"] = contentType;
  if (token !== null) headers.Authorization = `Bearer ${token}`;

  const init = { method, headers };
  if (body !== null && method !== "GET") {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new Request(`https://relay.example${path}`, init);
}

function stubProvider({ status = 200, throws = false, body } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
    if (throws) throw new Error("provider unreachable");
    return new Response(
      body === undefined ? JSON.stringify({ id: "provider-message-id" }) : body,
      { status, headers: { "Content-Type": "application/json" } }
    );
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** Runs `fn` with console silenced, so a failure log does not pollute the run. */
async function quietly(fn) {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

test("a valid message is forwarded to the provider as plain text only", async (t) => {
  const provider = stubProvider();
  t.after(() => provider.restore());

  const response = await relayWorker.fetch(requestFor(), ENV);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true });

  assert.equal(provider.calls.length, 1);
  const [call] = provider.calls;
  assert.equal(call.url, "https://api.resend.com/emails");
  assert.equal(call.method, "POST");
  assert.equal(call.headers.Authorization, `Bearer ${PROVIDER_KEY}`);

  const payload = JSON.parse(call.body);
  assert.deepEqual(payload, {
    from: FROM,
    to: [MESSAGE.to],
    subject: MESSAGE.subject,
    text: MESSAGE.text,
  });
  for (const forbidden of ["html", "cc", "bcc", "attachments", "headers", "reply_to", "textHtml"]) {
    assert.equal(forbidden in payload, false, forbidden);
  }
});

test("a missing, empty or wrong shared secret is refused and nothing is sent", async (t) => {
  const provider = stubProvider();
  t.after(() => provider.restore());

  for (const token of [null, "", "wrong-secret", `${SECRET}x`, ` ${SECRET}`]) {
    const response = await relayWorker.fetch(requestFor({ token }), ENV);
    assert.equal(response.status, 401, String(token));
    assert.deepEqual(await response.json(), { ok: false, code: "unauthorized" });
  }
  assert.equal(provider.calls.length, 0);
});

test("a relay without its own secret fails closed", async (t) => {
  const provider = stubProvider();
  t.after(() => provider.restore());

  const response = await relayWorker.fetch(requestFor(), {
    RESEND_API_KEY: PROVIDER_KEY,
    MAIL_FROM: FROM,
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, code: "not_configured" });
  assert.equal(provider.calls.length, 0);
});

test("a missing provider configuration is reported only to an authenticated caller", async (t) => {
  const provider = stubProvider();
  t.after(() => provider.restore());

  for (const env of [
    { MAIL_RELAY_SECRET: SECRET, MAIL_FROM: FROM },
    { MAIL_RELAY_SECRET: SECRET, RESEND_API_KEY: PROVIDER_KEY },
    { MAIL_RELAY_SECRET: SECRET, RESEND_API_KEY: "   ", MAIL_FROM: FROM },
    { MAIL_RELAY_SECRET: SECRET, RESEND_API_KEY: PROVIDER_KEY, MAIL_FROM: "" },
  ]) {
    const response = await relayWorker.fetch(requestFor(), env);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, code: "not_configured" });
  }
  assert.equal(provider.calls.length, 0);

  // An anonymous caller learns nothing about the configuration.
  const anonymous = await relayWorker.fetch(
    requestFor({ token: null }),
    { MAIL_RELAY_SECRET: SECRET, RESEND_API_KEY: PROVIDER_KEY, MAIL_FROM: FROM }
  );
  assert.equal(anonymous.status, 401);
});

test("an html field is rejected instead of ignored", async (t) => {
  const provider = stubProvider();
  t.after(() => provider.restore());

  const response = await relayWorker.fetch(
    requestFor({ body: { ...MESSAGE, html: "<b>click</b>" } }),
    ENV
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, code: "invalid_message" });
  assert.equal(provider.calls.length, 0);
});

test("malformed messages are refused with one generic code", async (t) => {
  const provider = stubProvider();
  t.after(() => provider.restore());

  const bodies = [
    { ...MESSAGE, to: ["a@b.co", "c@d.co"] },
    { ...MESSAGE, to: "a@b.co\r\nBcc: c@d.co" },
    { ...MESSAGE, subject: "subject\nBcc: c@d.co" },
    { ...MESSAGE, subject: "s".repeat(201) },
    { ...MESSAGE, subject: "  padded  " },
    { ...MESSAGE, text: "" },
    { ...MESSAGE, text: "   " },
    { ...MESSAGE, text: "x".repeat(MAX_TEXT_LENGTH + 1) },
    { ...MESSAGE, extra: "x" },
    { to: MESSAGE.to },
    [],
    "not json",
    "{",
  ];

  for (const body of bodies) {
    const response = await relayWorker.fetch(requestFor({ body }), ENV);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 40));
    assert.deepEqual(await response.json(), { ok: false, code: "invalid_message" });
  }
  assert.equal(provider.calls.length, 0);
});

test("only POST /send with a JSON content type is routed", async () => {
  const get = await relayWorker.fetch(requestFor({ method: "GET", body: null }), ENV);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("Allow"), "POST");
  assert.deepEqual(await get.json(), { ok: false, code: "method_not_allowed" });

  const wrongPath = await relayWorker.fetch(requestFor({ path: "/other" }), ENV);
  assert.equal(wrongPath.status, 404);
  assert.deepEqual(await wrongPath.json(), { ok: false, code: "not_found" });

  const form = await relayWorker.fetch(
    requestFor({ contentType: "application/x-www-form-urlencoded" }),
    ENV
  );
  assert.equal(form.status, 415);
  assert.deepEqual(await form.json(), { ok: false, code: "unsupported_media_type" });
});

test("an oversized body is refused before validation", async (t) => {
  const provider = stubProvider();
  t.after(() => provider.restore());

  const huge = JSON.stringify({ ...MESSAGE, text: "x".repeat(MAX_BODY_BYTES) });
  const response = await relayWorker.fetch(requestFor({ body: huge }), ENV);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { ok: false, code: "too_large" });
  assert.equal(provider.calls.length, 0);
});

test("provider statuses map to a retryable or a permanent code without echoing detail", async (t) => {
  const cases = [
    [429, 503, "upstream_busy"],
    [500, 503, "upstream_busy"],
    [503, 503, "upstream_busy"],
    [400, 502, "send_failed"],
    [401, 502, "send_failed"],
    [422, 502, "send_failed"],
  ];

  for (const [providerStatus, status, code] of cases) {
    const provider = stubProvider({
      status: providerStatus,
      body: JSON.stringify({
        message: `recipient ${MESSAGE.to} refused`,
        secret: PROVIDER_KEY,
      }),
    });
    try {
      const response = await quietly(() => relayWorker.fetch(requestFor(), ENV));
      assert.equal(response.status, status, `provider ${providerStatus}`);
      const body = await response.json();
      assert.deepEqual(body, { ok: false, code });
      const raw = JSON.stringify(body);
      assert.equal(raw.includes(MESSAGE.to), false);
      assert.equal(raw.includes(PROVIDER_KEY), false);
    } finally {
      provider.restore();
    }
  }
});

test("a provider transport failure is retryable", async (t) => {
  const provider = stubProvider({ throws: true });
  t.after(() => provider.restore());

  const response = await quietly(() => relayWorker.fetch(requestFor(), ENV));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, code: "upstream_busy" });
});

test("every response is no-store, nosniff and no-referrer", async (t) => {
  const provider = stubProvider();
  t.after(() => provider.restore());

  const responses = [
    await relayWorker.fetch(requestFor(), ENV),
    await relayWorker.fetch(requestFor({ token: "wrong" }), ENV),
    await relayWorker.fetch(requestFor({ path: "/nope" }), ENV),
    await relayWorker.fetch(requestFor({ method: "GET", body: null }), ENV),
  ];

  for (const response of responses) {
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  }
});

test("a failed send logs a code but never the recipient, subject, body or secrets", async (t) => {
  const provider = stubProvider({ throws: true });
  t.after(() => provider.restore());

  const lines = [];
  const originals = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  };
  for (const name of Object.keys(originals)) {
    console[name] = (...args) =>
      lines.push(
        args
          .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
          .join(" ")
      );
  }

  try {
    await relayWorker.fetch(requestFor(), ENV);
  } finally {
    for (const [name, fn] of Object.entries(originals)) console[name] = fn;
  }

  // The failure is still visible as a code, just without any message content.
  assert.ok(lines.length > 0);
  const logged = lines.join("\n");
  for (const secret of [
    MESSAGE.to,
    MESSAGE.subject,
    "มีใบลารออนุมัติ",
    "พนักงาน: ทดสอบ ระบบ",
    SECRET,
    PROVIDER_KEY,
    FROM,
    "Bearer",
  ]) {
    assert.equal(logged.includes(secret), false, secret);
  }
});
