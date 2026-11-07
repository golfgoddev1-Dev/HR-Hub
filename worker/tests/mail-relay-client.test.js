// Worker client for the Apps Script relay: https-only, script.google.com only,
// a token of at least 32 characters, and a bounded response read.
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_RESPONSE_BYTES,
  MAX_SUBJECT_LENGTH,
  MAX_TEXT_LENGTH,
  MIN_SECRET_LENGTH,
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
const TOKEN = "relay-token-0123456789abcdef0123456789";
const SCRIPT_URL = "https://script.google.com/macros/s/EXAMPLE_DEPLOYMENT_ID/exec";
const ECHO_URL = "https://script.googleusercontent.com/macros/echo?user_content_key=placeholder";
const ENV = { APPS_SCRIPT_URL: SCRIPT_URL, MAIL_RELAY_SECRET: TOKEN };

function message(overrides = {}) {
  return { to: TO, subject: SUBJECT, text: TEXT, ...overrides };
}

function fakeResponse({
  status = 200,
  text = '{"ok":true}',
  url = ECHO_URL,
  declaredLength = null,
  onRead,
} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: {
      get(name) {
        if (String(name).toLowerCase() !== "content-length") return null;
        return declaredLength === null ? null : String(declaredLength);
      },
    },
    async text() {
      if (onRead) onRead();
      return text;
    },
  };
}

function fakeFetch(options = {}) {
  const calls = [];
  return {
    calls,
    impl: async (url, init = {}) => {
      calls.push({ url: String(url), init });

      if (options.waitForAbort) {
        await new Promise((resolve) => {
          if (init.signal?.aborted) return resolve();
          init.signal?.addEventListener("abort", resolve, { once: true });
        });
        throw new Error("aborted");
      }
      if (options.throws) throw new Error("network down");

      const response = { ...options };
      delete response.throws;
      delete response.waitForAbort;
      if (response.body !== undefined && response.text === undefined) {
        response.text = JSON.stringify(response.body);
      }
      delete response.body;
      return fakeResponse(response);
    },
  };
}

test("a valid message is posted to the Apps Script deployment", async () => {
  const fake = fakeFetch({ body: { ok: true } });
  const result = await sendRelayEmail(ENV, { ...message(), fetchImpl: fake.impl });

  assert.deepEqual(result, { ok: true });
  assert.equal(fake.calls.length, 1);

  const [{ url, init }] = fake.calls;
  const target = new URL(url);
  assert.equal(target.protocol, "https:");
  assert.equal(target.hostname, "script.google.com");
  assert.equal(target.origin + target.pathname, SCRIPT_URL);
  assert.deepEqual([...target.searchParams.keys()], ["token"]);
  assert.equal(target.searchParams.get("token"), TOKEN);

  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "follow");
  assert.equal(init.headers[TOKEN_HEADER], TOKEN);
  assert.equal(init.headers["Content-Type"], "application/json");

  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), ["subject", "text", "to"]);
  assert.deepEqual(body, { to: TO, subject: SUBJECT, text: TEXT });
});

test("the token is encoded as one query parameter, never concatenated", async () => {
  const secret = "tok&en=va lue+plus" + "x".repeat(24);
  assert.ok(secret.length >= MIN_SECRET_LENGTH);

  const fake = fakeFetch();
  await sendRelayEmail(
    { APPS_SCRIPT_URL: SCRIPT_URL, MAIL_RELAY_SECRET: secret },
    { ...message(), fetchImpl: fake.impl }
  );

  const target = new URL(fake.calls[0].url);
  assert.deepEqual([...target.searchParams.keys()], ["token"]);
  assert.equal(target.searchParams.get("token"), secret);
  // The raw value is not spliced into the query, so its "&" cannot start a
  // second parameter and its "=" cannot break the pair.
  assert.equal(target.search.includes(secret), false);
  assert.equal((target.search.match(/&/g) || []).length, 0);
});

test("readRelayConfig requires https, the script host and a long secret", () => {
  const config = readRelayConfig(ENV);
  assert.equal(config.ok, true);
  assert.equal(new URL(config.url).hostname, "script.google.com");
  assert.equal(relayIsConfigured(ENV), true);
  assert.equal(relayIsConfigured({}), false);

  for (const env of [
    {},
    { MAIL_RELAY_SECRET: TOKEN },
    { APPS_SCRIPT_URL: SCRIPT_URL },
    { APPS_SCRIPT_URL: SCRIPT_URL, MAIL_RELAY_SECRET: TOKEN.slice(0, MIN_SECRET_LENGTH - 1) },
    { APPS_SCRIPT_URL: SCRIPT_URL, MAIL_RELAY_SECRET: " ".repeat(40) },
    { APPS_SCRIPT_URL: "http://script.google.com/macros/s/x/exec", MAIL_RELAY_SECRET: TOKEN },
    { APPS_SCRIPT_URL: "https://evil.example/macros/s/x/exec", MAIL_RELAY_SECRET: TOKEN },
    {
      APPS_SCRIPT_URL: "https://script.google.com.evil.example/macros/s/x/exec",
      MAIL_RELAY_SECRET: TOKEN,
    },
    {
      APPS_SCRIPT_URL: "https://script.googleusercontent.com/macros/s/x/exec",
      MAIL_RELAY_SECRET: TOKEN,
    },
    { APPS_SCRIPT_URL: "not a url", MAIL_RELAY_SECRET: TOKEN },
  ]) {
    assert.deepEqual(readRelayConfig(env), { ok: false, reason: "config" }, JSON.stringify(env));
  }
});

test("readRelayConfig drops parameters the URL already carried", () => {
  const config = readRelayConfig({
    APPS_SCRIPT_URL: `${SCRIPT_URL}?token=stale-value&extra=1`,
    MAIL_RELAY_SECRET: TOKEN,
  });
  assert.equal(config.ok, true);
  const target = new URL(config.url);
  assert.deepEqual([...target.searchParams.keys()], ["token"]);
  assert.equal(target.searchParams.get("token"), TOKEN);
});

test("bad configuration never reaches the network", async () => {
  const fake = fakeFetch();
  for (const env of [
    {},
    { APPS_SCRIPT_URL: SCRIPT_URL, MAIL_RELAY_SECRET: "too-short" },
    { APPS_SCRIPT_URL: "https://evil.example/exec", MAIL_RELAY_SECRET: TOKEN },
    { APPS_SCRIPT_URL: "http://script.google.com/macros/s/x/exec", MAIL_RELAY_SECRET: TOKEN },
  ]) {
    assert.deepEqual(
      await sendRelayEmail(env, { ...message(), fetchImpl: fake.impl }),
      { ok: false, reason: "config" },
      JSON.stringify(env)
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
    ["bad_request", "invalid"],
    ["unauthorized", "config"],
    ["disabled", "config"],
    ["config", "config"],
    ["recipient_not_allowed", "config"],
    ["rate_limited", "upstream"],
    ["quota", "upstream"],
    ["send_failed", "upstream"],
    ["something_new", "upstream"],
  ];

  for (const [code, reason] of cases) {
    const fake = fakeFetch({ body: { ok: false, code } });
    assert.deepEqual(
      await sendRelayEmail(ENV, { ...message(), fetchImpl: fake.impl }),
      { ok: false, reason },
      code
    );
  }

  // A body without a code is still an upstream fault, not an invalid message.
  const noCode = fakeFetch({ body: { ok: false } });
  assert.deepEqual(await sendRelayEmail(ENV, { ...message(), fetchImpl: noCode.impl }), {
    ok: false,
    reason: "upstream",
  });
});

test("a response that ends on an unexpected host is upstream, and its body is not read", async () => {
  let read = false;
  const fake = fakeFetch({
    url: "https://evil.example/echo",
    onRead: () => {
      read = true;
    },
  });

  assert.deepEqual(await sendRelayEmail(ENV, { ...message(), fetchImpl: fake.impl }), {
    ok: false,
    reason: "upstream",
  });
  assert.equal(read, false);
});

test("both Apps Script hosts are accepted as the final URL", async () => {
  for (const url of [
    `${SCRIPT_URL}?user_content_key=placeholder`,
    "https://script.googleusercontent.com/macros/echo?user_content_key=placeholder",
  ]) {
    const fake = fakeFetch({ url });
    assert.deepEqual(
      await sendRelayEmail(ENV, { ...message(), fetchImpl: fake.impl }),
      { ok: true },
      url
    );
  }
});

test("an oversized answer is upstream, and a declared oversize is not read", async () => {
  let declaredRead = false;
  const declared = fakeFetch({
    declaredLength: MAX_RESPONSE_BYTES + 1,
    onRead: () => {
      declaredRead = true;
    },
  });
  assert.deepEqual(await sendRelayEmail(ENV, { ...message(), fetchImpl: declared.impl }), {
    ok: false,
    reason: "upstream",
  });
  assert.equal(declaredRead, false);

  const actual = fakeFetch({ text: "x".repeat(MAX_RESPONSE_BYTES + 1) });
  assert.deepEqual(await sendRelayEmail(ENV, { ...message(), fetchImpl: actual.impl }), {
    ok: false,
    reason: "upstream",
  });
});

test("a non-JSON answer or a non-OK status is an upstream failure", async () => {
  const answers = [
    fakeFetch({ text: "<html>sign in</html>" }),
    fakeFetch({ text: "" }),
    fakeFetch({ status: 500, body: { ok: false, code: "quota" } }),
    fakeFetch({ status: 302, body: { ok: true } }),
    fakeFetch({ status: 404, body: { ok: true } }),
  ];

  for (const fake of answers) {
    assert.deepEqual(await sendRelayEmail(ENV, { ...message(), fetchImpl: fake.impl }), {
      ok: false,
      reason: "upstream",
    });
  }
});

test("a transport failure is a network failure, not a throw", async () => {
  const fake = fakeFetch({ throws: true });
  assert.deepEqual(await sendRelayEmail(ENV, { ...message(), fetchImpl: fake.impl }), {
    ok: false,
    reason: "network",
  });
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
      fakeFetch({ body: { ok: false, code: "recipient_not_allowed" } }),
      fakeFetch({ body: { ok: false, code: "rate_limited" } }),
      fakeFetch({ text: "not json" }),
      fakeFetch({ status: 500 }),
      fakeFetch({ url: "https://evil.example/echo" }),
      fakeFetch({ declaredLength: MAX_RESPONSE_BYTES + 1 }),
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
 * stand-ins, in doPost's order: kill switch, body checks, payload, token,
 * allowlist, caps, send. Code.gs itself cannot run under Node (it uses Apps
 * Script services), so this is the drift guard between the Worker client and the
 * relay's own rules.
 */
function mirrorDoPost({ event, properties, remainingDaily, send }) {
  if (!core.relayEnabled(properties.RELAY_ENABLED)) return core.failure("disabled");

  const postData = event?.postData;
  if (core.bodyTooLarge(postData?.contents, postData?.length)) {
    return core.failure("bad_request");
  }
  if (!core.isJsonContentType(postData?.type)) return core.failure("bad_request");

  let body;
  try {
    body = JSON.parse(postData.contents);
  } catch {
    return core.failure("bad_request");
  }

  const validation = core.validatePayload(body);
  if (!validation.ok) return validation;

  const token = core.verifyRequestToken({
    queryString: event.queryString,
    headers: event.headers,
    expected: properties.RELAY_TOKEN,
  });
  if (!token.ok) return token;

  const recipient = core.checkRecipientDomain(body.to, properties.ALLOWED_RECIPIENT_DOMAINS);
  if (!recipient.ok) return recipient;

  const counters = { minuteCount: 0, dayCount: 0 };
  const caps = core.checkCaps({
    ...counters,
    maxPerMinute: core.DEFAULT_MAX_PER_MINUTE,
    maxPerDay: core.DEFAULT_MAX_PER_DAY,
    remainingDaily,
    safetyMargin: core.DEFAULT_QUOTA_MARGIN,
  });
  if (!caps.ok) return caps;

  try {
    send({ to: body.to, subject: body.subject, body: body.text, name: "HR Hub" });
  } catch {
    return core.failure("send_failed");
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
      postData: { contents: init.body, type: "application/json", length: 512 },
      queryString: target.search.replace(/^\?/, ""),
      headers: init.headers,
    },
    properties: {
      RELAY_ENABLED: "true",
      RELAY_TOKEN: TOKEN,
      ALLOWED_RECIPIENT_DOMAINS: "example.com",
    },
    remainingDaily: 1500,
    send: (options) => sent.push(options),
  });

  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(sent, [{ to: TO, subject: SUBJECT, body: TEXT, name: "HR Hub" }]);
});

test("the relay refuses the same request when the kill switch is off", async () => {
  const client = fakeFetch();
  await sendRelayEmail(ENV, { ...message(), fetchImpl: client.impl });
  const [{ url, init }] = client.calls;
  const target = new URL(url);

  const sent = [];
  const event = {
    postData: { contents: init.body, type: "application/json" },
    queryString: target.search.replace(/^\?/, ""),
    headers: init.headers,
  };
  const properties = {
    RELAY_ENABLED: "false",
    RELAY_TOKEN: TOKEN,
    ALLOWED_RECIPIENT_DOMAINS: "example.com",
  };

  assert.deepEqual(
    mirrorDoPost({ event, properties, remainingDaily: 1500, send: (o) => sent.push(o) }),
    { ok: false, code: "disabled" }
  );
  assert.equal(sent.length, 0);
});

test("the relay refuses a recipient outside the allowlist", async () => {
  const client = fakeFetch();
  await sendRelayEmail(ENV, { ...message(), fetchImpl: client.impl });
  const [{ url, init }] = client.calls;
  const target = new URL(url);
  const sent = [];

  const outcome = mirrorDoPost({
    event: {
      postData: { contents: init.body, type: "application/json" },
      queryString: target.search.replace(/^\?/, ""),
      headers: init.headers,
    },
    properties: {
      RELAY_ENABLED: "true",
      RELAY_TOKEN: TOKEN,
      ALLOWED_RECIPIENT_DOMAINS: "company.co.th",
    },
    remainingDaily: 1500,
    send: (o) => sent.push(o),
  });

  assert.deepEqual(outcome, { ok: false, code: "recipient_not_allowed" });
  assert.equal(JSON.stringify(outcome).includes(TO), false);
  assert.equal(sent.length, 0);
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
