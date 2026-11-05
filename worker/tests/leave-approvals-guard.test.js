// GET /api/leave/approvals is the control behind the approvals menu.
// Before this change it answered 200 with an empty list to everybody, so the
// frontend had to guess from the list length. Now the route checks the approver
// lists itself: an active approver (employee scope or department scope) gets the
// queue, everyone else gets 403, and a deactivated approver row is no longer an
// approver. /api/auth/me carries the same fact as a read-only isApprover flag so
// the menu needs no second source of truth.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const PERSONAL_ID = "11111111-1111-4111-8111-111111111111";
const DEPARTMENT_ID = "22222222-2222-4222-8222-222222222222";
const PLAIN_ID = "33333333-3333-4333-8333-333333333333";
const OFF_ID = "44444444-4444-4444-8444-444444444444";
const REQUESTER_ID = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const TYPE_ID = "77777777-7777-4777-8777-777777777777";
const DEPT_A = "88888888-8888-4888-8888-888888888888";
const DEPT_B = "99999999-9999-4999-8999-999999999999";

const TOKENS = {
  personal: "p".repeat(43),
  department: "d".repeat(43),
  plain: "n".repeat(43),
  off: "o".repeat(43),
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

function matches(row, params) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit"].includes(key)) continue;
    const actual = row[key] === undefined || row[key] === null ? "" : String(row[key]);
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (actual !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("in.(")) {
      const list = value.slice(4, -1).split(",");
      if (!list.includes(actual)) return false;
      continue;
    }
    // gt./lt./gte./lte. are not asserted here; the eq filters narrow each read.
  }
  return true;
}

async function buildState() {
  const now = new Date();
  const session = async (token, employeeId) => ({
    id: `session-${employeeId.slice(0, 4)}`,
    token_hash: await sha256Hex(token),
    employee_id: employeeId,
    login_role: "employee",
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  });

  return {
    auth_sessions: [
      await session(TOKENS.personal, PERSONAL_ID),
      await session(TOKENS.department, DEPARTMENT_ID),
      await session(TOKENS.plain, PLAIN_ID),
      await session(TOKENS.off, OFF_ID),
    ],
    employees: [
      {
        id: PERSONAL_ID,
        employee_code: "EMP-00001",
        full_name: "ผู้อนุมัติ ส่วนตัว",
        department_id: DEPT_A,
        is_active: true,
      },
      {
        id: DEPARTMENT_ID,
        employee_code: "EMP-00002",
        full_name: "ผู้อนุมัติ แผนก",
        department_id: DEPT_B,
        is_active: true,
      },
      {
        id: PLAIN_ID,
        employee_code: "EMP-00003",
        full_name: "พนักงาน ทั่วไป",
        department_id: DEPT_A,
        is_active: true,
      },
      {
        id: OFF_ID,
        employee_code: "EMP-00004",
        full_name: "ผู้อนุมัติ ปิดใช้งาน",
        department_id: DEPT_A,
        is_active: true,
      },
      {
        id: REQUESTER_ID,
        employee_code: "EMP-00005",
        full_name: "ผู้ยื่น ใบลา",
        department_id: DEPT_A,
        is_active: true,
      },
    ],
    // PERSONAL_ID approves REQUESTER_ID personally; OFF_ID does too, but off.
    employee_approvers: [
      { id: "ea-1", employee_id: REQUESTER_ID, approver_id: PERSONAL_ID, priority: 1, is_active: true },
      { id: "ea-2", employee_id: REQUESTER_ID, approver_id: OFF_ID, priority: 2, is_active: false },
    ],
    // DEPARTMENT_ID approves the whole of DEPT_B; OFF_ID's DEPT_A row is off.
    department_approvers: [
      { id: "da-1", department_id: DEPT_B, employee_id: DEPARTMENT_ID, priority: 1, is_active: true },
      { id: "da-2", department_id: DEPT_A, employee_id: OFF_ID, priority: 2, is_active: false },
    ],
    leave_requests: [
      {
        id: REQUEST_ID,
        request_code: "LV-20261105-001",
        employee_id: REQUESTER_ID,
        approver_id: PERSONAL_ID,
        leave_type_id: TYPE_ID,
        status: "pending",
        days: 2,
        start_date: "2026-11-09",
        end_date: "2026-11-10",
        created_at: "2026-11-05T02:00:00.000Z",
      },
    ],
    leave_types: [{ id: TYPE_ID, name: "ลากิจ", requires_attachment: false, is_active: true }],
    departments: [{ id: DEPT_A, name: "ฝ่ายบุคคล", is_active: true }],
    employee_credentials: [],
    hr_admins: [],
    meeting_admins: [],
    system_admins: [],
    audit_logs: [],
  };
}

async function createBackend() {
  const state = await buildState();
  const calls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop();
    calls.push({ url, method, init, table });

    if (method === "GET") {
      const rows = (state[table] ?? []).filter((row) => matches(row, parsed.searchParams));
      return jsonResponse(rows);
    }
    if (method === "PATCH") return emptyResponse(204);
    if (method === "POST") return emptyResponse(201);
    return emptyResponse(204);
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

/** GETs that would return queue rows (the session lookup selects only `id`). */
function queueReads(fake) {
  return fake.calls.filter((entry) => {
    if (entry.method !== "GET") return false;
    if (entry.table !== "leave_requests") return false;
    return String(new URL(entry.url).searchParams.get("select") ?? "").includes("request_code");
  });
}

test("an active personal approver gets the queue", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/leave/approvals", TOKENS.personal);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.count, 1);
  assert.equal(body.results[0].requestCode, "LV-20261105-001");
  assert.equal(body.results[0].requester.fullName, "ผู้ยื่น ใบลา");
  assert.equal(queueReads(fake).length, 1);
});

test("an active department approver gets 200 and an empty queue", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/leave/approvals", TOKENS.department);
  const body = await response.json();

  // This is the case the menu used to hide: approver, but nothing pending.
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.count, 0);
  assert.deepEqual(body.results, []);
});

test("a non-approver is refused with 403 and no queue read", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/leave/approvals", TOKENS.plain);
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.ok, false);
  assert.equal(body.message, "ไม่มีสิทธิ์เข้าถึงส่วนนี้");
  assert.deepEqual(queueReads(fake), []);
});

test("a deactivated approver is refused too", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/leave/approvals", TOKENS.off);

  assert.equal(response.status, 403);
  assert.equal((await response.json()).ok, false);
  assert.deepEqual(queueReads(fake), []);
});

test("no session still answers 401", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/leave/approvals", null);

  assert.equal(response.status, 401);
});

test("the route only reads: no queue rows written and no audit", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  await call("/api/leave/approvals", TOKENS.personal);

  const writes = fake.calls.filter((entry) => entry.method !== "GET");
  for (const write of writes) {
    assert.equal(write.table, "auth_sessions", `${write.method} ${write.table}`);
    assert.equal(write.method, "PATCH");
  }
  assert.equal(fake.calls.some((entry) => entry.table === "audit_logs"), false);
});

test("/api/auth/me reports isApprover for the menu", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const approver = await call("/api/auth/me", TOKENS.personal);
  const approverBody = await approver.json();
  assert.equal(approver.status, 200);
  assert.equal(approverBody.isApprover, true);
  assert.equal(approverBody.role, "employee");

  const department = await (await call("/api/auth/me", TOKENS.department)).json();
  assert.equal(department.isApprover, true);

  const plain = await (await call("/api/auth/me", TOKENS.plain)).json();
  assert.equal(plain.isApprover, false);

  const off = await (await call("/api/auth/me", TOKENS.off)).json();
  assert.equal(off.isApprover, false);
});

test("the me signal carries no personal data", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/auth/me", TOKENS.personal);
  const text = await response.text();
  const body = JSON.parse(text);

  assert.deepEqual(Object.keys(body).sort(), [
    "isApprover",
    "mustChangePin",
    "ok",
    "redirectTo",
    "role",
  ]);
  for (const forbidden of ["full_name", "employee_code", "national", "email", "ผู้อนุมัติ ส่วนตัว"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  assert.equal(fake.calls.some((entry) => entry.table === "audit_logs"), false);
});
