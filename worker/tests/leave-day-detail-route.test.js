// The calendar day detail and the read-only detail endpoint share one rule:
// HR sees every request; an active approver sees only requests they decide.
// Reason and the other review fields never reach anyone else.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const DEPT_A = "11111111-1111-4111-8111-111111111111";
const DEPT_B = "22222222-2222-4222-8222-222222222222";
const EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";
const APPROVER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_APPROVER_ID = "55555555-5555-4555-8555-555555555555";
const HR_ID = "66666666-6666-4666-8666-666666666666";
const TYPE_ID = "77777777-7777-4777-8777-777777777777";
const R1 = "88000000-0000-4000-8000-000000000001";
const R2 = "88000000-0000-4000-8000-000000000002";
const R3 = "88000000-0000-4000-8000-000000000003";
const R4 = "88000000-0000-4000-8000-000000000004";

const TOKENS = {
  employee: "e".repeat(43),
  approver: "a".repeat(43),
  other: "o".repeat(43),
  hr: "h".repeat(43),
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function compare(actual, value, op) {
  if (op === "eq") return actual === value;
  if (op === "gte") return actual >= value;
  if (op === "lte") return actual <= value;
  if (op === "gt") return actual > value;
  if (op === "lt") return actual < value;
  return true;
}

function matches(row, params) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
    const raw = row[key];
    const actual = raw === undefined || raw === null ? "" : String(raw);

    if (value === "is.null") {
      if (raw !== null && raw !== undefined) return false;
      continue;
    }
    if (value === "not.is.null") {
      if (raw === null || raw === undefined) return false;
      continue;
    }
    // URLSearchParams has already decoded these values.
    if (value.startsWith("in.(")) {
      const list = value.slice(4, -1).split(",");
      if (!list.includes(actual)) return false;
      continue;
    }
    if (value.startsWith("ilike.")) {
      const term = value.slice(6).replace(/%/g, "");
      if (!actual.includes(term)) return false;
      continue;
    }
    const match = /^(eq|gte|lte|gt|lt)\.(.*)$/.exec(value);
    if (match && !compare(actual, match[2], match[1])) return false;
  }
  return true;
}

async function buildState() {
  const now = new Date();
  const session = async (token, employeeId, loginRole) => ({
    id: `session-${token.slice(0, 2)}-${employeeId.slice(0, 4)}`,
    token_hash: await sha256Hex(token),
    employee_id: employeeId,
    login_role: loginRole,
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  });

  return {
    auth_sessions: [
      await session(TOKENS.employee, EMPLOYEE_ID, "employee"),
      await session(TOKENS.approver, APPROVER_ID, "employee"),
      await session(TOKENS.other, OTHER_APPROVER_ID, "employee"),
      await session(TOKENS.hr, HR_ID, "hr"),
    ],
    hr_admins: [{ employee_id: HR_ID }],
    meeting_admins: [],
    system_admins: [],
    employee_credentials: [],
    departments: [
      { id: DEPT_A, name: "ฝ่ายบุคคล", is_active: true },
      { id: DEPT_B, name: "ฝ่ายขาย", is_active: true },
    ],
    employees: [
      {
        id: EMPLOYEE_ID,
        employee_code: "EMP-00001",
        name_prefix: "นาย",
        full_name: "สมชาย ใจดี",
        department_id: DEPT_A,
        is_active: true,
      },
      {
        id: APPROVER_ID,
        employee_code: "EMP-00002",
        name_prefix: "นาง",
        full_name: "สมหญิง รักงาน",
        department_id: DEPT_A,
        is_active: true,
      },
      {
        id: OTHER_APPROVER_ID,
        employee_code: "EMP-00003",
        name_prefix: null,
        full_name: "สมศักดิ์ คนละใบ",
        department_id: DEPT_A,
        is_active: true,
      },
      {
        id: HR_ID,
        employee_code: "EMP-00004",
        name_prefix: "นางสาว",
        full_name: "ฝ่าย บุคคล",
        department_id: DEPT_A,
        is_active: true,
      },
    ],
    // The employee's approver is APPROVER_ID; R2 belongs to another approver.
    employee_approvers: [
      {
        id: "ea-1",
        employee_id: EMPLOYEE_ID,
        approver_id: APPROVER_ID,
        priority: 1,
        is_active: true,
      },
      {
        id: "ea-2",
        employee_id: EMPLOYEE_ID,
        approver_id: OTHER_APPROVER_ID,
        priority: 2,
        is_active: true,
      },
    ],
    // APPROVER_ID is the department approver for DEPT_A; OTHER_APPROVER_ID is
    // only a named approver, so their visibility comes from the name grant.
    department_approvers: [
      {
        id: "da-1",
        employee_id: APPROVER_ID,
        department_id: DEPT_A,
        priority: 1,
        is_active: true,
      },
    ],
    leave_types: [{ id: TYPE_ID, name: "ลาป่วย", is_active: true }],
    leave_requests: [
      {
        id: R1,
        request_code: "LV-0001",
        employee_id: EMPLOYEE_ID,
        approver_id: APPROVER_ID,
        leave_type_id: TYPE_ID,
        status: "approved",
        start_date: "2026-11-10",
        end_date: "2026-11-10",
        days: 1,
        reason: "ปวดหัว",
        decision_note: null,
        decided_at: "2026-11-05T03:00:00.000Z",
        created_at: "2026-11-01T03:00:00.000Z",
      },
      {
        id: R2,
        request_code: "LV-0002",
        employee_id: EMPLOYEE_ID,
        approver_id: OTHER_APPROVER_ID,
        leave_type_id: TYPE_ID,
        status: "approved",
        start_date: "2026-11-11",
        end_date: "2026-11-11",
        days: 1,
        reason: "ธุระส่วนตัว",
        decided_at: "2026-11-06T03:00:00.000Z",
        created_at: "2026-11-02T03:00:00.000Z",
      },
      {
        id: R3,
        request_code: "LV-0003",
        employee_id: EMPLOYEE_ID,
        approver_id: APPROVER_ID,
        leave_type_id: TYPE_ID,
        status: "pending",
        start_date: "2026-11-12",
        end_date: "2026-11-12",
        days: 1,
        reason: "ลากิจ",
        decided_at: null,
        created_at: "2026-11-03T03:00:00.000Z",
      },
      // A different employee in the same department: the department approver
      // sees it, the named approver for EMPLOYEE_ID must not.
      {
        id: R4,
        request_code: "LV-0004",
        employee_id: APPROVER_ID,
        approver_id: OTHER_APPROVER_ID,
        leave_type_id: TYPE_ID,
        status: "approved",
        start_date: "2026-11-13",
        end_date: "2026-11-13",
        days: 1,
        reason: "พักร้อน",
        decided_at: "2026-11-07T03:00:00.000Z",
        created_at: "2026-11-04T03:00:00.000Z",
      },
    ],
    holidays: [],
    audit_logs: [],
  };
}

async function createBackend() {
  const state = await buildState();
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop();

    if (method !== "GET") return new Response(null, { status: 204 });

    let rows = (state[table] ?? []).filter((row) => matches(row, parsed.searchParams));
    const order = parsed.searchParams.get("order");
    if (order) {
      const [column, direction, nulls] = order.split(".");
      rows = [...rows].sort((left, right) => {
        const a = left[column] ?? "";
        const b = right[column] ?? "";
        const compared = String(a).localeCompare(String(b));
        if (nulls === "nullslast") {
          if (a === null || a === "") return 1;
          if (b === null || b === "") return -1;
        }
        return direction === "desc" ? -compared : compared;
      });
    }
    const offsetParam = parsed.searchParams.get("offset");
    if (offsetParam !== null) {
      const offset = Number(offsetParam);
      if (Number.isFinite(offset) && offset > 0) rows = rows.slice(offset);
    }
    const limitParam = parsed.searchParams.get("limit");
    if (limitParam !== null) {
      const limit = Number(limitParam);
      if (Number.isFinite(limit) && limit >= 0) rows = rows.slice(0, limit);
    }
    return jsonResponse(rows);
  };

  return {
    state,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function call(path, token) {
  const init = token ? { headers: { Cookie: `hr_session=${token}` } } : {};
  return app.request(`https://fake.local${path}`, init, ENV);
}

const CALENDAR = "/api/leave/calendar?from=2026-11-01&to=2026-11-30";

test("a department approver sees every department request and its review fields", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const body = await (await call(CALENDAR, TOKENS.approver)).json();
  assert.equal(body.ok, true);
  assert.equal(body.scope, "responsibilities");

  const r1 = body.events.find((event) => event.id === R1);
  const r2 = body.events.find((event) => event.id === R2);
  const r4 = body.events.find((event) => event.id === R4);

  assert.equal(r1.detail.reason, "ปวดหัว");
  assert.equal(r1.detail.requestCode, "LV-0001");
  assert.equal(r1.detail.employeeCode, "EMP-00001");
  assert.equal(r2.detail.reason, "ธุระส่วนตัว");
  assert.equal(r4.detail.reason, "พักร้อน");

  // Approved people only, one person on each day.
  assert.deepEqual(body.dayCounts, {
    "2026-11-10": 1,
    "2026-11-11": 1,
    "2026-11-13": 1,
  });
});

test("the requester gets no review fields, and a named approver only sees the named employee", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  // A plain employee has no calendar any more, so no reason can reach one.
  const requester = await call(CALENDAR, TOKENS.employee);
  assert.equal(requester.status, 403);
  const requesterBody = await requester.json();
  assert.equal(requesterBody.ok, false);
  assert.equal(JSON.stringify(requesterBody).includes("ปวดหัว"), false);

  // OTHER_APPROVER_ID is named for EMPLOYEE_ID only: they see that person's
  // requests, never a different employee in the same department.
  const otherBody = await (await call(CALENDAR, TOKENS.other)).json();
  assert.equal(otherBody.events.some((event) => event.id === R4), false);
  for (const id of [R1, R2, R3]) {
    const event = otherBody.events.find((row) => row.id === id);
    assert.equal(typeof event?.detail?.reason, "string", id);
  }
});

test("HR gets the review fields for every request", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const body = await (await call(CALENDAR, TOKENS.hr)).json();
  const reasons = body.events
    .filter((event) => event.status === "approved")
    .map((event) => event.detail?.reason)
    .sort();

  assert.deepEqual(reasons, ["ธุระส่วนตัว", "ปวดหัว", "พักร้อน"]);
});

test("the detail endpoint serves the approval fields to the approver", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call(`/api/leave/requests/${R1}`, TOKENS.approver);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.request.reason, "ปวดหัว");
  assert.equal(body.request.requester.fullName, "นาย สมชาย ใจดี");
  assert.equal(body.request.requester.employeeCode, "EMP-00001");
  assert.equal(body.request.requester.departmentName, "ฝ่ายบุคคล");
  assert.equal(body.request.leaveTypeName, "ลาป่วย");
  assert.equal(body.request.decidedAt, "2026-11-05T03:00:00.000Z");
});

test("the detail endpoint still refuses the requester and signed-out callers", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call(`/api/leave/requests/${R1}`, TOKENS.employee);
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.message, "ไม่มีสิทธิ์เข้าถึงส่วนนี้");
  assert.equal(JSON.stringify(body).includes("ปวดหัว"), false);

  // Signed out is 401, not a scope bypass.
  assert.equal((await call(`/api/leave/requests/${R1}`, null)).status, 401);
});

test("HR may open any request detail", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call(`/api/leave/requests/${R2}`, TOKENS.hr);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.request.reason, "ธุระส่วนตัว");
});
