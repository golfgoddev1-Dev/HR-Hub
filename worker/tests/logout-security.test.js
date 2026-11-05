// Logout has to end the session server-side, not only hide the page: the row is
// revoked, the cookie is cleared with the attributes it was set with, the
// browser is told to drop its copies, and the old cookie is refused everywhere.
//
// The database is a fake fetch: nothing is read from or written to Supabase.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const EMPLOYEE_TOKEN = "e".repeat(43);
const HR_TOKEN = "h".repeat(43);
const MEETING_TOKEN = "m".repeat(43);
const SYSTEM_TOKEN = "s".repeat(43);

const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const HR_ID = "22222222-2222-4222-8222-222222222222";
const MEETING_ID = "33333333-3333-4333-8333-333333333333";
const SYSTEM_ID = "44444444-4444-4444-8444-444444444444";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
      const list = value.slice(4, -1).split(",");
      if (!list.includes(String(row[key] ?? ""))) return false;
      continue;
    }
  }
  return true;
}

async function createBackend() {
  const now = new Date();
  const future = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
  const session = async (token, employeeId, role) => ({
    id: `session-${role}`,
    token_hash: await sha256Hex(token),
    employee_id: employeeId,
    login_role: role,
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: future,
  });

  const employee = (id, code) => ({
    id,
    employee_code: code,
    full_name: `ทดสอบ ${code}`,
    department_id: null,
    is_active: true,
  });

  const state = {
    auth_sessions: [
      await session(EMPLOYEE_TOKEN, EMPLOYEE_ID, "employee"),
      await session(HR_TOKEN, HR_ID, "hr"),
      await session(MEETING_TOKEN, MEETING_ID, "meeting_controller"),
      await session(SYSTEM_TOKEN, SYSTEM_ID, "system_admin"),
    ],
    employees: [
      employee(EMPLOYEE_ID, "EMP001"),
      employee(HR_ID, "HR001"),
      employee(MEETING_ID, "MT001"),
      employee(SYSTEM_ID, "ADM001"),
    ],
    employee_credentials: [],
    hr_admins: [{ employee_id: HR_ID }],
    meeting_admins: [{ employee_id: MEETING_ID }],
    system_admins: [{ employee_id: SYSTEM_ID }],
    employee_approvers: [],
    department_approvers: [],
    leave_requests: [],
    leave_types: [],
    leave_settings: [],
    departments: [],
    positions: [],
    name_prefixes: [],
    holidays: [],
    audit_logs: [],
  };

  const calls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop();
    const params = parsed.searchParams;
    calls.push({ url, method, table });

    if (method === "GET") {
      return jsonResponse((state[table] ?? []).filter((row) => matches(params, row)));
    }
    if (method === "PATCH") {
      const patch = typeof init.body === "string" ? JSON.parse(init.body) : {};
      for (const row of state[table] ?? []) {
        if (matches(params, row)) Object.assign(row, patch);
      }
      return new Response(null, { status: 204 });
    }
    if (method === "POST") {
      const row = typeof init.body === "string" ? JSON.parse(init.body) : {};
      state[table] = state[table] ?? [];
      state[table].push(row);
      return new Response(null, { status: 201 });
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

function call(path, token, method = "GET") {
  const init = { method };
  if (token) init.headers = { Cookie: `hr_session=${token}` };
  return app.request(`https://fake.local${path}`, init, ENV);
}

test("logout revokes the session and clears the cookie with matching attributes", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/auth/logout", EMPLOYEE_TOKEN, "POST");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /^hr_session=;/);
  assert.match(setCookie, /Max-Age=0/);
  assert.match(setCookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /;\s*Secure/);

  assert.equal(
    response.headers.get("Clear-Site-Data"),
    '"cache", "cookies", "storage"'
  );
  assert.equal(response.headers.get("Cache-Control"), "no-store");

  const row = fake.state.auth_sessions.find((entry) => entry.login_role === "employee");
  assert.equal(typeof row.revoked_at, "string");
  assert.ok(row.revoked_at.length > 0);
});

test("the old cookie is refused by every area after logout", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  for (const token of [EMPLOYEE_TOKEN, HR_TOKEN, MEETING_TOKEN, SYSTEM_TOKEN]) {
    const response = await call("/api/auth/logout", token, "POST");
    assert.equal(response.status, 200);
  }

  const checks = [
    ["/api/auth/me", EMPLOYEE_TOKEN],
    ["/api/leave/requests/mine", EMPLOYEE_TOKEN],
    ["/api/profile/me", EMPLOYEE_TOKEN],
    ["/api/leave/hr/holidays", HR_TOKEN],
    ["/api/meeting/overview", MEETING_TOKEN],
    ["/api/admin/overview", SYSTEM_TOKEN],
  ];

  for (const [path, token] of checks) {
    const response = await call(path, token);
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get("Cache-Control"), "no-store", path);
  }
});

test("an anonymous caller is refused too", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  for (const path of ["/api/leave/requests/mine", "/api/profile/me", "/api/admin/overview"]) {
    const response = await call(path);
    assert.equal(response.status, 401, path);
  }
});

test("session-dependent responses are never cacheable", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const me = await call("/api/auth/me", EMPLOYEE_TOKEN);
  assert.equal(me.status, 200);
  assert.equal(me.headers.get("Cache-Control"), "no-store");

  // These lookups used to be `private, max-age=300`.
  for (const path of ["/api/profile/departments", "/api/profile/name-prefixes"]) {
    const response = await call(path, EMPLOYEE_TOKEN);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("Cache-Control"), "no-store", path);
  }
});
