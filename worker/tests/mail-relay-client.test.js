// Client for the Apps Script mail relay. The Worker knows the deployment URL and
// the shared token; the company Workspace account sends the mail. Nothing here
// may log the URL, token, recipient, subject or body.
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SUBJECT_LENGTH,
  MAX_TEXT_LENGTH,
  TOKEN_HEADER,
  readRelayConfig,
  relayIsConfigured,
  sendRelayEmail,
  validateOutgoingMessage,
} from "../src/email/relay.js";

// relay-core.js publishes one global instead of ES exports, so the identical
// file can be pasted into Apps Script, which has no module system.
import "../../mail-relay/relay-core.js";

const core = globalThis.RelayCore;

const TO = "approver@example.com";
const SUBJECT = "HR Hub: มีใบลารออนุมัติ";
const TEXT = "รายละเอียดใบลา\nลิงก์: https://hr.example/approve/token";
const TOKEN = "relay-token-value";
const SCRIPT_URL = "https://script.google.com/macros/s/EXAMPLE_DEPLOYMENT_ID/exec";

const ENV = { APPS_SCRIPT_URL: SCRIPT_URL, MAIL_RELAY_SECRET: TOKEN };

function fakeFetch({ status = 200, body = { ok: true }, raw = null, throws = false, waitForAbort = false } = {}) {
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
      return new Response(raw !== null ? raw : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
}

function message(overrides = {}) {
  return { to: TO, subject: SUBJECT, text: TEXT, ...overrides };
}

test("a valid message is posted to the Apps Script deployment", async () => {
  const fake = fakeFetch();
  const result = await sendRelayEmail(ENV, {
    ...message(),
    fetchImpl: fake.impl,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(fake.calls.length, 1);

  const [{ url, init }] = fake.calls;
  const target = new URL(url);
  assert.equal(target.protocol, "https:");
  assert.equal(
    target.origin + target.pathname,
    "https://script.google.com/macros/s/EXAMPLE_DEPLOYMENT_ID/exec"
  );
  // Apps Script cannot read request headers, so the token is also in the query.
  assert.equal(target.searchParams.get("token"), TOKEN);

  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "follow");
  assert.equal(init.headers[TOKEN_HEADER], TOKEN);
  assert.equal(init.headers["Content-Type"], "application/json");

  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), ["subject", "text", "to"]);
  assert.deepEqual(body, { to: TO, subject: SUBJECT, text: TEXT });
});

test("readRelayConfig requires both values and appends the token", () => {
  const config = readRelayConfig(ENV);
  assert.equal(config.ok, true);
  assert.equal(config.secret, TOKEN);
  assert.equal(new URL(config.url).searchParams.get("token"), TOKEN);
  assert.equal(relayIsConfigured(ENV), true);
  assert.equal(relayIsConfigured({}), false);

  // A stale token already in the URL is replaced, so rotation is one-sided.
  const replaced = readRelayConfig({
    APPS_SCRIPT_URL: `${SCRIPT_URL}?token=stale-value`,
    MAIL_RELAY_SECRET: TOKEN,
  });
  assert.equal(new URL(replaced.url).searchParams.get("token"), TOKEN);
});

test("missing configuration never reaches the network", async () => {
  const fake = fakeFetch();
  for (const env of [
    {},
    { MAIL_RELAY_SECRET: TOKEN },
    { APPS_SCRIPT_URL: SCRIPT_URL },
    { APPS_SCRIPT_URL: SCRIPT_URL, MAIL_RELAY_SECRET: "   " },
    { APPS_SCRIPT_URL: "   ", MAIL_RELAY_SECRET: TOKEN },
  ]) {
    assert.deepEqual(
      await sendRelayEmail(env, { ...message(), fetchImpl: fake.impl }),
      { ok: false, reason: "config" },
      JSON.stringify(env)
    );
  }
  assert.equal(fake.calls.length, 0);
});

test("a non-https deployment URL is refused", async () => {
  const fake = fakeFetch();
  for (const url of [
    "http://script.google.com/macros/s/x/exec",
    "http://127.0.0.1:8788/send",
    "ftp://script.google.com/macros/s/x/exec",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.deepEqual(
      await sendRelayEmail(
        { APPS_SCRIPT_URL: url, MAIL_RELAY_SECRET: TOKEN },
        { ...message(), fetchImpl: fake.impl }
      ),
      { ok: false, reason: "config" },
      url
    );
  }
  assert.equal(fake.calls.length, 0);
});

test("an invalid message is refused before any request", async () => {
  const fake = fakeFetch();
  const cases = [
    { to: "" },
    { to: "not-an-email" },
    { to: "a@b.co,c@d.co" },
    { to: "a@b.co\r\nBcc: x@y.z" },
    { subject: "" },
    { subject: "   " },
    { subject: "subject\nBcc: x@y.z" },
    { subject: "subject\u0000" },
    { subject: "s".repeat(MAX_SUBJECT_LENGTH + 1) },
    { text: "" },
    { text: "   " },
    { text: "x".repeat(MAX_TEXT_LENGTH + 1) },
  ];

  for (const override of cases) {
    assert.deepEqual(
      await sendRelayEmail(ENV, { ...message(override), fetchImpl: fake.impl }),
      { ok: false, reason: "invalid" },
      JSON.stringify(override).slice(0, 40)
    );
  }
  assert.equal(fake.calls.length, 0);
});

test("relay answer codes map to retry or permanent decisions", async () => {
  const cases = [
    [{ ok: false, code: "unauthorized" }, { ok: false, reason: "config" }],
    [{ ok: false, code: "quota" }, { ok: false, reason: "upstream" }],
    [{ ok: false, code: "send_failed" }, { ok: false, reason: "upstream" }],
    [{ ok: false, code: "bad_request" }, { ok: false, reason: "invalid" }],
    [{ ok: false }, { ok: false, reason: "upstream" }],
    [{ ok: false, code: "something_new" }, { ok: false, reason: "upstream" }],
    [{ ok: true }, { ok: true }],
  ];

  for (const [body, expected] of cases) {
    const fake = fakeFetch({ body });
    assert.deepEqual(
      await sendRelayEmail(ENV, { ...message(), fetchImpl: fake.impl }),
      expected,
      JSON.stringify(body)
    );
  }
});

test("a non-JSON answer or a non-OK status is an upstream failure", async () => {
  const answers = [
    fakeFetch({ raw: "<html>sign in</html>" }),
    fakeFetch({ raw: "" }),
    fakeFetch({ status: 500, body: { ok: false, code: "quota" } }),
    fakeFetch({ status: 302, body: { ok: true } }),
    fakeFetch({ status: 404, body: { ok: true } }),
  ];

  for (const fake of answers) {
    assert.deepEqual(
      await sendRelayEmail(ENV, { ...message(), fetchImpl: fake.impl }),
      { ok: false, reason: "upstream" }
    );
  }
});

test("a transport failure is a network failure, not a throw", async () => {
  const fake = fakeFetch({ throws: true });
  assert.deepEqual(
    await sendRelayEmail(ENV, { ...message(), fetchImpl: fake.impl }),
    { ok: false, reason: "network" }
  );
});

test("a slow relay is aborted at the timeout", async () => {
  const fake = fakeFetch({ waitForAbort: true });
  const result = await sendRelayEmail(ENV, {
    ...message(),
    fetchImpl: fake.impl,
    timeoutMs: 20,
  });

  assert.deepEqual(result, { ok: false, reason: "network" });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].init.signal.aborted, true);
});

test("nothing about the message or configuration is logged", async () => {
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
    for (const fake of [
      fakeFetch({ throws: true }),
      fakeFetch({ body: { ok: false, code: "unauthorized" } }),
      fakeFetch({ raw: "not json" }),
      fakeFetch({ status: 500 }),
      fakeFetch({ body: { ok: false, code: "send_failed" } }),
      fakeFetch(),
    ]) {
      await sendRelayEmail(ENV, { ...message(), fetchImpl: fake.impl });
    }
  } finally {
    for (const [name, fn] of Object.entries(originals)) console[name] = fn;
  }

  const logged = lines.join("\n");
  for (const secret of [TO, SUBJECT, TEXT, TOKEN, SCRIPT_URL, "approve/token"]) {
    assert.equal(logged.includes(secret), false, secret);
  }
});

/**
 * Mirrors mail-relay/Code.gs using only relay-core plus injected Apps Script
 * stand-ins, in doPost's order: parse, validate, token, quota, send. Code.gs
 * itself cannot run under Node (it uses Apps Script services), so this is the
 * drift guard between the Worker client and the relay's rules.
 */
function mirrorDoPost({ event, expectedToken, remainingDaily, send }) {
  const contents = event?.postData?.contents;
  if (typeof contents !== "string" || contents.length === 0) {
    return { ok: false, code: "bad_request" };
  }

  let body;
  try {
    body = JSON.parse(contents);
  } catch {
    return { ok: false, code: "bad_request" };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "bad_request" };
  }

  const validation = core.validatePayload(body);
  if (!validation.ok) return validation;

  const provided = event.headers?.[TOKEN_HEADER] ?? event.parameter?.token ?? null;
  if (!core.checkToken(provided, expectedToken)) {
    return { ok: false, code: "unauthorized" };
  }

  if (core.decideQuota(remainingDaily) !== "send") return { ok: false, code: "quota" };

  try {
    send({ to: body.to, subject: body.subject, body: body.text, name: "HR Hub" });
  } catch {
    return { ok: false, code: "send_failed" };
  }
  return { ok: true };
}

test("the relay accepts the exact request this client builds", async () => {
  // 1. Capture the request instead of sending it.
  const client = fakeFetch();
  assert.deepEqual(await sendRelayEmail(ENV, { ...message(), fetchImpl: client.impl }), {
    ok: true,
  });
  const [{ url, init }] = client.calls;
  const target = new URL(url);

  // 2. Feed that request through the relay logic with fake MailApp and quota.
  const sent = [];
  const outcome = mirrorDoPost({
    event: {
      postData: { contents: init.body, type: "application/json" },
      parameter: { token: target.searchParams.get("token") },
      headers: init.headers,
    },
    expectedToken: TOKEN,
    remainingDaily: 1500,
    send: (options) => sent.push(options),
  });

  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(sent, [{ to: TO, subject: SUBJECT, body: TEXT, name: "HR Hub" }]);
});

test("the client refuses nothing the relay would accept, and vice versa", () => {
  // Only the three message fields are compared: the client rebuilds the body as
  // exactly { to, subject, text }, so an extra option key such as `html` can
  // never reach the relay in the first place. The relay's own rejection of extra
  // keys is covered by mail-relay/tests/relay-core.test.js.
  const messages = [
    message(),
    message({ to: "" }),
    message({ to: "not-an-email" }),
    message({ to: "a@b.co,c@d.co" }),
    message({ to: "a@b.co\r\nBcc: x@y.z" }),
    message({ subject: "s".repeat(MAX_SUBJECT_LENGTH) }),
    message({ subject: "s".repeat(MAX_SUBJECT_LENGTH + 1) }),
    message({ subject: "a\nb" }),
    message({ subject: "  padded  " }),
    message({ subject: "a\u0000b" }),
    message({ text: "ก".repeat(MAX_TEXT_LENGTH) }),
    message({ text: "ก".repeat(MAX_TEXT_LENGTH + 1) }),
    message({ text: "  " }),
    { to: TO, subject: SUBJECT },
    null,
  ];

  for (const candidate of messages) {
    const clientAccepts = validateOutgoingMessage(candidate) !== null;
    const relayAccepts = candidate !== null && core.validatePayload(candidate).ok === true;
    assert.equal(
      clientAccepts,
      relayAccepts,
      JSON.stringify(candidate)?.slice(0, 60)
    );
  }
});
