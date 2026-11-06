// The account-level notification preference and the per-endpoint status.
// The endpoint is always checked against the session employee and is never
// returned in the response.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const TOKEN_A = "a".repeat(43);
const TOKEN_B = "b".repeat(43);
const EMPLOYEE_A = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_B = "22222222-2222-4222-8222-222222222222";
const ENDPOINT_A = "https://push.example.net/send/a";
const ENDPOINT_B = "https://push.example.net/send/b";
const P256DH =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const AUTH = "BTBZMqHH6r4Tts7J_aSIgg";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  VAPID_PUBLIC_KEY: "fake-public-key",
};

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
    if (["select", "order", "limit", "offset", "or", "on_conflict"].includes(key)) continue;
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (String(row[key] ?? "") !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("gt.")) {
      const left = Date.parse(String(row[key] ?? ""));
      const right = Date.parse(value.slice(3));
      if (!Number.isFinite(left) || !Number.isFinite(right) || !(left > right)) return false;
      continue;
    }
    if (value.startsWith("in.(")) {
      const list = value
        .slice(4, -1)
        .split(",")
        .map((entry) => decodeURIComponent(entry));
      if (!list.includes(String(row[key] ?? ""))) return false;
    }
  }
  return true;
}

async function createBackend({ subscriptions = [] } = {}) {
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
      { id: EMPLOYEE_A, is_active: true, notifications_enabled: false },
      { id: EMPLOYEE_B, is_active: true, notifications_enabled: false },
    ],
    employee_credentials: [],
    hr_admins: [],
    meeting_admins: [],
    system_admins: [],
    employee_approvers: [],
    department_approvers: [],
    push_subscriptions: [...subscriptions],
    audit_logs: [],
  };

  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const table = tableOf(url);
    const params = paramsOf(url);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, method, table, body });

    if (method === "GET") {
      return jsonResponse((state[table] ?? []).filter((row) => matches(params, row)));
    }

    if (method === "PATCH") {
      const rows = (state[table] ?? []).filter((row) => matches(params, row));
      for (const row of rows) Object.assign(row, body ?? {});
      return params.get("select") ? jsonResponse(rows) : new Response(null, { status: 204 });
    }

    if (method === "POST") {
      state[table] = state[table] ?? [];
      const row = { id: `${table}-${state[table].length + 1}`, ...body };
      state[table].push(row);
      return jsonResponse([row], 201);
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

function request(path, token, init = {}) {
  return app.request(
    `https://fake.local${path}`,
    {
      ...init,
      headers: {
        Cookie: `hr_session=${token}`,
        ...(init.headers ?? {}),
      },
    },
    ENV
  );
}

function subscribe(token, endpoint = ENDPOINT_A) {
  return request(`/api/notifications/subscribe`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint,
      keys: { p256dh: P256DH, auth: AUTH },
      userAgent: "test-browser",
    }),
  });
}

function unsubscribe(token, endpoint = ENDPOINT_A) {
  return request(`/api/notifications/unsubscribe`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}

function status(token, endpoint = null) {
  const query = endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : "";
  return request(`/api/notifications/status${query}`, token);
}

test("status starts with the account preference off and no subscription", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await status(TOKEN_A, ENDPOINT_A);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { ok: true, enabled: false, subscribed: false });
  assert.equal(JSON.stringify(body).includes("push.example.net"), false);
});

test("subscribe turns on the account preference and status sees this endpoint", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const subscribed = await subscribe(TOKEN_A);
  assert.equal(subscribed.status, 201);
  assert.equal(fake.state.employees.find((row) => row.id === EMPLOYEE_A).notifications_enabled, true);

  const response = await status(TOKEN_A, ENDPOINT_A);
  const body = await response.json();

  assert.deepEqual(body, { ok: true, enabled: true, subscribed: true });
  assert.equal(JSON.stringify(body).includes("push.example.net"), false);
  assert.equal(JSON.stringify(body).includes(ENDPOINT_A), false);
});

test("unsubscribe clears the preference, deletes the row, and stays off", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  await subscribe(TOKEN_A);
  const response = await unsubscribe(TOKEN_A);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.unsubscribed, true);
  assert.equal(fake.state.push_subscriptions.length, 0);
  assert.equal(fake.state.employees.find((row) => row.id === EMPLOYEE_A).notifications_enabled, false);

  const after = await status(TOKEN_A, ENDPOINT_A);
  assert.deepEqual(await after.json(), { ok: true, enabled: false, subscribed: false });
});

test("another employee's endpoint is not subscribed for this caller", async (t) => {
  const fake = await createBackend({
    subscriptions: [
      {
        id: "sub-b",
        employee_id: EMPLOYEE_B,
        endpoint: ENDPOINT_B,
        p256dh: P256DH,
        auth: AUTH,
        is_active: true,
      },
    ],
  });
  t.after(() => fake.restore());

  const response = await status(TOKEN_A, ENDPOINT_B);
  const body = await response.json();

  assert.deepEqual(body, { ok: true, enabled: false, subscribed: false });

  // The owner of that row still sees it as subscribed.
  fake.state.employees.find((row) => row.id === EMPLOYEE_B).notifications_enabled = true;
  const owner = await status(TOKEN_B, ENDPOINT_B);
  assert.deepEqual(await owner.json(), { ok: true, enabled: true, subscribed: true });
});

test("status rejects an invalid endpoint without echoing it", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await status(TOKEN_A, "http://push.example.net/send/a");
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(JSON.stringify(body).includes("push.example.net"), false);
});
