// Own leave belongs to the employee record, not the login role: hr, meeting and
// system_admin sessions with an active employee row can read their own list,
// while an inactive employee is refused and the approvals/HR checks still apply.
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
const INACTIVE_TOKEN = "i".repeat(43);

const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const HR_ID = "22222222-2222-4222-8222-222222222222";
const MEETING_ID = "33333333-3333-4333-8333-333333333333";
const SYSTEM_ID = "44444444-4444-4444-8444-444444444444";
const INACTIVE_ID = "55555555-5555-4555-8555-555555555555";

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

  const employee = (id, code, isActive = true) => ({
    id,
    employee_code: code,
    full_name: `ทดสอบ ${code}`,
    department_id: null,
    is_active: isActive,
  });

  const state = {
    auth_sessions: [
      await session(EMPLOYEE_TOKEN, EMPLOYEE_ID, "employee"),
      await session(HR_TOKEN, HR_ID, "hr"),
      await session(MEETING_TOKEN, MEETING_ID, "meeting_controller"),
      await session(SYSTEM_TOKEN, SYSTEM_ID, "system_admin"),
      await session(INACTIVE_TOKEN, INACTIVE_ID, "employee"),
    ],
    employees: [
      employee(EMPLOYEE_ID, "EMP001"),
      employee(HR_ID, "HR001"),
      employee(MEETING_ID, "MT001"),
      employee(SYSTEM_ID, "ADM001"),
      employee(INACTIVE_ID, "OLD001", false),
    ],
    employee_credentials: [],
    hr_admins: [{ employee_id: HR_ID }],
    meeting_admins: [{ employee_id: MEETING_ID }],
    system_admins: [{ employee_id: SYSTEM_ID }],
    // The meeting controller is an active approver of the plain employee, so the
    // queue follows that row rather than the login role.
    employee_approvers: [
      { employee_id: EMPLOYEE_ID, approver_id: MEETING_ID, priority: 1, is_active: true },
    ],
    department_approvers: [],
    leave_requests: [],
    leave_types: [],
    leave_settings: [],
    holidays: [],
    departments: [],
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

function call(path, token) {
  const init = token ? { headers: { Cookie: `hr_session=${token}` } } : {};
  return app.request(`https://fake.local${path}`, init, ENV);
}

test("hr, meeting and system_admin sessions can read their own leave", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  for (const token of [EMPLOYEE_TOKEN, HR_TOKEN, MEETING_TOKEN, SYSTEM_TOKEN]) {
    const response = await call("/api/leave/requests/mine", token);
    const body = await response.json();

    assert.equal(response.status, 200, token);
    assert.equal(body.ok, true, token);
    assert.deepEqual(body.results, [], token);
  }

  // Each list read is scoped to the session's own employee id, one per token.
  const mineIds = fake.calls
    .filter((entry) => entry.table === "leave_requests" && entry.method === "GET")
    .map((entry) => new URL(entry.url).searchParams.get("employee_id"))
    .filter((value) => value !== null);

  assert.deepEqual(
    mineIds,
    [EMPLOYEE_ID, HR_ID, MEETING_ID, SYSTEM_ID].map((id) => `eq.${id}`)
  );
});

test("own request counts include only the session employee's requests", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const request = (id, employeeId, status) => ({
    id,
    employee_id: employeeId,
    status,
  });
  fake.state.leave_requests.push(
    request("a1111111-1111-4111-8111-111111111111", EMPLOYEE_ID, "pending"),
    request("a2222222-2222-4222-8222-222222222222", EMPLOYEE_ID, "approved"),
    request("a3333333-3333-4333-8333-333333333333", EMPLOYEE_ID, "rejected"),
    // Another employee's pending request must never enter this employee's count.
    request("b1111111-1111-4111-8111-111111111111", HR_ID, "pending")
  );

  const response = await call("/api/leave/requests/mine/counts", EMPLOYEE_TOKEN);
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.ok, true);
  assert.deepEqual(body.counts, { pending: 1, approved: 1 });

  const countCalls = fake.calls.filter((entry) => {
    if (entry.table !== "leave_requests") return false;
    return new URL(entry.url).searchParams.get("status") === "in.(pending,approved)";
  });
  assert.equal(countCalls.length, 1);
  assert.equal(
    new URL(countCalls[0].url).searchParams.get("employee_id"),
    `eq.${EMPLOYEE_ID}`
  );
});

test("an inactive employee is refused even with a valid session", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/leave/requests/mine", INACTIVE_TOKEN);

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.ok, false);
});

test("the approvals queue follows the approver row, not the role", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const approver = await call("/api/leave/approvals", MEETING_TOKEN);
  assert.equal(approver.status, 200);
  assert.equal((await approver.json()).ok, true);

  // HR is not an approver in this fixture: role alone is not enough.
  const hr = await call("/api/leave/approvals", HR_TOKEN);
  assert.equal(hr.status, 403);

  const plain = await call("/api/leave/approvals", EMPLOYEE_TOKEN);
  assert.equal(plain.status, 403);
});

test("HR leave tools still reject a non-HR role", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const employee = await call("/api/leave/hr/holidays", EMPLOYEE_TOKEN);
  assert.equal(employee.status, 403);

  const meeting = await call("/api/leave/hr/holidays", MEETING_TOKEN);
  assert.equal(meeting.status, 403);

  const hr = await call("/api/leave/hr/holidays", HR_TOKEN);
  assert.equal(hr.status, 200);
});
