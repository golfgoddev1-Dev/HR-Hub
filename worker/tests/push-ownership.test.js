// A push subscription belongs to one browser and, at a time, one employee.
// Subscribing takes the endpoint from the session, a new login on the same
// browser takes the row over, logout deletes exactly that endpoint, and send
// only ever reads the recipient's rows. A 404/410 removes the dead row.
//
// The database and the push service are a fake fetch: no network, no personal
// data, no key or endpoint written to a log.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";
import { bytesToBase64Url } from "../src/push/base64url.js";
import { runNotificationQueue } from "../src/push/queue.js";

const TOKEN_A = "a".repeat(43);
const TOKEN_B = "b".repeat(43);
const EMPLOYEE_A = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_B = "22222222-2222-4222-8222-222222222222";

const ENDPOINT = "https://push.example.net/send/abc";
// RFC 8291 Appendix A keys, used as shape-valid subscription values only.
const P256DH =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const AUTH = "BTBZMqHH6r4Tts7J_aSIgg";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  VAPID_PUBLIC_KEY: "fake-public-key",
  VAPID_PRIVATE_KEY: "fake-private-key",
  VAPID_SUBJECT: "mailto:test@example.com",
};

const NOW = new Date("2026-11-05T10:00:00.000Z");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tableOf(url) {
  return new URL(url).pathname.split("/").pop();
}

function paramsOf(url) {
  return new URL(url).searchParams;
}

function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "offset", "or", "on_conflict", "like"].includes(key)) {
      continue;
    }
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (String(row[key] ?? "") !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("lte.")) {
      const left = Date.parse(String(row[key] ?? ""));
      const right = Date.parse(value.slice(4));
      if (!Number.isFinite(left) || !Number.isFinite(right) || !(left <= right)) return false;
      continue;
    }
    if (value.startsWith("in.(")) {
      const list = value.slice(4, -1).split(",").map((entry) => decodeURIComponent(entry));
      if (!list.includes(String(row[key] ?? ""))) return false;
      continue;
    }
  }
  return true;
}

async function createBackend({
  existing = null,
  subscriptions = [],
  queue = [],
  pushStatus = 410,
} = {}) {
  const now = new Date();
  const future = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
  const session = async (token, employeeId) => ({
    id: `session-${employeeId}`,
    token_hash: await sha256Hex(token),
    employee_id: employeeId,
    login_role: "employee",
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: future,
  });

  const state = {
    auth_sessions: [await session(TOKEN_A, EMPLOYEE_A), await session(TOKEN_B, EMPLOYEE_B)],
    employees: [
      { id: EMPLOYEE_A, full_name: "A", is_active: true },
      { id: EMPLOYEE_B, full_name: "B", is_active: true },
    ],
    employee_credentials: [],
    hr_admins: [],
    meeting_admins: [],
    system_admins: [],
    employee_approvers: [],
    department_approvers: [],
    push_subscriptions: existing ? [existing] : subscriptions,
    notification_queue: queue,
    audit_logs: [],
  };

  const calls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("https://push.example.net/")) {
      return new Response(null, { status: pushStatus });
    }

    const method = (init.method ?? "GET").toUpperCase();
    const table = tableOf(url);
    const params = paramsOf(url);
    const prefer = String(init.headers?.Prefer ?? "");
    calls.push({ url, method, table });

    if (method === "GET") {
      return jsonResponse((state[table] ?? []).filter((row) => matches(params, row)));
    }

    if (method === "POST") {
      const body = init.body ? JSON.parse(init.body) : null;
      state[table] = state[table] ?? [];
      if (table === "push_subscriptions") {
        const row = { id: `sub-${state[table].length}`, ...body };
        state[table].push(row);
        return jsonResponse([row], 201);
      }
      return new Response(null, { status: 201 });
    }

    if (method === "PATCH") {
      const patch = init.body ? JSON.parse(init.body) : {};
      const updated = (state[table] ?? []).filter((row) => matches(params, row));
      for (const row of updated) Object.assign(row, patch);
      return prefer.includes("return=representation")
        ? jsonResponse(updated)
        : new Response(null, { status: 204 });
    }

    if (method === "DELETE") {
      const removed = (state[table] ?? []).filter((row) => matches(params, row));
      state[table] = (state[table] ?? []).filter((row) => !matches(params, row));
      return jsonResponse(removed);
    }

    return new Response(null, { status: 204 });
  };

  return {
    state,
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function post(path, token, body) {
  return app.request(
    `https://fake.local${path}`,
    {
      method: "POST",
      headers: {
        Cookie: `hr_session=${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    ENV
  );
}

function subscribe(token, body) {
  return post("/api/notifications/subscribe", token, body);
}

function validBody() {
  return { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } };
}

test("the subscribe body cannot choose the employee; the session decides", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await subscribe(TOKEN_A, { ...validBody(), employeeId: EMPLOYEE_B });

  assert.equal(response.status, 201);
  assert.equal(fake.state.push_subscriptions.length, 1);
  assert.equal(fake.state.push_subscriptions[0].employee_id, EMPLOYEE_A);
});

test("a new login on the same endpoint moves the row to the new employee", async (t) => {
  const fake = await createBackend({
    existing: {
      id: "sub-1",
      employee_id: EMPLOYEE_A,
      endpoint: ENDPOINT,
      p256dh: P256DH,
      auth: AUTH,
      is_active: true,
    },
  });
  t.after(() => fake.restore());

  const response = await subscribe(TOKEN_B, validBody());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.reinstated, true);
  assert.equal(fake.state.push_subscriptions.length, 1);
  assert.equal(fake.state.push_subscriptions[0].employee_id, EMPLOYEE_B);

  const patch = fake.calls.find(
    (call) => call.table === "push_subscriptions" && call.method === "PATCH"
  );
  assert.equal(paramsOf(patch.url).get("id"), "eq.sub-1");
});

test("logout deletes the subscription for that endpoint and employee", async (t) => {
  const fake = await createBackend({
    subscriptions: [
      {
        id: "sub-1",
        employee_id: EMPLOYEE_A,
        endpoint: ENDPOINT,
        p256dh: P256DH,
        auth: AUTH,
        is_active: true,
      },
    ],
  });
  t.after(() => fake.restore());

  const response = await post("/api/auth/logout", TOKEN_A, { endpoint: ENDPOINT });

  assert.equal(response.status, 200);
  assert.equal(fake.state.push_subscriptions.length, 0);

  const remove = fake.calls.find(
    (call) => call.table === "push_subscriptions" && call.method === "DELETE"
  );
  const params = paramsOf(remove.url);
  assert.equal(params.get("endpoint"), `eq.${ENDPOINT}`);
  assert.equal(params.get("employee_id"), `eq.${EMPLOYEE_A}`);
});

test("send reads only the recipient employee's subscriptions", async (t) => {
  const fake = await createBackend({
    queue: [
      {
        id: "queue-1",
        employee_id: EMPLOYEE_A,
        leave_request_id: null,
        kind: "leave_submitted",
        payload: { title: "x", body: "y", url: "/leave/approvals" },
        status: "pending",
        attempts: 0,
        next_attempt_at: NOW.toISOString(),
      },
    ],
  });
  t.after(() => fake.restore());

  await runNotificationQueue(ENV, NOW);

  const reads = fake.calls.filter(
    (call) =>
      call.table === "push_subscriptions" &&
      call.method === "GET" &&
      paramsOf(call.url).has("employee_id")
  );
  assert.ok(reads.length > 0);
  for (const read of reads) {
    const params = paramsOf(read.url);
    assert.equal(params.get("employee_id"), `eq.${EMPLOYEE_A}`);
    assert.equal(params.get("is_active"), "eq.true");
    assert.equal(read.url.includes(EMPLOYEE_B), false);
  }
});

test("a 410 from the push service deletes the subscription row", async (t) => {
  // Real P-256 keys, so the request reaches the fake push service instead of
  // failing during encryption.
  const vapidPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"]
  );
  const vapidPublic = new Uint8Array(await crypto.subtle.exportKey("raw", vapidPair.publicKey));
  const vapidJwk = await crypto.subtle.exportKey("jwk", vapidPair.privateKey);

  const uaPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", uaPair.publicKey));
  const auth = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));

  const env = {
    ...ENV,
    VAPID_PUBLIC_KEY: bytesToBase64Url(vapidPublic),
    VAPID_PRIVATE_KEY: vapidJwk.d,
    VAPID_SUBJECT: "mailto:test@example.com",
  };

  const fake = await createBackend({
    queue: [
      {
        id: "queue-1",
        employee_id: EMPLOYEE_A,
        leave_request_id: null,
        kind: "leave_submitted",
        payload: { title: "x", body: "y", url: "/leave/approvals" },
        status: "pending",
        attempts: 0,
        next_attempt_at: NOW.toISOString(),
      },
    ],
    subscriptions: [
      {
        id: "sub-1",
        employee_id: EMPLOYEE_A,
        endpoint: "https://push.example.net/gone",
        p256dh: bytesToBase64Url(uaPublic),
        auth,
        is_active: true,
      },
    ],
    pushStatus: 410,
  });
  t.after(() => fake.restore());

  const summary = await runNotificationQueue(env, NOW);

  assert.equal(summary.deactivated, 1);
  assert.equal(fake.state.push_subscriptions.length, 0);

  const remove = fake.calls.find(
    (call) => call.table === "push_subscriptions" && call.method === "DELETE"
  );
  assert.ok(remove);
  assert.equal(paramsOf(remove.url).get("employee_id"), `eq.${EMPLOYEE_A}`);
});
