// GET /api/leave/calendar is scoped by the server:
// - employee and approver (both login role "employee") see their own department
//   only, whatever departmentId they send;
// - HR sees every department and may narrow by departmentId;
// - only pending and approved requests are returned, with display fields only.
// GET /api/leave/holidays?from=&to= returns date and name for any signed-in
// employee role.
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
const COLLEAGUE_B_ID = "55555555-5555-4555-8555-555555555555";
const HR_ID = "66666666-6666-4666-8666-666666666666";
const TYPE_ID = "77777777-7777-4777-8777-777777777777";

const TOKENS = {
  employee: "e".repeat(43),
  approver: "a".repeat(43),
  hr: "h".repeat(43),
};

const NOVEMBER = "from=2026-11-01&to=2026-11-30";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
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
    if (["select", "order", "limit", "on_conflict"].includes(key)) continue;
    const raw = row[key];
    const actual = raw === undefined || raw === null ? "" : String(raw);

    if (value === "is.null") {
      if (raw !== null && raw !== undefined) return false;
      continue;
    }
    if (value.startsWith("in.(")) {
      const list = value.slice(4, -1).split(",");
      if (!list.includes(actual)) return false;
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
        id: COLLEAGUE_B_ID,
        employee_code: "EMP-00003",
        name_prefix: null,
        full_name: "คนละ แผนก",
        department_id: DEPT_B,
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
    // APPROVER_ID really approves EMPLOYEE_ID; the calendar scope does not use
    // this table, which is the point: an approver sees the department, not a
    // personal queue.
    employee_approvers: [
      {
        id: "ea-1",
        employee_id: EMPLOYEE_ID,
        approver_id: APPROVER_ID,
        priority: 1,
        is_active: true,
      },
    ],
    leave_types: [{ id: TYPE_ID, name: "ลากิจ", is_active: true }],
    leave_requests: [
      {
        id: "88000000-0000-4000-8000-000000000001",
        employee_id: APPROVER_ID,
        leave_type_id: TYPE_ID,
        status: "approved",
        start_date: "2026-11-10",
        end_date: "2026-11-11",
      },
      {
        id: "88000000-0000-4000-8000-000000000002",
        employee_id: APPROVER_ID,
        leave_type_id: TYPE_ID,
        status: "pending",
        start_date: "2026-11-20",
        end_date: "2026-11-20",
      },
      {
        id: "88000000-0000-4000-8000-000000000003",
        employee_id: APPROVER_ID,
        leave_type_id: TYPE_ID,
        status: "rejected",
        start_date: "2026-11-15",
        end_date: "2026-11-16",
      },
      {
        id: "88000000-0000-4000-8000-000000000004",
        employee_id: APPROVER_ID,
        leave_type_id: TYPE_ID,
        status: "cancelled",
        start_date: "2026-11-18",
        end_date: "2026-11-18",
      },
      {
        id: "88000000-0000-4000-8000-000000000005",
        employee_id: COLLEAGUE_B_ID,
        leave_type_id: TYPE_ID,
        status: "approved",
        start_date: "2026-11-12",
        end_date: "2026-11-12",
      },
      {
        id: "88000000-0000-4000-8000-000000000006",
        employee_id: APPROVER_ID,
        leave_type_id: TYPE_ID,
        status: "approved",
        start_date: "2026-12-20",
        end_date: "2026-12-21",
      },
    ],
    holidays: [
      { holiday_date: "2026-11-01", name: "วันทดสอบ" },
      { holiday_date: "2026-12-31", name: "สิ้นปี" },
    ],
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
    calls.push({ url, method, table });

    if (method !== "GET") return emptyResponse(method === "PATCH" ? 204 : 201);

    let rows = (state[table] ?? []).filter((row) => matches(row, parsed.searchParams));
    const rawLimit = parsed.searchParams.get("limit");
    if (rawLimit !== null) {
      const limit = Number(rawLimit);
      if (Number.isFinite(limit) && limit >= 0) rows = rows.slice(0, limit);
    }
    return jsonResponse(rows);
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

function calendarPath(query = NOVEMBER) {
  return `/api/leave/calendar?${query}`;
}

test("an employee sees only their own department, without the other department", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call(calendarPath(), TOKENS.employee);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.scope, "department");
  assert.equal(body.departmentId, DEPT_A);
  assert.equal(body.count, 2);

  const employees = body.events.map((event) => event.employeeName);
  assert.deepEqual(employees.sort(), ["นาง สมหญิง รักงาน", "นาง สมหญิง รักงาน"].sort());
  assert.equal(body.events.some((event) => event.departmentName === "ฝ่ายขาย"), false);
});

test("rejected and cancelled requests never reach the calendar", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const body = await (await call(calendarPath(), TOKENS.employee)).json();
  const statuses = body.events.map((event) => event.status).sort();

  assert.deepEqual(statuses, ["approved", "pending"]);
  const text = JSON.stringify(body);
  assert.equal(text.includes("rejected"), false);
  assert.equal(text.includes("cancelled"), false);
});

test("an approver is scoped exactly like an employee", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call(calendarPath(), TOKENS.approver);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.scope, "department");
  assert.equal(body.departmentId, DEPT_A);
  assert.equal(body.count, 2);
  assert.equal(body.events.some((event) => event.departmentName === "ฝ่ายขาย"), false);
});

test("an employee's departmentId is ignored instead of obeyed", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call(
    calendarPath(`${NOVEMBER}&departmentId=${DEPT_B}`),
    TOKENS.employee
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.departmentId, DEPT_A);
  assert.equal(body.count, 2);
  assert.equal(body.events.some((event) => event.departmentName === "ฝ่ายขาย"), false);
});

test("HR sees every department and can filter to one", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const all = await (await call(calendarPath(), TOKENS.hr)).json();
  assert.equal(all.scope, "all");
  assert.equal(all.count, 3);
  assert.equal(all.events.some((event) => event.departmentName === "ฝ่ายขาย"), true);

  const filtered = await (
    await call(calendarPath(`${NOVEMBER}&departmentId=${DEPT_B}`), TOKENS.hr)
  ).json();
  assert.equal(filtered.scope, "department");
  assert.equal(filtered.count, 1);
  assert.deepEqual(
    filtered.events.map((event) => event.departmentName),
    ["ฝ่ายขาย"]
  );
});

test("HR gets 400 for a departmentId that is not a uuid", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call(calendarPath(`${NOVEMBER}&departmentId=not-a-uuid`), TOKENS.hr);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.message, "รหัสแผนกไม่ถูกต้อง");
});

test("the response exposes display keys only", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call(calendarPath(), TOKENS.employee);
  const text = await response.text();
  const body = JSON.parse(text);

  assert.deepEqual(Object.keys(body.events[0]).sort(), [
    "departmentName",
    "employeeName",
    "endDate",
    "id",
    "leaveTypeLabel",
    "startDate",
    "status",
  ]);

  for (const forbidden of [
    "national_id",
    "national",
    "reason",
    "attachment",
    "certificate",
    "approver",
    "email",
    "phone",
  ]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test("a range longer than 62 days is refused", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call(calendarPath("from=2026-01-01&to=2026-03-04"), TOKENS.employee);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.message, "ช่วงวันที่ต้องไม่เกิน 62 วัน");
});

test("a 62-day range is accepted", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call(calendarPath("from=2026-11-01&to=2027-01-01"), TOKENS.employee);
  assert.equal(response.status, 200);
});

test("invalid or unordered dates are refused", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  for (const query of [
    "from=2026-02-30&to=2026-03-01",
    "from=2026-11-30&to=2026-11-01",
    "from=2026-11-01",
    "to=2026-11-30",
  ]) {
    const response = await call(calendarPath(query), TOKENS.employee);
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).ok, false, query);
  }
});

test("no session answers 401 on both reads", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  assert.equal((await call(calendarPath(), null)).status, 401);
  assert.equal((await call("/api/leave/holidays?from=2026-11-01&to=2026-11-30", null)).status, 401);
});

test("the holidays read returns only date and name", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/leave/holidays?from=2026-11-01&to=2026-11-30", TOKENS.employee);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.holidays.length, 1);
  assert.deepEqual(Object.keys(body.holidays[0]).sort(), ["date", "name"]);
  assert.deepEqual(body.holidays[0], { date: "2026-11-01", name: "วันทดสอบ" });
  assert.deepEqual(body.dates, ["2026-11-01"]);
});

test("the calendar route only reads", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  await call(calendarPath(), TOKENS.hr);

  const writes = fake.calls.filter((entry) => entry.method !== "GET");
  for (const write of writes) {
    assert.equal(write.table, "auth_sessions", `${write.method} ${write.table}`);
    assert.equal(write.method, "PATCH");
  }
  assert.equal(fake.calls.some((entry) => entry.table === "audit_logs"), false);
});
