// A signed-out approver keeps one browser row and receives only a generic
// pending count. This suite covers logout keep/delete, the generic send, its
// own-count scope, the 60-minute throttle, reassignment on a new login, and
// 404/410 cleanup. The database and push service are a fake fetch; no real
// endpoint, key or personal data appears here.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";
import { bytesToBase64Url } from "../src/push/base64url.js";
import { buildSignedOutPendingPayload } from "../src/push/payload.js";
import { runNotificationQueue } from "../src/push/queue.js";

const TOKEN_A = "a".repeat(43);
const TOKEN_B = "b".repeat(43);
const APPROVER_A = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_B = "22222222-2222-4222-8222-222222222222";
const EMPLOYEE_C = "33333333-3333-4333-8333-333333333333";
const ENDPOINT = "https://push.example.net/signed-out";

const PIN_PEPPER = "test-pin-pepper";
const NATIONAL_ID_PEPPER = "test-national-pepper";
const NATIONAL_ID = "1234567890123";
const PIN = "246813";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  NATIONAL_ID_PEPPER,
  PIN_PEPPER,
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
    }
  }
  return true;
}

async function session(token, employeeId) {
  return {
    id: `session-${employeeId}`,
    token_hash: await sha256Hex(token),
    employee_id: employeeId,
    login_role: "employee",
    revoked_at: null,
    last_active_at: NOW.toISOString(),
    expires_at: new Date(NOW.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  };
}

function employee(id, overrides = {}) {
  return {
    id,
    employee_code: `EMP-${id.slice(0, 3)}`,
    full_name: `พนักงาน ${id.slice(0, 3)}`,
    department_id: null,
    is_active: true,
    notify_pending_on_logout: true,
    notifications_enabled: true,
    pending_notice_at: null,
    ...overrides,
  };
}

function pendingRequest(id, approverId, employeeId = EMPLOYEE_B, status = "pending") {
  return {
    id,
    request_code: `LV-${id}`,
    employee_id: employeeId,
    approver_id: approverId,
    leave_type_id: "type-1",
    status,
    start_date: "2026-11-10",
    end_date: "2026-11-10",
    reason: "private reason",
    created_at: NOW.toISOString(),
  };
}

async function createBackend({
  employees = [employee(APPROVER_A), employee(EMPLOYEE_B), employee(EMPLOYEE_C)],
  subscriptions = [],
  queue = [],
  requests = [],
  approvers = [
    { id: "ea-1", employee_id: EMPLOYEE_B, approver_id: APPROVER_A, priority: 1, is_active: true },
  ],
  pushStatus = 201,
  credentials = [],
} = {}) {
  const state = {
    auth_sessions: [await session(TOKEN_A, APPROVER_A), await session(TOKEN_B, EMPLOYEE_B)],
    employees,
    employee_credentials: credentials,
    employee_approvers: approvers,
    department_approvers: [],
    leave_requests: requests,
    push_subscriptions: subscriptions,
    notification_queue: queue,
    audit_logs: [],
  };

  const calls = [];
  const pushCalls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("https://push.example.net/")) {
      pushCalls.push({ url, init });
      return new Response(null, { status: pushStatus });
    }

    const method = (init.method ?? "GET").toUpperCase();
    const table = tableOf(url);
    const params = paramsOf(url);
    const prefer = String(init.headers?.Prefer ?? "");
    calls.push({ url, method, table });

    if (method === "HEAD") {
      const count = (state[table] ?? []).filter((row) => matches(params, row)).length;
      return new Response(null, {
        status: 200,
        headers: { "Content-Range": `0-0/${count}` },
      });
    }

    if (method === "GET") {
      return jsonResponse((state[table] ?? []).filter((row) => matches(params, row)));
    }

    if (method === "POST") {
      const body = init.body ? JSON.parse(init.body) : null;
      const rows = Array.isArray(body) ? body : [body];
      const stored = rows.map((row) => ({
        ...row,
        id: row.id ?? `${table}-${(state[table] ?? []).length}`,
      }));
      state[table] = state[table] ?? [];
      state[table].push(...stored);
      return prefer.includes("return=representation")
        ? jsonResponse(stored, 201)
        : new Response(null, { status: 201 });
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
    pushCalls,
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
      headers: { Cookie: `hr_session=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    ENV
  );
}

function logout(token = TOKEN_A, endpoint = ENDPOINT) {
  return post("/api/auth/logout", token, { endpoint });
}

function subscription(overrides = {}) {
  return {
    id: "sub-1",
    employee_id: APPROVER_A,
    endpoint: ENDPOINT,
    p256dh: "AAAA",
    auth: "BBBB",
    is_active: true,
    signed_out: true,
    signed_out_at: NOW.toISOString(),
    ...overrides,
  };
}

async function pushKeys() {
  const vapidPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
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

  return {
    env: {
      ...ENV,
      VAPID_PUBLIC_KEY: bytesToBase64Url(vapidPublic),
      VAPID_PRIVATE_KEY: vapidJwk.d,
      VAPID_SUBJECT: "mailto:test@example.com",
    },
    subscription: subscription({
      p256dh: bytesToBase64Url(uaPublic),
      auth,
    }),
  };
}

test("an approver who opted in keeps the row marked signed out on logout", async (t) => {
  const fake = await createBackend({ subscriptions: [subscription({ signed_out: false })] });
  t.after(() => fake.restore());

  const response = await logout();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.keepPushSubscription, true);
  // "storage" would unregister the service worker and drop the kept push.
  assert.equal(response.headers.get("Clear-Site-Data"), '"cache", "cookies"');
  assert.equal(fake.state.push_subscriptions.length, 1);
  assert.equal(fake.state.push_subscriptions[0].signed_out, true);
  assert.equal(typeof fake.state.push_subscriptions[0].signed_out_at, "string");
  assert.equal(
    fake.calls.some((call) => call.table === "push_subscriptions" && call.method === "DELETE"),
    false
  );
});

test("an approver who turned the setting off loses the row on logout", async (t) => {
  const fake = await createBackend({
    employees: [
      employee(APPROVER_A, { notifications_enabled: false, notify_pending_on_logout: true }),
      employee(EMPLOYEE_B),
    ],
    subscriptions: [subscription({ signed_out: false })],
  });
  t.after(() => fake.restore());

  const response = await logout();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.notEqual(body.keepPushSubscription, true);
  assert.equal(fake.state.push_subscriptions.length, 0);
  // The legacy per-logout flag must not decide anything.
  assert.equal(
    fake.state.employees.find((row) => row.id === APPROVER_A).notifications_enabled,
    false
  );
});

test("a non-approver loses the row on logout and keeps the setting", async (t) => {
  const fake = await createBackend({
    approvers: [],
    subscriptions: [subscription({ signed_out: false })],
  });
  t.after(() => fake.restore());

  const response = await logout();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.notEqual(body.keepPushSubscription, true);
  assert.equal(fake.state.push_subscriptions.length, 0);
  assert.equal(
    fake.state.employees.find((row) => row.id === APPROVER_A).notifications_enabled,
    true
  );
});

test("logout never changes the account notification setting", async (t) => {
  const fake = await createBackend({ subscriptions: [subscription({ signed_out: false })] });
  t.after(() => fake.restore());

  await logout();

  // Nothing but reads may touch the employee row on logout.
  assert.equal(
    fake.calls.some((call) => call.table === "employees" && call.method !== "GET"),
    false
  );
  assert.equal(
    fake.state.employees.find((row) => row.id === APPROVER_A).notifications_enabled,
    true
  );
});

test("the signed-out payload is only a generic count", () => {
  const payload = buildSignedOutPendingPayload(2);
  const text = JSON.stringify(payload);

  assert.equal(payload.title, "ระบบใบลา");
  assert.equal(payload.body, "คุณมีรายการรออนุมัติ 2 รายการ");
  assert.equal(payload.route, "approvals");
  for (const forbidden of [
    "พนักงาน",
    "EMP-",
    "LV-",
    "ลากิจ",
    "2026-11-10",
    "private reason",
    APPROVER_A,
    EMPLOYEE_B,
  ]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test("a signed-out approver gets their own pending count and nobody else's", async (t) => {
  const { env, subscription: row } = await pushKeys();
  const fake = await createBackend({
    subscriptions: [row],
    requests: [
      pendingRequest("r1", APPROVER_A),
      pendingRequest("r2", APPROVER_A, EMPLOYEE_C),
      pendingRequest("r3", APPROVER_A, EMPLOYEE_B, "approved"),
      pendingRequest("r4", EMPLOYEE_C),
    ],
  });
  t.after(() => fake.restore());

  const summary = await runNotificationQueue(env, NOW);

  assert.equal(summary.pendingNotices, 1);
  assert.equal(fake.pushCalls.length, 1);
  assert.equal(fake.pushCalls[0].url, ENDPOINT);
  assert.equal(fake.state.employees.find((row) => row.id === APPROVER_A).pending_notice_at, NOW.toISOString());

  const countRead = fake.calls.find(
    (call) => call.table === "leave_requests" && call.method === "HEAD"
  );
  assert.ok(countRead);
  assert.equal(paramsOf(countRead.url).get("approver_id"), `eq.${APPROVER_A}`);
  assert.equal(paramsOf(countRead.url).get("status"), "eq.pending");
});

test("a signed-out approver with the setting off receives no notice", async (t) => {
  const { env, subscription: row } = await pushKeys();
  const fake = await createBackend({
    employees: [
      employee(APPROVER_A, { notifications_enabled: false, notify_pending_on_logout: true }),
      employee(EMPLOYEE_B),
    ],
    subscriptions: [row],
    requests: [pendingRequest("r1", APPROVER_A)],
  });
  t.after(() => fake.restore());

  const summary = await runNotificationQueue(env, NOW);

  assert.equal(summary.pendingNotices, 0);
  assert.equal(fake.pushCalls.length, 0);
  assert.equal(
    fake.state.employees.find((emp) => emp.id === APPROVER_A).pending_notice_at,
    null
  );
});

test("a non-approver with the setting on receives no notice", async (t) => {
  const { env, subscription: row } = await pushKeys();
  const fake = await createBackend({
    approvers: [],
    subscriptions: [row],
    requests: [pendingRequest("r1", APPROVER_A)],
  });
  t.after(() => fake.restore());

  const summary = await runNotificationQueue(env, NOW);

  assert.equal(summary.pendingNotices, 0);
  assert.equal(fake.pushCalls.length, 0);
  assert.equal(
    fake.state.employees.find((emp) => emp.id === APPROVER_A).pending_notice_at,
    null
  );
});

test("a signed-out approver with zero pending items receives nothing", async (t) => {
  const { env, subscription: row } = await pushKeys();
  const fake = await createBackend({ subscriptions: [row], requests: [] });
  t.after(() => fake.restore());

  const summary = await runNotificationQueue(env, NOW);

  assert.equal(summary.pendingNotices, 0);
  assert.equal(fake.pushCalls.length, 0);
  assert.equal(fake.state.employees[0].pending_notice_at, null);
});

test("a signed-out row of approver A is never used for employee B's request", async (t) => {
  const { env, subscription: row } = await pushKeys();
  const fake = await createBackend({
    subscriptions: [row],
    queue: [
      {
        id: "queue-b",
        employee_id: EMPLOYEE_B,
        leave_request_id: "r4",
        kind: "leave_submitted",
        payload: { title: "x", body: "y", url: "/leave/approvals" },
        status: "pending",
        attempts: 0,
        next_attempt_at: NOW.toISOString(),
      },
    ],
  });
  t.after(() => fake.restore());

  const summary = await runNotificationQueue(env, NOW);

  assert.equal(fake.pushCalls.length, 0);
  assert.equal(summary.cancelled, 1);
  assert.equal(fake.state.notification_queue[0].status, "cancelled");
});

test("a second notice inside 60 minutes is suppressed", async (t) => {
  const { env, subscription: row } = await pushKeys();
  const fake = await createBackend({
    subscriptions: [row],
    requests: [pendingRequest("r1", APPROVER_A)],
  });
  t.after(() => fake.restore());

  const first = await runNotificationQueue(env, NOW);
  const second = await runNotificationQueue(env, new Date(NOW.getTime() + 30 * 60 * 1000));

  assert.equal(first.pendingNotices, 1);
  assert.equal(second.pendingNotices, 0);
  assert.equal(fake.pushCalls.length, 1);
});

test("a 410 from the push service deletes the signed-out row", async (t) => {
  const { env, subscription: row } = await pushKeys();
  const fake = await createBackend({
    subscriptions: [row],
    requests: [pendingRequest("r1", APPROVER_A)],
    pushStatus: 410,
  });
  t.after(() => fake.restore());

  await runNotificationQueue(env, NOW);

  assert.equal(fake.state.push_subscriptions.length, 0);
});

test("a new employee signing in on the endpoint takes the row and clears signed out", async (t) => {
  const nationalHash = createHmac("sha256", NATIONAL_ID_PEPPER)
    .update(NATIONAL_ID)
    .digest("hex");
  const credential = {
    employee_id: EMPLOYEE_B,
    national_id_hash: nationalHash,
    pin_hash: createHmac("sha256", PIN_PEPPER).update(`${EMPLOYEE_B}:${PIN}`).digest("hex"),
    failed_attempts: 0,
    locked_until: null,
    updated_at: NOW.toISOString(),
  };
  const fake = await createBackend({
    subscriptions: [subscription()],
    credentials: [credential],
  });
  t.after(() => fake.restore());

  const response = await post("/api/auth/login", null, {
    loginType: "employee",
    nationalId: NATIONAL_ID,
    pin: PIN,
    endpoint: ENDPOINT,
  });

  assert.equal(response.status, 200);
  assert.equal(fake.state.push_subscriptions.length, 1);
  assert.equal(fake.state.push_subscriptions[0].employee_id, EMPLOYEE_B);
  assert.equal(fake.state.push_subscriptions[0].signed_out, false);
  assert.equal(fake.state.push_subscriptions[0].signed_out_at, null);
});