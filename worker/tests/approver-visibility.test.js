// Approver visibility by responsibility:
// - a department grant shows that department and nothing else;
// - a named grant shows that one employee, not their colleagues;
// - both grants show the union without duplicates;
// - an approver's own department is not an implicit grant;
// - HR is unchanged, and a plain employee keeps the department calendar
//   without the review fields.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const DEPT_FIN = "11111111-1111-4111-8111-111111111111";
const DEPT_ACC = "22222222-2222-4222-8222-222222222222";
const EMP_F1 = "33333333-3333-4333-8333-333333333333";
const EMP_F2 = "44444444-4444-4444-8444-444444444444";
const EMP_A1 = "55555555-5555-4555-8555-555555555555";
const EMP_A2 = "66666666-6666-4666-8666-666666666666";
const FIN_APPROVER = "77777777-7777-4777-8777-777777777777";
const NAMED_APPROVER = "88888888-8888-4888-8888-888888888888";
const BOTH_APPROVER = "99999999-9999-4999-8999-999999999999";
const OUTSIDER_APPROVER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TYPE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const R_F1 = "dd000000-0000-4000-8000-000000000001";
const R_F2 = "dd000000-0000-4000-8000-000000000002";
const R_F3 = "dd000000-0000-4000-8000-000000000003";
const R_A1 = "dd000000-0000-4000-8000-000000000004";
const R_A2 = "dd000000-0000-4000-8000-000000000005";
const R_A3 = "dd000000-0000-4000-8000-000000000006";
const R_A4 = "dd000000-0000-4000-8000-000000000007";

const TOKENS = {
  employee: "e".repeat(43),
  fin: "f".repeat(43),
  named: "n".repeat(43),
  both: "b".repeat(43),
  outsider: "o".repeat(43),
  hr: "h".repeat(43),
};

const NOVEMBER = "/api/leave/calendar?from=2026-11-01&to=2026-11-30";

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

function leaveRow(id, employeeId, status, day, approverId, decidedAt = null) {
  return {
    id,
    request_code: `LV-${day}`,
    employee_id: employeeId,
    approver_id: approverId,
    leave_type_id: TYPE_ID,
    status,
    start_date: `2026-11-${day}`,
    end_date: `2026-11-${day}`,
    days: 1,
    reason: `เหตุผลของ ${employeeId.slice(0, 2)}`,
    decision_note: null,
    decided_at: decidedAt,
    updated_at: decidedAt,
    created_at: "2026-11-01T03:00:00.000Z",
  };
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
      await session(TOKENS.employee, EMP_F1, "employee"),
      await session(TOKENS.fin, FIN_APPROVER, "employee"),
      await session(TOKENS.named, NAMED_APPROVER, "employee"),
      await session(TOKENS.both, BOTH_APPROVER, "employee"),
      await session(TOKENS.outsider, OUTSIDER_APPROVER, "employee"),
      await session(TOKENS.hr, HR_ID, "hr"),
    ],
    hr_admins: [{ employee_id: HR_ID }],
    meeting_admins: [],
    system_admins: [],
    employee_credentials: [],
    departments: [
      { id: DEPT_FIN, name: "ฝ่ายการเงิน", is_active: true },
      { id: DEPT_ACC, name: "ฝ่ายบัญชี", is_active: true },
    ],
    employees: [
      { id: EMP_F1, employee_code: "EMP-F1", name_prefix: "นาย", full_name: "การเงิน หนึ่ง", department_id: DEPT_FIN, is_active: true },
      { id: EMP_F2, employee_code: "EMP-F2", name_prefix: "นาง", full_name: "การเงิน สอง", department_id: DEPT_FIN, is_active: true },
      { id: EMP_A1, employee_code: "EMP-A1", name_prefix: "นาย", full_name: "บัญชี หนึ่ง", department_id: DEPT_ACC, is_active: true },
      { id: EMP_A2, employee_code: "EMP-A2", name_prefix: "นาง", full_name: "บัญชี สอง", department_id: DEPT_ACC, is_active: true },
      { id: FIN_APPROVER, employee_code: "EMP-FIN", name_prefix: null, full_name: "หัวหน้า การเงิน", department_id: DEPT_ACC, is_active: true },
      { id: NAMED_APPROVER, employee_code: "EMP-NAMED", name_prefix: null, full_name: "หัวหน้า ส่วนตัว", department_id: DEPT_FIN, is_active: true },
      { id: BOTH_APPROVER, employee_code: "EMP-BOTH", name_prefix: null, full_name: "หัวหน้า สองสิทธิ์", department_id: DEPT_ACC, is_active: true },
      { id: OUTSIDER_APPROVER, employee_code: "EMP-OUT", name_prefix: null, full_name: "หัวหน้า บัญชี", department_id: DEPT_FIN, is_active: true },
      { id: HR_ID, employee_code: "EMP-HR", name_prefix: "นางสาว", full_name: "ฝ่าย บุคคล", department_id: DEPT_FIN, is_active: true },
    ],
    // FIN_APPROVER sits in Accounting but is NOT its approver: their own
    // department must not widen the Finance grant.
    employee_approvers: [
      { id: "ea-1", employee_id: EMP_A1, approver_id: NAMED_APPROVER, priority: 1, is_active: true },
      { id: "ea-2", employee_id: EMP_A1, approver_id: BOTH_APPROVER, priority: 2, is_active: true },
    ],
    department_approvers: [
      { id: "da-1", employee_id: FIN_APPROVER, department_id: DEPT_FIN, priority: 1, is_active: true },
      { id: "da-2", employee_id: BOTH_APPROVER, department_id: DEPT_FIN, priority: 1, is_active: true },
      { id: "da-3", employee_id: OUTSIDER_APPROVER, department_id: DEPT_ACC, priority: 1, is_active: true },
    ],
    leave_types: [{ id: TYPE_ID, name: "ลากิจ", is_active: true }],
    leave_requests: [
      // Finance.
      leaveRow(R_F1, EMP_F1, "approved", "05", FIN_APPROVER, "2026-11-05T03:00:00.000Z"),
      leaveRow(R_F2, EMP_F2, "pending", "10", FIN_APPROVER),
      leaveRow(R_F3, EMP_F2, "approved", "12", BOTH_APPROVER, "2026-11-12T03:00:00.000Z"),
      // Accounting: R_A1 is the named employee, the rest are colleagues.
      leaveRow(R_A1, EMP_A1, "approved", "06", NAMED_APPROVER, "2026-11-06T03:00:00.000Z"),
      leaveRow(R_A2, EMP_A2, "approved", "07", FIN_APPROVER, "2026-11-07T03:00:00.000Z"),
      leaveRow(R_A3, EMP_A2, "pending", "09", FIN_APPROVER),
      leaveRow(R_A4, EMP_A2, "approved", "08", BOTH_APPROVER, "2026-11-08T03:00:00.000Z"),
    ],
    holidays: [],
    audit_logs: [],
  };
}

async function createBackend() {
  const state = await buildState();
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const parsed = new URL(String(input));
    const table = parsed.pathname.split("/").pop();
    if (method !== "GET") return new Response(null, { status: 204 });

    let rows = (state[table] ?? []).filter((row) => matches(row, parsed.searchParams));
    const order = parsed.searchParams.get("order");
    if (order) {
      const [column, direction, nulls] = order.split(".");
      rows = [...rows].sort((left, right) => {
        const a = left[column] ?? "";
        const b = right[column] ?? "";
        if (nulls === "nullslast") {
          if (a === null || a === "") return 1;
          if (b === null || b === "") return -1;
        }
        const compared = String(a).localeCompare(String(b));
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

function eventIds(body) {
  return body.events.map((event) => event.id).sort();
}

test("a department approver sees that department only, never another department", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const body = await (await call(NOVEMBER, TOKENS.fin)).json();

  assert.deepEqual(eventIds(body), [R_F1, R_F2, R_F3].sort());
  assert.deepEqual(body.dayCounts, { "2026-11-05": 1, "2026-11-12": 1 });
  assert.equal(body.events.some((event) => event.departmentName === "ฝ่ายบัญชี"), false);
});

test("a named approver sees the named employee only, not their colleagues", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const body = await (await call(NOVEMBER, TOKENS.named)).json();

  assert.deepEqual(eventIds(body), [R_A1]);
  assert.deepEqual(body.dayCounts, { "2026-11-06": 1 });
  assert.equal(body.events.some((event) => event.id === R_A2), false);
  assert.equal(body.events.some((event) => event.id === R_A4), false);
});

test("both grants show the union without duplicates", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const body = await (await call(NOVEMBER, TOKENS.both)).json();
  const ids = eventIds(body);

  assert.deepEqual(ids, [R_F1, R_F2, R_F3, R_A1].sort());
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(body.dayCounts, {
    "2026-11-05": 1,
    "2026-11-06": 1,
    "2026-11-12": 1,
  });
});

test("an approver's own department does not widen the grant", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  // FIN_APPROVER works in Accounting but is only the Finance approver.
  const body = await (await call(NOVEMBER, TOKENS.fin)).json();
  assert.equal(body.events.some((event) => event.id === R_A1), false);
  assert.equal(body.events.some((event) => event.id === R_A3), false);
});

test("a foreign department filter returns only the visible rows", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const body = await (
    await call(`${NOVEMBER}&departmentId=${DEPT_ACC}`, TOKENS.fin)
  ).json();

  assert.equal(body.ok, true);
  assert.equal(body.departmentId, null);
  assert.deepEqual(eventIds(body), [R_F1, R_F2, R_F3].sort());
  assert.equal(body.events.some((event) => event.departmentName === "ฝ่ายบัญชี"), false);
});

test("the pending queue and the badge count use the same rule", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  // R_F2 and R_A3 are both assigned to FIN_APPROVER; only R_F2 is in scope.
  const queue = await (await call("/api/leave/approvals", TOKENS.fin)).json();
  assert.deepEqual(queue.results.map((row) => row.id), [R_F2]);

  const count = await (await call("/api/leave/approvals/count", TOKENS.fin)).json();
  assert.equal(count.count, 1);
});

test("history shows only decisions the caller made inside their grants", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const fin = await (
    await call("/api/leave/approvals/history?from=2026-11-01&to=2026-11-30", TOKENS.fin)
  ).json();
  // The Accounting decision R_A2 was made by FIN_APPROVER but is out of scope.
  assert.deepEqual(fin.results.map((row) => row.id), [R_F1]);

  const both = await (
    await call("/api/leave/approvals/history?from=2026-11-01&to=2026-11-30", TOKENS.both)
  ).json();
  // R_A4 was decided by BOTH_APPROVER, but EMP_A2 is neither a named grant nor
  // in the Finance department, so responsibility hides it.
  assert.deepEqual(both.results.map((row) => row.id), [R_F3]);

  const named = await (
    await call("/api/leave/approvals/history?from=2026-11-01&to=2026-11-30", TOKENS.named)
  ).json();
  assert.deepEqual(named.results.map((row) => row.id), [R_A1]);
});

test("detail follows the same grants, and the requester is still refused", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  assert.equal((await call(`/api/leave/requests/${R_F1}`, TOKENS.fin)).status, 200);
  assert.equal((await call(`/api/leave/requests/${R_A1}`, TOKENS.fin)).status, 403);
  assert.equal((await call(`/api/leave/requests/${R_A1}`, TOKENS.named)).status, 200);
  assert.equal((await call(`/api/leave/requests/${R_F1}`, TOKENS.named)).status, 403);
  assert.equal((await call(`/api/leave/requests/${R_F1}`, TOKENS.both)).status, 200);
  assert.equal((await call(`/api/leave/requests/${R_A1}`, TOKENS.both)).status, 200);
  assert.equal((await call(`/api/leave/requests/${R_F1}`, TOKENS.employee)).status, 403);

  const fin = await (await call(`/api/leave/requests/${R_F1}`, TOKENS.fin)).json();
  assert.equal(fin.request.reason.startsWith("เหตุผล"), true);
});

test("HR sees everything, and a plain employee keeps department visibility without the reason", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const hr = await (await call(NOVEMBER, TOKENS.hr)).json();
  assert.equal(hr.scope, "all");
  assert.equal(hr.events.length, 7);
  assert.equal(
    hr.events.every((event) => typeof event.detail?.reason === "string"),
    true
  );

  const employee = await (await call(NOVEMBER, TOKENS.employee)).json();
  // EMP_F1 is a plain employee in Finance: the department rows, no review fields.
  assert.deepEqual(eventIds(employee), [R_F1, R_F2, R_F3].sort());
  assert.equal(employee.events.every((event) => !event.detail), true);
  assert.equal(JSON.stringify(employee).includes("เหตุผลของ"), false);
});

test("signed-out reads are 401 on every path", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  assert.equal((await call(NOVEMBER, null)).status, 401);
  assert.equal((await call("/api/leave/approvals", null)).status, 401);
  assert.equal((await call("/api/leave/approvals/history", null)).status, 401);
  assert.equal((await call(`/api/leave/requests/${R_F1}`, null)).status, 401);
});
