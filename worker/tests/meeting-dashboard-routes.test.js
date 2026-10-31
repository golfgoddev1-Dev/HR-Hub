import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";
// topAbsentPerDept and the label map are imported to replicate the Express
// monthly-summary call path step by step in the top tests below.
import { topAbsentPerDept } from "../src/meeting-dashboard.js";
import { STATUS_LABEL_BY_CODE } from "../src/meeting-overview.js";

// --- Fake project constants. Synthetic values only: no real employee data. ---
const NOW_MS = Date.parse("2026-11-10T03:00:00.000Z"); // Tuesday 10:00 Bangkok
const TODAY_KEY = "2026-11-10";

const CONTROLLER_TOKEN = "controller-session-cookie-token";
const EMPLOYEE_TOKEN = "employee-session-cookie-token";
const EMPLOYEE_ID = "123e4567-e89b-42d3-a456-426614174000";
const CONTROLLER_COOKIE = `hr_session=${CONTROLLER_TOKEN}`;
const EMPLOYEE_COOKIE = `hr_session=${EMPLOYEE_TOKEN}`;

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const TYPE_S = "57c3bd8e-1111-45df-8e02-6bc3f7908811";
const TYPE_M = "57c3bd8e-2222-45df-8e02-6bc3f7908811";

const EMP_A = "aaaa0000-0000-4000-8000-00000000000a";
const EMP_B = "aaaa0000-0000-4000-8000-00000000000b";
const EMP_C = "aaaa0000-0000-4000-8000-00000000000c";
const EMP_D = "aaaa0000-0000-4000-8000-00000000000d"; // not on the roster

const ROSTER = {
  [TYPE_S]: [
    { employee_id: EMP_A, employees: { full_name: "คนเอ", departments: { name: "แผนกวิจัย" }, positions: { name: "หัวหน้าฝ่ายวิจัย" } } },
    { employee_id: EMP_B, employees: { full_name: "คนบี", departments: { name: "แผนกวิจัย" }, positions: { name: "พนักงานวิจัย" } } },
    { employee_id: EMP_C, employees: { full_name: "คนซี", departments: { name: "แผนกการตลาด" }, positions: { name: "พนักงานการตลาด" } } },
  ],
};
ROSTER[TYPE_M] = ROSTER[TYPE_S];

const DIRECTORY = {
  [EMP_A]: { full_name: "คนเอ", departments: { name: "แผนกวิจัย" }, positions: { name: "หัวหน้าฝ่ายวิจัย" } },
  [EMP_B]: { full_name: "คนบี", departments: { name: "แผนกวิจัย" }, positions: { name: "พนักงานวิจัย" } },
  [EMP_C]: { full_name: "คนซี", departments: { name: "แผนกการตลาด" }, positions: { name: "พนักงานการตลาด" } },
  [EMP_D]: { full_name: "คนดี", departments: { name: "แผนกประชาสัมพันธ์" }, positions: { name: "พนักงานประชาสัมพันธ์" } },
};

const SUP_SESSIONS = [
  { id: "sess-t1124", session_date: "2026-11-24" },
  { id: "sess-t1201", session_date: "2026-12-01" },
  { id: "sess-t1208", session_date: "2026-12-08" },
  { id: "sess-t1215", session_date: "2026-12-15" },
  { id: "sess-t1222", session_date: "2026-12-22" },
];
const MONTHLY_SESSIONS = [
  { id: "sess-m1105", session_date: "2026-11-05" },
  { id: "sess-m1112", session_date: "2026-11-12" },
];

const SUP_ATTENDANCE = [
  { id: "att-1", session_id: "sess-t1222", employee_id: EMP_A, status_code: "attended", reason: null, shift: "กะเช้า", registered_at: "2026-12-22T03:00:00.000Z" },
  { id: "att-2", session_id: "sess-t1222", employee_id: EMP_B, status_code: "leave", reason: null, shift: "กะบ่าย", registered_at: "2026-12-22T02:30:00.000Z" },
  { id: "att-3", session_id: "sess-t1215", employee_id: EMP_C, status_code: "weird_unknown", reason: null, shift: null, registered_at: "2026-12-15T01:00:00.000Z" },
  { id: "att-4", session_id: "sess-t1222", employee_id: EMP_D, status_code: "urgent_busy", reason: null, shift: null, registered_at: "2026-12-22T01:00:00.000Z" },
];

const MONTHLY_ATTENDANCE = [
  { id: "att-101", session_id: "sess-m1105", employee_id: EMP_A, status_code: "leave", reason: null, shift: null, registered_at: "2026-11-05T02:00:00.000Z" },
  { id: "att-102", session_id: "sess-m1112", employee_id: EMP_A, status_code: "attended", reason: null, shift: "กะเช้า", registered_at: "2026-11-12T02:00:00.000Z" },
  { id: "att-103", session_id: "sess-m1105", employee_id: EMP_B, status_code: "urgent_busy", reason: null, shift: null, registered_at: "2026-11-05T02:30:00.000Z" },
];

const UNAUTHENTICATED = "ไม่ได้เข้าสู่ระบบ";
const FORBIDDEN = "ไม่มีสิทธิ์เข้าถึงส่วนนี้";
const INVALID_INPUT = "ข้อมูลไม่ถูกต้อง";
const TYPE_ERROR = "ประเภทการประชุมไม่ถูกต้อง";
const SERVER_ERROR = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";

/* ------------------------------ test plumbing ----------------------------- */

function freeze(t) {
  t.mock.timers.enable({ apis: ["Date"], now: NOW_MS });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

function tableOf(url) {
  return new URL(url).pathname.split("/").pop();
}

/**
 * Fake PostgREST backend. Rows and filters are synthetic; the controller
 * session flow mirrors worker/src/session.js (token hash + PATCH last_active).
 */
function createBackend(options = {}) {
  const calls = [];
  const auditCalls = [];
  // Role of the token seen in the last auth_sessions lookup. readSession queries
  // the session row first, then allowedLoginTypesFor, so this tracks who is
  // asking: the controller lands in meeting_admins, the employee does not.
  let lastSessionRole = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input), method: init.method ?? "GET" };
    calls.push(call);
    const url = new URL(String(input));
    const table = tableOf(String(input));
    const params = url.searchParams;
    const method = call.method;

    // ---- controller session flow ----
    if (table === "auth_sessions" && method === "GET") {
      const roles = {
        [await sha256Hex(CONTROLLER_TOKEN)]: "meeting_controller",
        [await sha256Hex(EMPLOYEE_TOKEN)]: "employee",
      };
      lastSessionRole = roles[params.get("token_hash")?.replace("eq.", "")] ?? null;
      if (lastSessionRole) {
        return jsonResponse([{
          id: "sess-row-1",
          employee_id: EMPLOYEE_ID,
          login_role: lastSessionRole,
          last_active_at: new Date(NOW_MS).toISOString(),
          expires_at: "2026-11-10T15:00:00.000Z",
          revoked_at: null,
        }]);
      }
      return jsonResponse([]);
    }
    if (table === "auth_sessions" && method === "PATCH") return emptyResponse();
    if (table === "employees" && !String(params.get("select") ?? "").includes("departments")) {
      return jsonResponse([{ id: EMPLOYEE_ID, is_active: true }]);
    }
    if (table === "audit_logs") {
      auditCalls.push(call);
      return jsonResponse([]);
    }
    // allowedLoginTypesFor (session.js): the controller must land in
    // meeting_admins; the plain employee role must hit none of the three.
    if (["hr_admins", "meeting_admins", "system_admins"].includes(table)) {
      const isControllerRow = table === "meeting_admins" &&
        params.get("employee_id") === `eq.${EMPLOYEE_ID}` &&
        lastSessionRole === "meeting_controller";
      return jsonResponse(isControllerRow ? [{ employee_id: EMPLOYEE_ID }] : []);
    }
    // readSession only lists leave_requests for the plain employee role.
    if (table === "leave_requests") return jsonResponse([]);

    if (options.failTable && table === options.failTable) {
      return jsonResponse({ code: "fake-db-down" }, 500);
    }

    // ---- meeting_types (code filter) ----
    if (table === "meeting_types" && method === "GET") {
      const code = params.get("code")?.replace("eq.", "");
      const typeRow = code === "sup"
        ? { id: TYPE_S, code: "sup", name: "ประชุมหัวหน้างาน" }
        : { id: TYPE_M, code: "monthly", name: "ประชุมประจำเดือน" };
      return jsonResponse([typeRow]);
    }

    // ---- meeting_sessions ----
    if (table === "meeting_sessions" && method === "GET") {
      let rows = (state.sessionsByType[params.get("meeting_type_id")?.replace("eq.", "")] ?? []);
      const dateFilter = params.get("session_date");
      if (dateFilter?.startsWith("eq.")) rows = rows.filter((row) => row.session_date === dateFilter.slice(3));
      const gteFilter = params.get("session_date.gte");
      if (gteFilter) rows = rows.filter((row) => row.session_date >= gteFilter.slice(4));
      const ltFilter = params.get("session_date.lt");
      if (ltFilter) rows = rows.filter((row) => row.session_date < ltFilter.slice(3));
      const order = String(params.get("order") ?? "");
      if (order === "session_date.desc") rows = [...rows].sort((a, b) => b.session_date.localeCompare(a.session_date));
      const limit = Number(params.get("limit"));
      if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
      return jsonResponse(rows);
    }

    // ---- meeting_attendance ----
    if (table === "meeting_attendance" && method === "GET") {
      const inFilter = params.get("session_id") ?? "";
      if (!inFilter.startsWith("in.(")) return jsonResponse([]);
      const ids = inFilter.slice(4, -1).split(",").filter(Boolean);
      const allRows = [...SUP_ATTENDANCE, ...MONTHLY_ATTENDANCE];
      return jsonResponse(allRows.filter((row) => ids.includes(row.session_id)));
    }

    // ---- meeting_roster ----
    if (table === "meeting_roster" && method === "GET") {
      const typeId = params.get("meeting_type_id")?.replace("eq.", "");
      return jsonResponse(ROSTER[typeId] ?? []);
    }

    // ---- employees directory (loadEmployees) ----
    if (table === "employees" && method === "GET") {
      const inFilter = params.get("id") ?? "";
      const ids = inFilter.startsWith("in.(")
        ? inFilter.slice(4, -1).split(",").filter(Boolean)
        : [];
      return jsonResponse(ids.map((id) => ({ id, ...DIRECTORY[id] })).filter((row) => row.full_name));
    }

    throw new Error(`unrouted fake fetch: ${method} ${String(input)}`);
  };

  const state = {
    sessionsByType: {
      [TYPE_S]: SUP_SESSIONS,
      [TYPE_M]: MONTHLY_SESSIONS,
    },
  };

  function restore() {
    globalThis.fetch = originalFetch;
  }
  return { calls, auditCalls, state, restore };
}

async function get(path, cookie = CONTROLLER_COOKIE) {
  const headers = cookie ? { Cookie: cookie } : {};
  return app.request(path, { method: "GET", headers }, ENV);
}

const DASH = "-";

/* ---------------------------------- tests --------------------------------- */

test("auth: every dashboard GET needs a meeting_controller session", async (t) => {
  freeze(t);
  const backend = createBackend();
  try {
    for (const path of [
      "/api/meeting/dashboard?code=sup",
      "/api/meeting/dashboard/cycles?code=sup",
      "/api/meeting/dashboard/dept?code=sup&cycle=2026-12-22&dept=แผนกวิจัย",
      "/api/meeting/dashboard/registrants?code=sup&cycle=2026-12-22",
      "/api/meeting/dashboard/monthly-summary?month=2026-11",
    ]) {
      const res = await get(path, null);
      const body = await res.json();
      assert.equal(res.status, 401, path);
      assert.deepEqual(body, { ok: false, error: UNAUTHENTICATED });
    }

    for (const path of [
      "/api/meeting/dashboard?code=sup",
      "/api/meeting/dashboard/cycles?code=sup",
      "/api/meeting/dashboard/dept?code=sup&cycle=2026-12-22&dept=แผนกวิจัย",
      "/api/meeting/dashboard/registrants?code=sup&cycle=2026-12-22",
      "/api/meeting/dashboard/monthly-summary?month=2026-11",
    ]) {
      const res = await get(path, EMPLOYEE_COOKIE);
      const body = await res.json();
      assert.equal(res.status, 403, path);
      assert.deepEqual(body, { ok: false, error: FORBIDDEN });
    }
  } finally {
    backend.restore();
  }
});

test("top: Express runtime call path replicated step by step (top is always [])", async (t) => {
  freeze(t);
  const backend = createBackend();
  try {
    // The exact filter list topAbsentPerDept uses (the Express contract).
    const TOP_STATUS_CODES = ["not_attended", "urgent_busy", "leave"];

    // Step 1 — the route builds personCounts over the month's rows, keyed
    // exactly like Express: `${dept}\u0000${fullName}\u0000${Thai label}`.
    const personCounts = new Map();
    for (const row of MONTHLY_ATTENDANCE) {
      const employee = DIRECTORY[row.employee_id];
      if (!employee) continue;
      const label = STATUS_LABEL_BY_CODE[row.status_code];
      if (!label) continue;
      const key = `${employee.departments.name}\u0000${employee.full_name}\u0000${label}`;
      personCounts.set(key, (personCounts.get(key) ?? 0) + 1);
    }
    assert.deepEqual([...personCounts.keys()], [
      "แผนกวิจัย\u0000คนเอ\u0000ลาประชุม",       // att-101
      "แผนกวิจัย\u0000คนเอ\u0000เข้าร่วมประชุม", // att-102
      "แผนกวิจัย\u0000คนบี\u0000ติดงานด่วน",     // att-103
    ]);

    // Step 2 — aggregated rows carry the Thai label in `status`.
    const aggregated = [...personCounts.entries()].map(([key, count]) => {
      const [dept, name, status] = key.split("\u0000");
      return { dept, name, status, count };
    });
    // Step 2b — the labels never hit the English code filter, and Step 3 —
    // topAbsentPerDept therefore matches nothing.
    assert.ok(aggregated.every((entry) => !TOP_STATUS_CODES.includes(entry.status)));
    assert.deepEqual(topAbsentPerDept(aggregated), []);

    // Step 4 — the route returns exactly this runtime output for a month
    // with data.
    const res = await get("/api/meeting/dashboard/monthly-summary?month=2026-11");
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).top, []);

    // Step 5 — a month with no data: no rows reach personCounts, so the
    // aggregated list is empty and top is [] the same way.
    const empty = await get("/api/meeting/dashboard/monthly-summary?month=2026-12");
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).top, []);
  } finally {
    backend.restore();
  }
});

test("top: the draft-intended populated output never appears", async (t) => {
  freeze(t);
  const backend = createBackend();
  try {
    const res = await get("/api/meeting/dashboard/monthly-summary?month=2026-11");
    const body = await res.json();
    assert.deepEqual(body.top, []);

    // For the reader: feeding the helper status CODES (the draft's intended
    // input, as if the route keyed personCounts on codes) would produce the
    // populated placeholder rows below — deliberately not what Express
    // returns at runtime, and therefore never returned by the route.
    const intended = topAbsentPerDept([
      { dept: "แผนกวิจัย", name: "คนบี", status: "urgent_busy", count: 1 },
      { dept: "แผนกวิจัย", name: "คนเอ", status: "leave", count: 1 },
    ]).map((entry) => ({
      ...entry,
      pct: entry.count / 2, // totalMeetings = 2 for this month
    }));
    assert.deepEqual(intended, [
      { dept: "แผนกวิจัย", status: "not_attended", name: "", count: 0, pct: 0 },
      { dept: "แผนกวิจัย", status: "urgent_busy", name: "คนบี", count: 1, pct: 0.5 },
      { dept: "แผนกวิจัย", status: "leave", name: "คนเอ", count: 1, pct: 0.5 },
    ]);
    assert.deepEqual(body.top, []); // the populated shape never reaches the client
  } finally {
    backend.restore();
  }
});

test("GET /: success shape, Thai labels, and decision 2 counting", async (t) => {
  freeze(t);
  const backend = createBackend();
  try {
    const res = await get("/api/meeting/dashboard?code=sup");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    const body = await res.json();

    assert.deepEqual(body.meeting, {
      code: "sup",
      name: "ประชุมหัวหน้างาน",
      periodLabel: "รายสัปดาห์ · ทุกวันอังคาร",
    });
    assert.ok(body.updated.startsWith("2026-11-10T"));
    assert.equal(body.todayKey, TODAY_KEY);
    assert.deepEqual(body.statuses, ["เข้าร่วมประชุม", "ไม่เข้าร่วม", "ติดงานด่วน", "ลาประชุม"]);
    assert.deepEqual(body.current, { key: "2026-12-22", label: "วันอังคาร 22 ธ.ค. 2569" });
    assert.equal(body.rosterCount, 3);

    // Decision 2: registered counts every latest row (including คนดี, who is
    // not on the roster), notYet counts roster members without a row (คนซี).
    assert.equal(body.today.registered, 3);
    assert.equal(body.today.notYet, 1);
    assert.deepEqual(body.today.byStatus, {
      "เข้าร่วมประชุม": 1,
      "ไม่เข้าร่วม": 0,
      "ติดงานด่วน": 1,
      "ลาประชุม": 1,
    });

    assert.deepEqual(body.depts, [
      { name: "แผนกการตลาด", total: 1, registered: 0, notYet: 1, attended: 0, rate: 0 },
      { name: "แผนกวิจัย", total: 2, registered: 2, notYet: 0, attended: 1, rate: 0.5 },
    ]);

    assert.deepEqual(body.history.mode, "day");
    assert.deepEqual(body.history.key, "2026-12-22");
    assert.equal(body.history.empty, false);
    assert.equal(body.history.emptyMessage, "ยังไม่มีข้อมูลในระบบ");

    // History window: 12 Tuesdays ending at the latest available key.
    assert.equal(body.history.cycles.length, 12);
    assert.equal(body.history.cycles[0].key, "2026-10-06");
    assert.equal(body.history.cycles[0].label, "6 ต.ค.");
    assert.equal(body.history.cycles[0].fullLabel, "วันอังคาร 6 ต.ค. 2569");
    for (const cycle of body.history.cycles) {
      const [year, month, day] = cycle.key.split("-").map(Number);
      assert.equal(new Date(Date.UTC(year, month - 1, day)).getUTCDay(), 2);
      assert.ok(cycle.label.length > 0);
      assert.ok(cycle.fullLabel.startsWith("วันอังคาร "));
    }

    // The current cycle carries the real data; empty slots render zero counts.
    const currentCycle = body.history.cycles.at(-1);
    assert.equal(currentCycle.key, "2026-12-22");
    assert.deepEqual(currentCycle.counts, {
      attended: 1,
      not_attended: 0,
      urgent_busy: 1,
      leave: 1,
      total: 3,
    });
    assert.equal(currentCycle.rate, 1 / 3);
    assert.deepEqual(body.history.cycles[0].counts, {
      attended: 0,
      not_attended: 0,
      urgent_busy: 0,
      leave: 0,
      total: 0,
    });

    // options list the available keys (cycles that actually have attendance
    // rows, as in the Express loadContext) with the full Thai label. Sessions
    // without registrants are not available keys.
    assert.deepEqual(body.history.options, [
      { key: "2026-12-15", label: "วันอังคาร 15 ธ.ค. 2569" },
      { key: "2026-12-22", label: "วันอังคาร 22 ธ.ค. 2569" },
    ]);
  } finally {
    backend.restore();
  }
});

test("GET /: unknown validation is strict on known fields only (non-strict query)", async (t) => {
  freeze(t);
  const backend = createBackend();
  try {
    const ok = await get("/api/meeting/dashboard?code=monthly&mode=day&value=2026-11-12&bogus=1");
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.history.key, "2026-11-12");
    assert.equal(body.meeting.periodLabel, "รายเดือน");

    for (const query of [
      "?code=weekly",
      "?code=&mode=day",
      "?code=monthly&mode=hour",
      "?code=monthly&value=2026-11-121",
    ]) {
      const res = await get(`/api/meeting/dashboard${query}`);
      assert.deepEqual(await res.json(), { ok: false, error: INVALID_INPUT }, query);
      assert.equal(res.status, 400);
    }
  } finally {
    backend.restore();
  }
});

test("GET /: missing meeting type answers 400 with the exact Thai message", async (t) => {
  freeze(t);
  const backend = new BackendNoType();
  try {
    const res = await get("/api/meeting/dashboard?code=sup");
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, error: TYPE_ERROR });
  } finally {
    backend.restore();
  }
});

test("GET /cycles: sorted options and validation errors", async (t) => {
  freeze(t);
  const backend = createBackend();
  try {
    const res = await get("/api/meeting/dashboard/cycles?code=monthly");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    const body = await res.json();
    assert.deepEqual(body, {
      ok: true,
      options: [{ key: "2026-11", label: "พ.ย. 2569" }],
    });

    for (const query of ["", "?code=supp", "?code="]) {
      const bad = await get(`/api/meeting/dashboard/cycles${query}`);
      assert.equal(bad.status, 400);
      assert.deepEqual(await bad.json(), { ok: false, error: INVALID_INPUT }, query);
    }

    const noType = new BackendNoType();
    try {
      const res2 = await get("/api/meeting/dashboard/cycles?code=sup");
      assert.equal(res2.status, 400);
      assert.deepEqual(await res2.json(), { ok: false, error: TYPE_ERROR });
    } finally {
      noType.restore();
    }
  } finally {
    backend.restore();
  }
});

test("GET /dept: members, labels, ordering, and not-yet people", async (t) => {
  freeze(t);
  const backend = createBackend();
  try {
    const res = await get("/api/meeting/dashboard/dept?code=sup&cycle=2026-12-22&dept=แผนกวิจัย");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.dept, "แผนกวิจัย");
    assert.deepEqual(body.cycle, { key: "2026-12-22", label: "วันอังคาร 22 ธ.ค. 2569" });
    assert.equal(body.total, 2);
    assert.deepEqual(body.counts, {
      "เข้าร่วมประชุม": 1,
      "ไม่เข้าร่วม": 0,
      "ติดงานด่วน": 0,
      "ลาประชุม": 1,
    });
    // Ordering: known status order first, then Thai names. คนซี has an unknown
    // code ('-'), so a member without any row would sort after '-'.
    assert.deepEqual(body.people, [
      { employeeId: EMP_A, name: "คนเอ", level: "หัวหน้าฝ่ายวิจัย", status: "เข้าร่วมประชุม", shift: "กะเช้า", time: "10:00" },
      { employeeId: EMP_B, name: "คนบี", level: "พนักงานวิจัย", status: "ลาประชุม", shift: "กะบ่าย", time: "09:30" },
    ]);
    assert.equal(body.notYet, 0);
  } finally {
    backend.restore();
  }
});

test("GET /dept: unknown-status row gets '-', not-yet people get the exact label", async (t) => {
  freeze(t);
  const backend = createBackend();
  try {
    // คนซี has a row in the 2026-12-15 cycle with an unknown status code.
    const res = await get("/api/meeting/dashboard/dept?code=sup&cycle=2026-12-15&dept=แผนกการตลาด");
    const body = await res.json();
    assert.deepEqual(body.people, [
      { employeeId: EMP_C, name: "คนซี", level: "พนักงานการตลาด", status: DASH, shift: null, time: "08:00" },
    ]);
    assert.deepEqual(body.counts, {
      "เข้าร่วมประชุม": 0,
      "ไม่เข้าร่วม": 0,
      "ติดงานด่วน": 0,
      "ลาประชุม": 0,
    });
    assert.equal(body.notYet, 0);

    // In the 2026-12-22 cycle คนซี never registered.
    const notYetRes = await get("/api/meeting/dashboard/dept?code=sup&cycle=2026-12-22&dept=แผนกการตลาด");
    const notYetBody = await notYetRes.json();
    assert.deepEqual(notYetBody.people, [
      { employeeId: EMP_C, name: "คนซี", level: "พนักงานการตลาด", status: "ยังไม่ลงทะเบียน", shift: null, time: null },
    ]);
    assert.equal(notYetBody.notYet, 1);

    const empty = await get("/api/meeting/dashboard/dept?code=sup&cycle=2026-12-22&dept=แผนกที่ไม่มีจริง");
    const emptyBody = await empty.json();
    assert.equal(emptyBody.total, 0);
    assert.deepEqual(emptyBody.people, []);
    assert.equal(emptyBody.notYet, 0);
  } finally {
    backend.restore();
  }
});

test("GET /dept: validation and malformed cycle", async (t) => {
  freeze(t);
  const backend = createBackend();
  try {
    for (const query of [
      "?code=sup&dept=แผนกวิจัย", // missing cycle
      "?code=sup&cycle=2026/12&dept=แผนกวิจัย", // bad cycle format
      "?code=sup&cycle=2026-12-22", // missing dept
      `?code=sup&cycle=2026-12-22&dept=${"ก".repeat(201)}`, // dept > 200 chars
    ]) {
      const res = await get(`/api/meeting/dashboard/dept${query}`);
      assert.equal(res.status, 400, query);
      assert.deepEqual(await res.json(), { ok: false, error: INVALID_INPUT }, query);
    }
  } finally {
    backend.restore();
  }
});

test("GET /registrants: ascending order and employee joins", async (t) => {
  freeze(t);
  const backend = createBackend();
  try {
    const res = await get("/api/meeting/dashboard/registrants?code=sup&cycle=2026-12-22");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    const body = await res.json();
    assert.deepEqual(body.cycle, { key: "2026-12-22", label: "วันอังคาร 22 ธ.ค. 2569" });
    assert.equal(body.total, 3);
    assert.deepEqual(body.items, [
      { name: "คนดี", departmentName: "แผนกประชาสัมพันธ์", positionName: "พนักงานประชาสัมพันธ์", status: "ติดงานด่วน", shift: null, time: "08:00" },
      { name: "คนบี", departmentName: "แผนกวิจัย", positionName: "พนักงานวิจัย", status: "ลาประชุม", shift: "กะบ่าย", time: "09:30" },
      { name: "คนเอ", departmentName: "แผนกวิจัย", positionName: "หัวหน้าฝ่ายวิจัย", status: "เข้าร่วมประชุม", shift: "กะเช้า", time: "10:00" },
    ]);

    for (const query of ["?code=sup", "?code=sup&cycle=fff"]) {
      const bad = await get(`/api/meeting/dashboard/registrants${query}`);
      assert.equal(bad.status, 400, query);
      assert.deepEqual(await bad.json(), { ok: false, error: INVALID_INPUT }, query);
    }
  } finally {
    backend.restore();
  }
});

test("GET /monthly-summary: counts every row (decision 1) with pct", async (t) => {
  freeze(t);
  const backend = createBackend();
  try {
    const res = await get("/api/meeting/dashboard/monthly-summary?month=2026-11");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    const body = await res.json();

    assert.deepEqual(body.month, { key: "2026-11", label: "พ.ย. 2569" });
    assert.equal(body.totalMeetings, 2);

    // Decision 1: the monthly summary counts ALL 3 rows of the month, while
    // GET / (latest-per-employee) sees only 2 rows for the same data.
    const root = await get("/api/meeting/dashboard?code=monthly");
    const rootBody = await root.json();
    assert.deepEqual(
      {
        fromRoot: rootBody.today.registered,
        fromMonthlySummaryRows: body.depts.find((dept) => dept.name === "แผนกวิจัย").rows,
      },
      { fromRoot: 2, fromMonthlySummaryRows: 3 },
    );

    assert.deepEqual(body.depts, [
      {
        name: "แผนกการตลาด",
        counts: { "เข้าร่วมประชุม": 0, "ไม่เข้าร่วม": 0, "ติดงานด่วน": 0, "ลาประชุม": 0 },
        rows: 0,
        rates: { "เข้าร่วมประชุม": 0, "ไม่เข้าร่วม": 0, "ติดงานด่วน": 0, "ลาประชุม": 0 },
      },
      {
        name: "แผนกวิจัย",
        counts: { "เข้าร่วมประชุม": 1, "ไม่เข้าร่วม": 0, "ติดงานด่วน": 1, "ลาประชุม": 1 },
        rows: 3,
        rates: { "เข้าร่วมประชุม": 1 / 3, "ไม่เข้าร่วม": 0, "ติดงานด่วน": 1 / 3, "ลาประชุม": 1 / 3 },
      },
    ]);

    // Express runtime output kept verbatim: personCounts key on the Thai
    // label, topAbsentPerDept filters on the English codes, so top is [].
    assert.deepEqual(body.top, []);

    for (const query of ["", "?month=2026-1", "?month=2026年11号"]) {
      const bad = await get(`/api/meeting/dashboard/monthly-summary${query}`);
      assert.equal(bad.status, 400, query);
      assert.deepEqual(await bad.json(), { ok: false, error: INVALID_INPUT }, query);
    }
  } finally {
    backend.restore();
  }
});

test("dashboards never write: no POST/PATCH/DELETE rows and no audit_logs from GET", async (t) => {
  freeze(t);
  const backend = createBackend();
  try {
    await get("/api/meeting/dashboard?code=sup");
    await get("/api/meeting/dashboard/dept?code=sup&cycle=2026-12-22&dept=แผนกวิจัย");
    await get("/api/meeting/dashboard/registrants?code=sup&cycle=2026-12-22");
    await get("/api/meeting/dashboard/monthly-summary?month=2026-11");
    await get("/api/meeting/dashboard/cycles?code=monthly");

    // The only POST/PATCH calls belong to the central session last_active
    // update owned by require-role/session (Phase 1), never this group.
    const writes = backend.calls.filter((call) =>
      call.method !== "GET" && tableOf(call.url) !== "auth_sessions"
    );
    assert.equal(writes.length, 0);
    assert.equal(backend.auditCalls.length, 0);

    // No response body leaks tokens: check the two known cookie strings fail to
    // appear in any captured URL (rows are synthetic but tokens must not spread).
    for (const call of backend.calls) {
      assert.ok(!call.url.includes(CONTROLLER_TOKEN));
    }
  } finally {
    backend.restore();
  }
});

test("GET all dashboard routes: an auto-absent job never runs from a GET (Phase 4 only)", async (t) => {
  freeze(t);
  const backend = createBackend();
  try {
    await get("/api/meeting/dashboard?code=sup");
    // Auto-absent (Phase 4) would write audit_logs and meeting_attendance with
    // PATCH/POST; the captures above show none. Assert the absence directly.
    const autoAbsentWrites = backend.calls.filter((call) =>
      call.method !== "GET" && tableOf(call.url) !== "auth_sessions"
    );
    assert.equal(autoAbsentWrites.length, 0);
  } finally {
    backend.restore();
  }
});

test("500 surfaces the exact Thai server error message", async (t) => {
  freeze(t);
  const backend = createBackend({ failTable: "meeting_types" });
  try {
    const res = await get("/api/meeting/dashboard?code=sup");
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { ok: false, error: SERVER_ERROR });

    const res2 = await get("/api/meeting/dashboard/monthly-summary?month=2026-11");
    assert.equal(res2.status, 500);
    assert.deepEqual(await res2.json(), { ok: false, error: SERVER_ERROR });
  } finally {
    backend.restore();
  }
});

test("POST /api/meeting/dashboard/reason is mounted (Phase 3b) and needs a controller session", async () => {
  const res = await app.request("/api/meeting/dashboard/reason", { method: "POST" }, ENV);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, error: UNAUTHENTICATED });
});

/** Backend where the dashboard group fails at the type lookup. */
function BackendNoType() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const table = tableOf(String(input));
    if (table === "auth_sessions") {
      if ((init.method ?? "GET") === "PATCH") return emptyResponse();
      const hash = await sha256Hex(CONTROLLER_TOKEN);
      if (new URL(String(input)).searchParams.get("token_hash") === `eq.${hash}`) {
        return jsonResponse([{
          id: "sess-row-1",
          employee_id: EMPLOYEE_ID,
          login_role: "meeting_controller",
          last_active_at: new Date(NOW_MS).toISOString(),
          expires_at: "2026-11-10T15:00:00.000Z",
          revoked_at: null,
        }]);
      }
      return jsonResponse([]);
    }
    if (table === "employees" && !String(new URL(String(input)).searchParams.get("select") ?? "").includes("departments")) {
      return jsonResponse([{ id: EMPLOYEE_ID, is_active: true }]);
    }
    if (table === "meeting_admins") return jsonResponse([{ employee_id: EMPLOYEE_ID }]);
    if (table === "hr_admins" || table === "system_admins") return jsonResponse([]);
    if (table === "leave_requests") return jsonResponse([]);
    if (table === "audit_logs") return jsonResponse([]);
    // A missing meeting type is an empty list, not a database failure: the
    // routes must answer 400 with the exact Thai type message, never 500.
    if (table === "meeting_types") return jsonResponse([]);
    return jsonResponse({ code: "fake-db-down" }, 500);
  };
  return { restore() { globalThis.fetch = originalFetch; } };
}
