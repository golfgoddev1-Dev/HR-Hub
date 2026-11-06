// GET /api/leave/approvals/count is the number behind the dock badge. It must
// be the caller's own queue and nothing else, refuse everyone who is not an
// active approver, and answer 304 when the client's tag still matches. The body
// is the number only: no request ids, no names, no details.
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
const REQUESTER_ID = "44444444-4444-4444-8444-444444444444";
const REQUESTER_B_ID = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const DECIDED_ID = "77777777-7777-4777-8777-777777777777";
const DEPARTMENT_REQUEST_1 = "88888888-8888-4888-8888-888888888888";
const DEPARTMENT_REQUEST_2 = "99999999-9999-4999-8999-999999999999";
const TYPE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEPT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DEPT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const TOKENS = {
  personal: "p".repeat(43),
  department: "d".repeat(43),
  plain: "n".repeat(43),
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
    if (value.startsWith("eq.")) {
      if (actual !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("in.(")) {
      const list = value.slice(4, -1).split(",");
      if (!list.includes(actual)) return false;
    }
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

  const pending = (id, approverId, employeeId, createdAt) => ({
    id,
    request_code: `LV-${createdAt.slice(0, 10).replace(/-/g, "")}-001`,
    employee_id: employeeId,
    approver_id: approverId,
    leave_type_id: TYPE_ID,
    status: "pending",
    days: 1,
    start_date: "2026-11-09",
    end_date: "2026-11-09",
    created_at: createdAt,
    updated_at: createdAt,
  });

  return {
    auth_sessions: [
      await session(TOKENS.personal, PERSONAL_ID),
      await session(TOKENS.department, DEPARTMENT_ID),
      await session(TOKENS.plain, PLAIN_ID),
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
        id: REQUESTER_ID,
        employee_code: "EMP-00004",
        full_name: "ผู้ยื่น ใบลา",
        department_id: DEPT_A,
        is_active: true,
      },
      {
        id: REQUESTER_B_ID,
        employee_code: "EMP-00005",
        full_name: "ผู้ยื่น คนที่สอง",
        department_id: DEPT_B,
        is_active: true,
      },
    ],
    // PERSONAL_ID approves REQUESTER_ID personally.
    employee_approvers: [
      {
        id: "ea-1",
        employee_id: REQUESTER_ID,
        approver_id: PERSONAL_ID,
        priority: 1,
        is_active: true,
      },
    ],
    // DEPARTMENT_ID approves all of DEPT_B.
    department_approvers: [
      {
        id: "da-1",
        department_id: DEPT_B,
        employee_id: DEPARTMENT_ID,
        priority: 1,
        is_active: true,
      },
    ],
    leave_requests: [
      pending(REQUEST_ID, PERSONAL_ID, REQUESTER_ID, "2026-11-05T02:00:00.000Z"),
      // A decided request never counts.
      {
        id: DECIDED_ID,
        request_code: "LV-20261101-001",
        employee_id: REQUESTER_ID,
        approver_id: PERSONAL_ID,
        leave_type_id: TYPE_ID,
        status: "approved",
        days: 1,
        start_date: "2026-11-02",
        end_date: "2026-11-02",
        created_at: "2026-11-01T02:00:00.000Z",
        updated_at: "2026-11-02T02:00:00.000Z",
      },
      pending(DEPARTMENT_REQUEST_1, DEPARTMENT_ID, REQUESTER_B_ID, "2026-11-04T02:00:00.000Z"),
      pending(DEPARTMENT_REQUEST_2, DEPARTMENT_ID, REQUESTER_B_ID, "2026-11-05T03:00:00.000Z"),
    ],
    leave_types: [{ id: TYPE_ID, name: "ลากิจ", requires_attachment: false, is_active: true }],
    departments: [
      { id: DEPT_A, name: "ฝ่ายบุคคล", is_active: true },
      { id: DEPT_B, name: "ฝ่ายปฏิบัติการ", is_active: true },
    ],
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
    calls.push({ url, method, table });

    if (method === "HEAD") {
      const rows = (state[table] ?? []).filter((row) => matches(row, parsed.searchParams));
      // db.count reads the total from this header and nothing else.
      return new Response(null, {
        status: 200,
        headers: { "Content-Range": `0-0/${rows.length}` },
      });
    }
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

function call(path, token, headers = {}) {
  const init = token
    ? { headers: { Cookie: `hr_session=${token}`, ...headers } }
    : { headers };
  return app.request(`https://fake.local${path}`, init, ENV);
}

// The session guard keeps its own `select=id` pending read; a queue read is the
// one this route makes (the HEAD count) or a real row select.
function queueReads(fake) {
  return fake.calls.filter((entry) => {
    if (entry.table !== "leave_requests") return false;
    if (entry.method === "HEAD") return true;
    const select = String(new URL(entry.url).searchParams.get("select") ?? "");
    return select.includes("request_code") || select.includes("updated_at");
  });
}

test("answers the caller's own pending count only", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const personal = await call("/api/leave/approvals/count", TOKENS.personal);
  const personalBody = await personal.json();
  assert.equal(personal.status, 200);
  assert.equal(personalBody.ok, true);
  // One pending row belongs to PERSONAL_ID; the approved one does not count.
  assert.equal(personalBody.count, 1);

  const department = await call("/api/leave/approvals/count", TOKENS.department);
  const departmentBody = await department.json();
  assert.equal(department.status, 200);
  // Two pending rows belong to DEPARTMENT_ID, not the other approver's one.
  assert.equal(departmentBody.count, 2);
});

test("refuses a non-approver with 403 and no queue read", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/leave/approvals/count", TOKENS.plain);
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.ok, false);
  assert.equal(body.message, "ไม่มีสิทธิ์เข้าถึงส่วนนี้");
  assert.deepEqual(queueReads(fake), []);
});

test("answers 304 with no body when If-None-Match matches", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const first = await call("/api/leave/approvals/count", TOKENS.personal);
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  const cacheControl = first.headers.get("cache-control");
  assert.ok(etag, "the response carries an ETag");
  assert.match(etag, /^W\/"/);
  assert.match(cacheControl, /private/);
  assert.match(cacheControl, /no-cache/);

  const second = await call("/api/leave/approvals/count", TOKENS.personal, {
    "If-None-Match": etag,
  });

  assert.equal(second.status, 304);
  assert.equal(await second.text(), "");
  assert.equal(second.headers.get("etag"), etag);
  assert.match(second.headers.get("cache-control"), /private/);
});

test("the body carries the number only", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/leave/approvals/count", TOKENS.personal);
  const text = await response.text();
  const body = JSON.parse(text);

  assert.deepEqual(Object.keys(body).sort(), ["count", "ok"]);
  assert.equal(typeof body.count, "number");
  for (const forbidden of [REQUEST_ID, "LV-2026", "ผู้ยื่น ใบลา", "EMP-00004", "ลากิจ"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  assert.equal(fake.calls.some((entry) => entry.table === "audit_logs"), false);
});
