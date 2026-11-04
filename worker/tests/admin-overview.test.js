// GET /api/admin/overview
// - only a system_admin session gets numbers; hr and employee sessions get 403
//   (the role comes from requireRole, so those refusals are the existing gate);
// - every number is a database count (HEAD + Prefer: count=exact), never a list
//   of rows counted in memory, and nothing is written or audited;
// - the body carries totals only, so no name, code, national ID or email.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";
import { bangkokYear } from "../src/routes/admin.js";
import { countFromContentRange } from "../src/db.js";

const ADMIN_TOKEN = "a".repeat(43);
const HR_TOKEN = "h".repeat(43);
const EMPLOYEE_TOKEN = "e".repeat(43);
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const HR_ID = "22222222-2222-4222-8222-222222222222";
const EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";
const GONE_ID = "44444444-4444-4444-8444-444444444444";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const OVERVIEW_URL = "https://fake.local/api/admin/overview";
const YEAR = bangkokYear();

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

/** PostgREST's answer to HEAD + Prefer: count=exact + Range: 0-0. */
function countResponse(total) {
  return new Response(null, {
    status: 200,
    headers: { "Content-Range": `0-0/${total}` },
  });
}

function matches(row, params) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "or"].includes(key)) continue;
    const actual = row[key] === undefined ? "" : String(row[key]);
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (actual !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("gte.")) {
      if (actual < value.slice(4)) return false;
      continue;
    }
    if (value.startsWith("lte.")) {
      if (actual > value.slice(4)) return false;
    }
  }
  return true;
}

function tableOf(url) {
  return new URL(url).pathname.split("/").pop();
}

function buildState() {
  return {
    employees: [
      { id: ADMIN_ID, full_name: "ผู้ดูแล ระบบ", is_active: true },
      { id: HR_ID, full_name: "เจ้าหน้าที่ ระบบ", is_active: true },
      { id: EMPLOYEE_ID, full_name: "พนักงาน ระบบ", is_active: true },
      { id: GONE_ID, full_name: "ลาออก แล้ว", is_active: false },
    ],
    leave_requests: [
      { id: "l1", status: "pending", approver_id: HR_ID },
      { id: "l2", status: "pending", approver_id: HR_ID },
      { id: "l3", status: "approved", approver_id: HR_ID },
    ],
    department_approvers: [
      { id: "d1", is_active: true },
      { id: "d2", is_active: false },
    ],
    employee_approvers: [{ id: "e1", is_active: true }],
    holidays: [
      { holiday_date: `${YEAR}-01-01`, name: "วันขึ้นปีใหม่" },
      { holiday_date: `${YEAR}-04-13`, name: "สงกรานต์" },
      { holiday_date: `${Number(YEAR) - 1}-12-31`, name: "ปีก่อน" },
    ],
    hr_admins: [{ employee_id: HR_ID }],
    meeting_admins: [],
    system_admins: [{ employee_id: ADMIN_ID }],
  };
}

function installFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const call = {
      url: String(input),
      init,
      method: init.method ?? "GET",
      headers: init.headers ?? {},
    };
    calls.push(call);
    return handler(call);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

async function createFake({ state = buildState(), failTable = null } = {}) {
  const now = new Date();
  const session = async (token, employeeId, role, id) => ({
    id,
    token_hash: await sha256Hex(token),
    employee_id: employeeId,
    login_role: role,
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  });

  const sessions = [
    await session(ADMIN_TOKEN, ADMIN_ID, "system_admin", "session-admin"),
    await session(HR_TOKEN, HR_ID, "hr", "session-hr"),
    await session(EMPLOYEE_TOKEN, EMPLOYEE_ID, "employee", "session-emp"),
  ];

  const fake = installFetch(({ url, method, headers }) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    const table = tableOf(url);

    if (method === "HEAD") {
      if (failTable === table) return emptyResponse(503);
      const rows = (state[table] ?? []).filter((row) => matches(row, params));
      return countResponse(rows.length);
    }

    if (method === "GET") {
      if (table === "auth_sessions") {
        const raw = params.get("token_hash");
        const wanted = raw && raw.startsWith("eq.") ? raw.slice(3) : null;
        return jsonResponse(sessions.filter((row) => wanted === null || row.token_hash === wanted));
      }
      if (table === "employee_credentials") return jsonResponse([]);
      return jsonResponse((state[table] ?? []).filter((row) => matches(row, params)));
    }

    if (method === "PATCH") return emptyResponse(204);
    return emptyResponse(201);
  });

  return fake;
}

function request(token) {
  const init = token ? { headers: { Cookie: `hr_session=${token}` } } : {};
  return app.request(OVERVIEW_URL, init, ENV);
}

/** Every HEAD the route made against the counted tables. */
function countCalls(fake) {
  return fake.calls.filter((call) => call.method === "HEAD");
}

test("system_admin gets the four totals from database counts", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request(ADMIN_TOKEN);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.year, YEAR);
  assert.deepEqual(body.counts, {
    activeEmployees: 3,
    pendingLeave: 2,
    activeApprovers: 2,
    holidays: 2,
  });

  // Five counts, one per table read, each the database's exact count.
  const counts = countCalls(fake);
  assert.equal(counts.length, 5);
  for (const call of counts) {
    assert.equal(call.headers.Prefer, "count=exact");
    assert.equal(call.headers.Range, "0-0");
  }

  // No rows are fetched to be tallied: no GET of the counted tables other than
  // the session lookups, and no audit or other write.
  const rowReads = fake.calls.filter((call) => {
    if (call.method !== "GET") return false;
    return ["leave_requests", "department_approvers", "employee_approvers", "holidays"].includes(
      tableOf(call.url)
    );
  });
  assert.deepEqual(rowReads, []);
  assert.equal(fake.calls.some((call) => call.url.includes("audit_logs")), false);
  assert.equal(fake.calls.some((call) => call.method === "POST"), false);
  assert.equal(fake.calls.some((call) => call.method === "DELETE"), false);
});

test("the holiday count is limited to the Bangkok year", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  await request(ADMIN_TOKEN);

  const holidayCall = countCalls(fake).find((call) => tableOf(call.url) === "holidays");
  const raw = holidayCall.url;
  assert.equal(raw.includes(`holiday_date=gte.${YEAR}-01-01`), true);
  assert.equal(raw.includes(`holiday_date=lte.${YEAR}-12-31`), true);
  assert.equal(raw.includes(`${Number(YEAR) - 1}`), false);
});

test("the response carries no personal data", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request(ADMIN_TOKEN);
  const text = await response.text();
  const body = JSON.parse(text);

  assert.deepEqual(Object.keys(body).sort(), ["counts", "ok", "year"]);
  assert.deepEqual(Object.keys(body.counts).sort(), [
    "activeApprovers",
    "activeEmployees",
    "holidays",
    "pendingLeave",
  ]);

  for (const forbidden of ["full_name", "employee_code", "name", "email", "national", "ผู้ดูแล ระบบ"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  assert.equal(/\d{13}/.test(text), false);
});

test("hr and employee sessions are refused, and anonymous callers too", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  for (const token of [HR_TOKEN, EMPLOYEE_TOKEN]) {
    const response = await request(token);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).ok, false);
  }

  const anonymous = await request(null);
  assert.equal(anonymous.status, 401);

  // A refused caller never reaches the counting queries.
  assert.equal(countCalls(fake).length, 0);
});

test("a failed count answers 500 without leaking the database error", async (t) => {
  const fake = await createFake({ failTable: "leave_requests" });
  t.after(() => fake.restore());

  const response = await request(ADMIN_TOKEN);
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.ok, false);
  assert.equal(body.message, "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง");
  assert.equal(JSON.stringify(body).includes("postgrest"), false);
});

test("countFromContentRange reads the total and refuses anything else", () => {
  assert.equal(countFromContentRange("0-0/42"), 42);
  assert.equal(countFromContentRange("*/0"), 0);
  assert.equal(countFromContentRange("0-9/128"), 128);
  assert.equal(countFromContentRange("0-0/*"), null);
  assert.equal(countFromContentRange("0-0/abc"), null);
  assert.equal(countFromContentRange(null), null);
});
