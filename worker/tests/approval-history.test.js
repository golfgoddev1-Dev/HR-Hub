// GET /api/leave/approvals/history: an approver sees only their own decisions,
// HR sees every decision, everyone else is refused. Filters and pagination work
// and the list row never carries a reason.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const DEPT_A = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";
const APPROVER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_APPROVER_ID = "55555555-5555-4555-8555-555555555555";
const HR_ID = "66666666-6666-4666-8666-666666666666";
const TYPE_ID = "77777777-7777-4777-8777-777777777777";

const TOKENS = {
  employee: "e".repeat(43),
  approver: "a".repeat(43),
  other: "o".repeat(43),
  hr: "h".repeat(43),
};

const REASON = "เหตุผลส่วนตัวที่ห้ามหลุด";

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

function decidedRow(index, overrides = {}) {
  const day = String((index % 20) + 1).padStart(2, "0");
  return {
    id: `99000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    request_code: `LV-${1000 + index}`,
    employee_id: index % 2 === 0 ? EMPLOYEE_ID : OTHER_APPROVER_ID,
    approver_id: APPROVER_ID,
    leave_type_id: TYPE_ID,
    status: "approved",
    start_date: `2026-11-${day}`,
    end_date: `2026-11-${day}`,
    days: 1,
    reason: REASON,
    decided_at: `2026-11-${day}T03:00:00.000Z`,
    created_at: `2026-11-01T03:00:00.000Z`,
    ...overrides,
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

  // 52 approved decisions plus one rejected decision, all by APPROVER_ID, and
  // one decision by the other approver.
  const own = Array.from({ length: 52 }, (_, index) => decidedRow(index + 1));
  own.push(
    decidedRow(60, {
      status: "rejected",
      decided_at: "2026-11-21T03:00:00.000Z",
    })
  );

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
    departments: [{ id: DEPT_A, name: "ฝ่ายบุคคล", is_active: true }],
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
    employee_approvers: [
      { id: "ea-1", employee_id: EMPLOYEE_ID, approver_id: APPROVER_ID, priority: 1, is_active: true },
      {
        id: "ea-2",
        employee_id: EMPLOYEE_ID,
        approver_id: OTHER_APPROVER_ID,
        priority: 2,
        is_active: true,
      },
    ],
    department_approvers: [],
    leave_types: [{ id: TYPE_ID, name: "ลากิจ", is_active: true }],
    leave_requests: [
      ...own,
      decidedRow(70, {
        approver_id: OTHER_APPROVER_ID,
        decided_at: "2026-11-08T03:00:00.000Z",
      }),
      // Pending is not a decision and must never appear.
      decidedRow(71, {
        status: "pending",
        decided_at: null,
      }),
      // Outside November.
      decidedRow(72, {
        decided_at: "2026-10-01T03:00:00.000Z",
      }),
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
      const [column, direction] = order.split(".");
      rows = [...rows].sort((left, right) => {
        const compared = String(left[column] ?? "").localeCompare(String(right[column] ?? ""));
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

const BASE = "/api/leave/approvals/history?from=2026-11-01&to=2026-11-30";
const ROW_KEYS = [
  "decidedAt",
  "decision",
  "departmentName",
  "days",
  "employeeName",
  "endDate",
  "id",
  "leaveTypeName",
  "startDate",
];

test("an approver gets only their own decisions, without a reason", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call(BASE, TOKENS.approver);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.pageSize, 50);
  assert.equal(body.hasMore, true);
  assert.equal(body.count, 50);
  assert.deepEqual(Object.keys(body.results[0]).sort(), [...ROW_KEYS].sort());

  const text = JSON.stringify(body);
  assert.equal(text.includes(REASON), false);
  assert.equal(text.includes("reason"), false);
  assert.equal(text.includes("pending"), false);

  // The response is already the approver's own scope.
  assert.equal(body.results.every((row) => row.decision !== "pending"), true);
});

test("the second page continues without repeating a decision", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const first = await (await call(`${BASE}&page=1`, TOKENS.approver)).json();
  const second = await (await call(`${BASE}&page=2`, TOKENS.approver)).json();

  assert.equal(second.hasMore, false);
  assert.equal(second.count, 3);
  const ids = new Set(first.results.map((row) => row.id));
  assert.equal(second.results.some((row) => ids.has(row.id)), false);
});

test("decision, date range and name filters narrow the list", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const rejected = await (
    await call(`${BASE}&decision=rejected`, TOKENS.approver)
  ).json();
  assert.equal(rejected.count, 1);
  assert.equal(rejected.results[0].decision, "rejected");

  const approved = await (
    await call(`${BASE}&decision=approved`, TOKENS.approver)
  ).json();
  assert.equal(approved.results.every((row) => row.decision === "approved"), true);

  const narrow = await (
    await call(
      "/api/leave/approvals/history?from=2026-11-05&to=2026-11-06",
      TOKENS.approver
    )
  ).json();
  assert.equal(narrow.count > 0, true);
  assert.equal(
    narrow.results.every(
      (row) => row.decidedAt >= "2026-11-05T00:00:00.000Z" && row.decidedAt <= "2026-11-06T23:59:59.999Z"
    ),
    true
  );

  const searched = await (
    await call(`${BASE}&search=${encodeURIComponent("สมชาย")}`, TOKENS.approver)
  ).json();
  assert.equal(searched.count > 0, true);
  assert.equal(searched.results.every((row) => row.employeeName.includes("สมชาย")), true);
});

test("HR sees decisions by every approver", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const body = await (await call(`${BASE}&pageSize=50`, TOKENS.hr)).json();
  assert.equal(body.ok, true);
  // 52 + 1 rejected + 1 other approver + 1 outside the range (not returned) = 54.
  assert.equal(body.hasMore, true);

  const all = await (await call(`${BASE}&page=2`, TOKENS.hr)).json();
  const ids = new Set([...body.results, ...all.results].map((row) => row.id));
  assert.equal(ids.size, 54);
});

test("a non-approver is refused, and an invalid filter is a 400", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const denied = await call(BASE, TOKENS.employee);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).message, "ไม่มีสิทธิ์เข้าถึงส่วนนี้");

  const bad = await call(`${BASE}&decision=maybe`, TOKENS.approver);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).ok, false);

  assert.equal((await call(BASE, null)).status, 401);
});
