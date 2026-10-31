import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

// Fake project values. Not real credentials, tokens or employee data.
const EMPLOYEE_ID = "123e4567-e89b-42d3-a456-426614174000";
const CONTROLLER_COOKIE_TOKEN = "controller-session-cookie-token";
const COOKIE = `hr_session=${CONTROLLER_COOKIE_TOKEN}`;
const SUP_TYPE_ID = "type-sup";
const MONTHLY_TYPE_ID = "type-monthly";

const NOW_MS = Date.parse("2026-01-05T03:00:00.000Z"); // Bangkok Monday 10:00
const TODAY = "2026-01-05";
const DATE_TEXT = "วันจันทร์ที่ 5 ม.ค. 2569";

const SERVER_ERROR = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";
const TYPE_ERROR = "ประเภทการประชุมไม่ถูกต้อง";
const UNAUTHENTICATED = "ไม่ได้เข้าสู่ระบบ";
const FORBIDDEN = "ไม่มีสิทธิ์เข้าถึงส่วนนี้";

const SESSION_ID = "session-1";
let controllerHashPromise = null;
function controllerHash() {
  if (controllerHashPromise === null) {
    controllerHashPromise = sha256Hex(CONTROLLER_COOKIE_TOKEN);
  }
  return controllerHashPromise;
}

function freeze(t, now = NOW_MS) {
  t.mock.timers.enable({ apis: ["Date"], now });
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

function installFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

/** eq / is.null filter check against a fake row. */
function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (key === "select" || key === "order" || key === "limit" || key === "on_conflict") {
      continue;
    }
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (String(row[key]) !== value.slice(3)) return false;
      continue;
    }
  }
  return true;
}

function sessionRow(login_role) {
  // last_active_at tracks the (frozen) clock so any frozen now is not idle.
  return {
    id: SESSION_ID,
    employee_id: EMPLOYEE_ID,
    login_role,
    last_active_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    revoked_at: null,
  };
}

const ZERO_COUNTS = { attended: 0, not_attended: 0, urgent_busy: 0, leave: 0, total: 0 };

/**
 * Fake backend over the session flow and the overview tables. `fail` makes
 * every non-auth call throw (database unavailable).
 */
function createBackend(options = {}) {
  const state = {
    types: options.types ?? [
      { id: SUP_TYPE_ID, code: "sup", name: "ประชุมหัวหน้างาน", weekday: 1, default_open_time: "09:00", default_cutoff_time: "12:00", qr_token: "sup-token-hex" },
      { id: MONTHLY_TYPE_ID, code: "monthly", name: "ประชุมประจำเดือน", weekday: null, default_open_time: null, default_cutoff_time: null, qr_token: "monthly-token-hex" },
    ],
    sessions: options.sessions ?? [],
    attendance: options.attendance ?? [],
    roster: options.roster ?? [],
    fail: options.fail ?? false,
    sessionRole: options.sessionRole ?? "meeting_controller",
    writes: [],
  };

  const fake = installFetch(async ({ url }) => {
    const parsed = new URL(url);
    const table = tableOf(url);
    const method = "GET"; // the overview routes only read
    const params = parsed.searchParams;

    // --- controller session flow ---
    if (table === "auth_sessions") {
      if (method === "GET") {
        const hash = await controllerHash();
        if (params.get("token_hash") === `eq.${hash}`) {
          return jsonResponse([sessionRow(state.sessionRole)]);
        }
        return jsonResponse([]);
      }
      state.writes.push({ table, method });
      return emptyResponse();
    }
    if (table === "employees") {
      const params = parsed.searchParams;
      if ((params.get("select") ?? "") === "*") {
        return jsonResponse([{ id: EMPLOYEE_ID, is_active: true }]);
      }
      return jsonResponse([]);
    }
    if (table === "hr_admins" || table === "meeting_admins" || table === "system_admins") {
      const isAdminTable =
        (state.sessionRole === "hr" && table === "hr_admins") ||
        (state.sessionRole === "meeting_controller" && table === "meeting_admins");
      return jsonResponse(isAdminTable ? [{ employee_id: EMPLOYEE_ID }] : []);
    }
    if (table === "leave_requests") return jsonResponse([]);

    if (state.fail) throw new Error("database unavailable");

    if (table === "meeting_types" && method === "GET") {
      return jsonResponse(state.types.filter((row) => matches(params, row)));
    }
    if (table === "meeting_sessions" && method === "GET") {
      return jsonResponse(state.sessions.filter((row) => matches(params, row)));
    }
    if (table === "meeting_attendance" && method === "GET") {
      return jsonResponse(state.attendance.filter((row) => matches(params, row)));
    }
    if (table === "meeting_roster" && method === "GET") {
      return jsonResponse(state.roster.filter((row) => matches(params, row)));
    }

    state.writes.push({ table, method });
    return jsonResponse([]);
  });

  fake.state = state;
  return fake;
}

function envFor() {
  return {
    SUPABASE_URL: "https://fake-project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  };
}

function get(url, cookie = COOKIE) {
  return app.request(url, cookie ? { headers: { Cookie: cookie } } : {}, envFor());
}

/** A roster row with the joined employee embed, like the PostgREST response. */
function rosterMember(employeeId, fullName) {
  return {
    meeting_type_id: SUP_TYPE_ID,
    employee_id: employeeId,
    is_active: true,
    employees: {
      full_name: fullName,
      departments: { name: "ฝ่ายบุคคล" },
      positions: { name: "เจ้าหน้าที่" },
    },
  };
}

function sessionRowOption(label, extra = {}) {
  return {
    id: label,
    meeting_type_id: extra.typeId ?? SUP_TYPE_ID,
    session_date: TODAY,
    cycle_key: "sup-2026-01-05",
    open_time: extra.open ?? "10:00",
    cutoff_time: extra.cutoff ?? "13:00",
  };
}

// --- GET /api/meeting/overview ------------------------------------------------

test("overview: sup day with defaults first, session counts and Thai date text", async (t) => {
  freeze(t);
  const fake = createBackend({
    sessions: [sessionRowOption("session-sup")],
    attendance: [
      { session_id: "session-sup", employee_id: "e1", status_code: "attended" },
      { session_id: "session-sup", employee_id: "e2", status_code: "attended" },
      { session_id: "session-sup", employee_id: "e3", status_code: "not_attended" },
    ],
    // Active sup roster rows; one inactive row must not be counted.
    roster: [
      { meeting_type_id: SUP_TYPE_ID, employee_id: "e1", is_active: true },
      { meeting_type_id: SUP_TYPE_ID, employee_id: "e2", is_active: true },
      { meeting_type_id: SUP_TYPE_ID, employee_id: "e3", is_active: true },
      { meeting_type_id: SUP_TYPE_ID, employee_id: "e4", is_active: true },
      { meeting_type_id: SUP_TYPE_ID, employee_id: "e5", is_active: false },
    ],
  });
  t.after(() => fake.restore());

  const res = await get("/api/meeting/overview");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");

  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.today.dateText, DATE_TEXT);

  // Defaults win over the session row's own times, like Express.
  assert.deepEqual(body.today.sup, {
    hasSession: true,
    openTime: "09:00",
    cutoffTime: "12:00",
    phase: "open",
    counts: { attended: 2, not_attended: 1, urgent_busy: 0, leave: 0, total: 3 },
    rosterCount: 4,
  });
  // No monthly session row today: hasSession false.
  assert.deepEqual(body.today.monthly, { hasSession: false, rosterCount: 0 });

  const call = fake.calls.find((call) => tableOf(call.url) === "meeting_attendance");
  assert.equal(new URL(call.url).searchParams.get("session_id"), "eq.session-sup");
});

test("overview: monthly hasSession only with a session row, using the row's times", async (t) => {
  freeze(t);
  const fake = createBackend({
    sessions: [
      sessionRowOption("session-monthly", { typeId: MONTHLY_TYPE_ID, open: "13:30", cutoff: "15:00" }),
    ],
    roster: [{ meeting_type_id: MONTHLY_TYPE_ID, employee_id: "e1", is_active: true }],
  });
  t.after(() => fake.restore());

  const res = await get("/api/meeting/overview");
  assert.equal(res.status, 200);
  const body = await res.json();

  // Bangkok 10:00 is before the 13:30 open time.
  assert.deepEqual(body.today.monthly, {
    hasSession: true,
    openTime: "13:30",
    cutoffTime: "15:00",
    phase: "not_open",
    counts: ZERO_COUNTS,
    rosterCount: 1,
  });
  // The sup weekday matches but no session row exists: hasSession still true.
  assert.deepEqual(body.today.sup, {
    hasSession: true,
    openTime: "09:00",
    cutoffTime: "12:00",
    phase: "open",
    counts: ZERO_COUNTS,
    rosterCount: 0,
  });
});

test("overview: a weekday mismatch marks sup as hasSession false", async (t) => {
  freeze(t, Date.parse("2026-01-03T03:00:00.000Z")); // Bangkok Saturday
  const fake = createBackend();
  t.after(() => fake.restore());

  const res = await get("/api/meeting/overview");
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.today.sup, { hasSession: false, rosterCount: 0 });
  assert.deepEqual(body.today.monthly, { hasSession: false, rosterCount: 0 });
  // No meeting_sessions read is wasted on the sup type on its off day.
  const sessionCalls = fake.calls.filter((call) => tableOf(call.url) === "meeting_sessions");
  assert.equal(sessionCalls.length, 1); // monthly lookup only
});

test("overview: at exactly the cutoff on the sup day the phase is closed", async (t) => {
  freeze(t, Date.parse("2026-01-05T05:00:00.000Z")); // Bangkok 12:00 cutoff
  const fake = createBackend();
  t.after(() => fake.restore());

  const res = await get("/api/meeting/overview");
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.today.sup.phase, "closed");
});

test("overview: matching weekday without defaults or a session row keeps hasSession true", async (t) => {
  freeze(t);
  const fake = createBackend({
    types: [
      { id: SUP_TYPE_ID, code: "sup", name: "ประชุมหัวหน้างาน", weekday: 1, default_open_time: null, default_cutoff_time: null },
      { id: MONTHLY_TYPE_ID, code: "monthly", name: "ประชุมประจำเดือน", weekday: null, default_open_time: null, default_cutoff_time: null },
    ],
  });
  t.after(() => fake.restore());

  const res = await get("/api/meeting/overview");
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.today.sup, {
    hasSession: true,
    openTime: null,
    cutoffTime: null,
    phase: "none",
    counts: ZERO_COUNTS,
    rosterCount: 0,
  });
});

test("overview: a read failure is 500 with the server error message", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const fake = createBackend({ fail: true });
  t.after(() => fake.restore());

  const res = await get("/api/meeting/overview");
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: SERVER_ERROR });
});

test("overview GET has no side effects: read-only calls and nothing written", async (t) => {
  freeze(t);
  const fake = createBackend({ sessions: [sessionRowOption("session-sup")] });
  t.after(() => fake.restore());

  const res = await get("/api/meeting/overview");
  assert.equal(res.status, 200);

  // Every table call is a GET; the only non-GET anywhere is the session layer's
  // auth_sessions last-active touch, which is not part of the overview.
  const writes = fake.state.writes.filter((row) => row.table !== "auth_sessions");
  assert.deepEqual(writes, []);
  for (const call of fake.calls) {
    const method = call.init.method ?? "GET";
    if (tableOf(call.url) !== "auth_sessions") {
      assert.equal(method, "GET", call.url);
    }
  }
});

// --- GET /api/meeting/overview/pending ----------------------------------------

test("pending: the code query is strict like the Express z.enum(...).strict()", async (t) => {
  freeze(t);
  for (const query of ["", "?code", "?code=admin", "?code=", "?code=supe", "?code=sup&extra=1", "?foo=bar&code=sup"]) {
    const fake = createBackend();
    t.after(() => fake.restore());
    const res = await get(`/api/meeting/overview/pending${query}`);
    assert.equal(res.status, 400, query);
    assert.deepEqual(await res.json(), { ok: false, message: TYPE_ERROR });
  }
});

test("pending: a missing session row answers sessionDate null and an empty list", async (t) => {
  freeze(t);
  const fake = createBackend();
  t.after(() => fake.restore());

  const res = await get("/api/meeting/overview/pending?code=sup");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { ok: true, code: "sup", sessionDate: null, pending: [] });

  const resMonthly = await get("/api/meeting/overview/pending?code=monthly");
  assert.deepEqual(await resMonthly.json(), { ok: true, code: "monthly", sessionDate: null, pending: [] });
});

test("pending: missing type row is 400", async (t) => {
  freeze(t);
  const fake = createBackend({ types: [{ id: MONTHLY_TYPE_ID, code: "monthly", weekday: null, default_open_time: null, default_cutoff_time: null }] });
  t.after(() => fake.restore());

  const res = await get("/api/meeting/overview/pending?code=sup");
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, message: TYPE_ERROR });
});

test("pending: excludes anyone with any attendance row, sorts Thai, and never returns ids", async (t) => {
  freeze(t);
  const fake = createBackend({
    sessions: [sessionRowOption("session-sup")],
    roster: [
      rosterMember("e-somchai", "สมชาย ใจดี"),
      rosterMember("e-apon", "ขจร เดือนดี"),
      rosterMember("e-kamon", "กมล วงขาว"),
      { ...rosterMember("e-inactive", "พนักงาน ยกเลิก"), is_active: false },
    ],
    attendance: [
      { session_id: "session-sup", employee_id: "e-somchai", status_code: "not_attended" },
    ],
  });
  t.after(() => fake.restore());

  const res = await get("/api/meeting/overview/pending?code=sup");
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.deepEqual(body, {
    ok: true,
    code: "sup",
    sessionDate: TODAY,
    pending: [
      { fullName: "กมล วงขาว", departmentName: "ฝ่ายบุคคล", positionName: "เจ้าหน้าที่" },
      { fullName: "ขจร เดือนดี", departmentName: "ฝ่ายบุคคล", positionName: "เจ้าหน้าที่" },
    ],
  });
  // Response shape check: no employeeId, employee code, national ID, token or hash fields.
  for (const item of body.pending) {
    assert.deepEqual(Object.keys(item).sort(), ["departmentName", "fullName", "positionName"]);
  }
  assert.equal(JSON.stringify(body).includes("employeeId"), false);
});

test("pending: a read failure is 500 with the server error message", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const fake = createBackend({ fail: true });
  t.after(() => fake.restore());

  const res = await get("/api/meeting/overview/pending?code=sup");
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: SERVER_ERROR });
});

// --- auth ----------------------------------------------------------------------

test("overview and pending answer 401 without a cookie", async (t) => {
  freeze(t);
  for (const path of ["/api/meeting/overview", "/api/meeting/overview/pending?code=sup"]) {
    const fake = createBackend();
    t.after(() => fake.restore());
    const res = await get(path, null);
    assert.equal(res.status, 401, path);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { ok: false, message: UNAUTHENTICATED });
  }
});

test("overview and pending answer 403 for a non-controller session", async (t) => {
  freeze(t);
  for (const path of ["/api/meeting/overview", "/api/meeting/overview/pending?code=sup"]) {
    const fake = createBackend({ sessionRole: "employee" });
    t.after(() => fake.restore());
    const res = await get(path);
    assert.equal(res.status, 403, path);
    assert.deepEqual(await res.json(), { ok: false, message: FORBIDDEN });
  }
});
