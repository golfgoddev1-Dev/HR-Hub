import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

// Fake project values. Not real credentials or employee data.
const EMPLOYEE_ID = "123e4567-e89b-42d3-a456-426614174000";
const MONTHLY_TYPE_ID = "type-monthly";
const CONTROLLER_COOKIE_TOKEN = "controller-session-cookie-token";
const COOKIE = `hr_session=${CONTROLLER_COOKIE_TOKEN}`;

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const NOW_MS = Date.parse("2026-01-05T03:00:00.000Z"); // Monday 10:00 in Bangkok
const NOW_ISO = "2026-01-05T03:00:00.000Z";
const TODAY = "2026-01-05";

const SAVE_ERROR = "ไม่สามารถบันทึกได้ กรุณาลองใหม่";
const TYPE_ERROR = "ประเภทการประชุมไม่ถูกต้อง";
const INVALID_BODY = "ข้อมูลไม่ถูกต้อง";
const PAST_DATE_ERROR = "เลือกวันที่ตั้งแต่วันนี้เป็นต้นไป";
const TIME_FORMAT_ERROR = "รูปแบบเวลาไม่ถูกต้อง";
const TIME_ORDER_ERROR = "เวลาเปิดรับต้องก่อนเวลาปิดรับ";
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

/** eq / gte / is.null filter check against a fake row. */
function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (key === "select" || key === "order" || key === "limit" || key === "onConflict") {
      continue;
    }
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value.startsWith("gte.")) {
      if (String(row[key]) < value.slice(4)) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (String(row[key]) !== value.slice(3)) return false;
      continue;
    }
  }
  return true;
}

function applyOrder(rows, order) {
  if (typeof order !== "string" || order.length === 0) return rows;
  const [column, direction] = order.split(".");
  const sorted = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])));
  return direction === "desc" ? sorted.reverse() : sorted;
}

function sessionRow(login_role) {
  return {
    id: SESSION_ID,
    employee_id: EMPLOYEE_ID,
    login_role,
    last_active_at: NOW_ISO,
    expires_at: "2026-01-05T15:00:00.000Z",
    revoked_at: null,
  };
}

/** Fake backend covering the controller session flow and the monthly tables. */
function createBackend(options = {}) {
  const state = {
    types: options.types ?? [
      { id: MONTHLY_TYPE_ID, code: "monthly", name: "ประชุมประจำเดือน" },
    ],
    sessions: options.sessions ?? [],
    fail: options.fail ?? false,
    sessionRole: options.sessionRole ?? "meeting_controller",
    sessionUpserts: [],
    auditLogs: [],
    nextSessionId: options.nextSessionId ?? "saved-session-id",
  };

  const fake = installFetch(async ({ url, init }) => {
    const parsed = new URL(url);
    const table = tableOf(url);
    const method = init.method ?? "GET";
    const params = parsed.searchParams;

    // --- controller session flow ---
    if (table === "auth_sessions" && method === "GET") {
      const hash = await controllerHash();
      if (params.get("token_hash") === `eq.${hash}`) {
        return jsonResponse([sessionRow(state.sessionRole)]);
      }
      return jsonResponse([]);
    }
    if (table === "auth_sessions" && method === "PATCH") return emptyResponse();
    if (table === "employees") return jsonResponse([{ id: EMPLOYEE_ID, is_active: true }]);
    if (table === "hr_admins" || table === "meeting_admins" || table === "system_admins") {
      const isAdminTable =
        (state.sessionRole === "hr" && table === "hr_admins") ||
        (state.sessionRole === "meeting_controller" && table === "meeting_admins");
      return jsonResponse(isAdminTable ? [{ employee_id: EMPLOYEE_ID }] : []);
    }
    if (table === "leave_requests") return jsonResponse([]);

    // --- monthly tables ---
    if (state.fail) throw new Error("database unavailable");

    if (table === "meeting_types" && method === "GET") {
      const rows = applyOrder(state.types.filter((r) => matches(params, r)), params.get("order"));
      return jsonResponse(params.get("limit") ? rows.slice(0, Number(params.get("limit"))) : rows);
    }
    if (table === "meeting_sessions" && method === "GET") {
      const rows = applyOrder(state.sessions.filter((r) => matches(params, r)), params.get("order"));
      const limit = Number(params.get("limit"));
      return jsonResponse(Number.isFinite(limit) ? rows.slice(0, limit) : rows);
    }
    if (table === "meeting_sessions" && method === "POST") {
      state.sessionUpserts.push({ url, init, body: JSON.parse(init.body ?? "{}") });
      return jsonResponse([{ id: state.nextSessionId }], 200);
    }
    if (table === "audit_logs" && method === "POST") {
      state.auditLogs.push(JSON.parse(init.body ?? "{}"));
      return emptyResponse(201);
    }

    return jsonResponse([]);
  });

  fake.state = state;
  return fake;
}

function envFor(overrides = {}) {
  return { ...ENV, ...overrides };
}

function monthlySessionRow(overrides = {}) {
  return {
    id: "session-a",
    meeting_type_id: MONTHLY_TYPE_ID,
    session_date: "2026-01-06",
    cycle_key: "monthly-2026-01-06",
    open_time: "09:00:00",
    cutoff_time: "12:00:00",
    ...overrides,
  };
}

// --- GET /api/meeting/monthly-session ------------------------------------------

test("monthly GET: returns today-and-future sessions ascending, times as HH:mm", async (t) => {
  freeze(t);
  const fake = createBackend({
    sessions: [
      monthlySessionRow({ id: "session-c", session_date: "2026-02-01", open_time: "10:00:00" }),
      monthlySessionRow({ id: "session-b", session_date: "2026-01-20" }),
      monthlySessionRow({ id: "session-a", session_date: "2026-01-05" }),
      monthlySessionRow({ id: "session-old", session_date: "2026-01-04" }),
    ],
  });
  t.after(() => fake.restore());

  const res = await app.request("/api/meeting/monthly-session", { headers: { Cookie: COOKIE } }, envFor());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");

  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.sessions, [
    { id: "session-a", sessionDate: "2026-01-05", openTime: "09:00", cutoffTime: "12:00" },
    { id: "session-b", sessionDate: "2026-01-20", openTime: "09:00", cutoffTime: "12:00" },
    { id: "session-c", sessionDate: "2026-02-01", openTime: "10:00", cutoffTime: "12:00" },
  ]);

  const call = fake.calls.find((c) => tableOf(c.url) === "meeting_sessions" && (c.init.method ?? "GET") === "GET");
  const params = new URL(call.url).searchParams;
  assert.match(call.url, /meeting_type_id=eq\.type-monthly/);
  assert.equal(params.get("session_date"), `gte.${TODAY}`);
  assert.equal(params.get("order"), "session_date.asc");
  assert.equal(params.get("limit"), "12");
});

test("monthly GET: caps the list at 12 rows", async (t) => {
  freeze(t);
  const sessions = [];
  for (let i = 1; i <= 15; i += 1) {
    const sessionDate = `2026-03-${String(i).padStart(2, "0")}`;
    sessions.push(monthlySessionRow({ id: `session-${i}`, session_date: sessionDate }));
  }
  const fake = createBackend({ sessions });
  t.after(() => fake.restore());

  const body = await (await app.request("/api/meeting/monthly-session", { headers: { Cookie: COOKIE } }, envFor())).json();
  assert.equal(body.ok, true);
  assert.equal(body.sessions.length, 12);
  assert.deepEqual(
    body.sessions.map((row) => row.sessionDate),
    sessions.slice(0, 12).map((row) => row.session_date)
  );
});

test("monthly GET: a missing monthly type is 400", async (t) => {
  freeze(t);
  const fake = createBackend({ types: [] });
  t.after(() => fake.restore());

  const res = await app.request("/api/meeting/monthly-session", { headers: { Cookie: COOKIE } }, envFor());
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, message: TYPE_ERROR });
});

test("monthly GET: a database failure is 500", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const fake = createBackend({ fail: true });
  t.after(() => fake.restore());

  const res = await app.request("/api/meeting/monthly-session", { headers: { Cookie: COOKIE } }, envFor());
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: SAVE_ERROR });
});

// --- PUT /api/meeting/monthly-session ------------------------------------------

test("monthly PUT: the body is strict", async (t) => {
  freeze(t);
  const valid = { sessionDate: "2026-03-10", openTime: "09:00", cutoffTime: "12:00" };
  const cases = [
    {},
    { sessionDate: "2026-03-10", openTime: "09:00" },
    { openTime: "09:00", cutoffTime: "12:00" },
    { ...valid, extra: "x" },
    { sessionDate: 1, openTime: "09:00", cutoffTime: "12:00" },
  ];

  for (const body of cases) {
    const fake = createBackend();
    try {
      const res = await app.request(
        "/api/meeting/monthly-session",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: COOKIE },
          body: JSON.stringify(body),
        },
        envFor()
      );
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(await res.json(), { ok: false, message: INVALID_BODY });
      assert.equal(fake.state.sessionUpserts.length, 0);
    } finally {
      fake.restore();
    }
  }
});

test("monthly PUT: date strings that are not YYYY-MM-DD are 400", async (t) => {
  freeze(t);
  for (const sessionDate of ["20260310", "2026-3-10", "2026-03-1", "2026-03-10T00:00", ""]) {
    const fake = createBackend();
    try {
      const res = await app.request(
        "/api/meeting/monthly-session",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: COOKIE },
          body: JSON.stringify({ sessionDate, openTime: "09:00", cutoffTime: "12:00" }),
        },
        envFor()
      );
      assert.equal(res.status, 400, sessionDate);
      assert.deepEqual(await res.json(), { ok: false, message: INVALID_BODY });
    } finally {
      fake.restore();
    }
  }
});

test("monthly PUT: impossible calendar dates are 400", async (t) => {
  freeze(t);
  for (const sessionDate of ["2026-02-30", "2026-13-01", "2026-00-15", "2025-02-29", "2026-04-31"]) {
    const fake = createBackend();
    try {
      const res = await app.request(
        "/api/meeting/monthly-session",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: COOKIE },
          body: JSON.stringify({ sessionDate, openTime: "09:00", cutoffTime: "12:00" }),
        },
        envFor()
      );
      assert.equal(res.status, 400, sessionDate);
      assert.deepEqual(await res.json(), { ok: false, message: INVALID_BODY });
    } finally {
      fake.restore();
    }
  }
});

test("monthly PUT: the calendar check happens before the time check", async (t) => {
  freeze(t);
  const fake = createBackend();
  t.after(() => fake.restore());

  const res = await app.request(
    "/api/meeting/monthly-session",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ sessionDate: "2026-02-30", openTime: "25:00", cutoffTime: "12:00" }),
    },
    envFor()
  );
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, message: INVALID_BODY });
  assert.equal(fake.state.sessionUpserts.length, 0);
});

test("monthly PUT: invalid time formats and order are 400", async (t) => {
  freeze(t);
  const cases = [
    [{ sessionDate: "2026-03-10", openTime: "9:00", cutoffTime: "12:00" }, TIME_FORMAT_ERROR],
    [{ sessionDate: "2026-03-10", openTime: "08:60", cutoffTime: "12:00" }, TIME_FORMAT_ERROR],
    [{ sessionDate: "2026-03-10", openTime: "12:00", cutoffTime: "12:00" }, TIME_ORDER_ERROR],
    [{ sessionDate: "2026-03-10", openTime: "13:00", cutoffTime: "12:00" }, TIME_ORDER_ERROR],
  ];

  for (const [body, message] of cases) {
    const fake = createBackend();
    try {
      const res = await app.request(
        "/api/meeting/monthly-session",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: COOKIE },
          body: JSON.stringify(body),
        },
        envFor()
      );
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { ok: false, message });
      assert.equal(fake.state.sessionUpserts.length, 0);
    } finally {
      fake.restore();
    }
  }
});

test("monthly PUT: a past date is 400", async (t) => {
  freeze(t);
  for (const sessionDate of ["2026-01-04", "2025-12-31"]) {
    const fake = createBackend();
    try {
      const res = await app.request(
        "/api/meeting/monthly-session",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: COOKIE },
          body: JSON.stringify({ sessionDate, openTime: "09:00", cutoffTime: "12:00" }),
        },
        envFor()
      );
      assert.equal(res.status, 400, sessionDate);
      assert.deepEqual(await res.json(), { ok: false, message: PAST_DATE_ERROR });
      assert.equal(fake.state.sessionUpserts.length, 0);
    } finally {
      fake.restore();
    }
  }
});

test("monthly PUT: today is accepted ", async (t) => {
  freeze(t);
  const fake = createBackend({ sessions: [] });
  t.after(() => fake.restore());

  const res = await app.request(
    "/api/meeting/monthly-session",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ sessionDate: TODAY, openTime: "09:00", cutoffTime: "12:00" }),
    },
    envFor()
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("monthly PUT: a missing monthly type is 400", async (t) => {
  freeze(t);
  const fake = createBackend({ types: [] });
  t.after(() => fake.restore());

  const res = await app.request(
    "/api/meeting/monthly-session",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ sessionDate: "2026-03-10", openTime: "09:00", cutoffTime: "12:00" }),
    },
    envFor()
  );
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, message: TYPE_ERROR });
  assert.equal(fake.state.sessionUpserts.length, 0);
});

test("monthly PUT: upserts with the composite conflict target and audit row", async (t) => {
  freeze(t);
  const fake = createBackend({ sessions: [], nextSessionId: "session-saved" });
  t.after(() => fake.restore());

  const res = await app.request(
    "/api/meeting/monthly-session",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ sessionDate: "2026-03-10", openTime: "09:00", cutoffTime: "12:00" }),
    },
    envFor()
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get("cache-control"), "no-store");

  assert.equal(fake.state.sessionUpserts.length, 1);
  const upsert = fake.state.sessionUpserts[0];
  const params = new URL(upsert.url).searchParams;
  assert.equal(params.get("onConflict"), "meeting_type_id,session_date");
  assert.equal(params.get("select"), "id");
  assert.equal((upsert.init.headers.Prefer ?? "").includes("resolution=merge-duplicates"), true);
  assert.deepEqual(upsert.body, {
    meeting_type_id: MONTHLY_TYPE_ID,
    session_date: "2026-03-10",
    cycle_key: "monthly-2026-03-10",
    open_time: "09:00",
    cutoff_time: "12:00",
  });

  assert.equal(fake.state.auditLogs.length, 1);
  assert.deepEqual(fake.state.auditLogs[0], {
    actor_id: EMPLOYEE_ID,
    action: "meeting_monthly_session_set",
    entity: "meeting_session",
    entity_id: "session-saved",
    detail: JSON.stringify({
      sessionDate: "2026-03-10",
      openTime: "09:00",
      cutoffTime: "12:00",
    }),
  });
});

test("monthly PUT: a database failure is 500", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const fake = createBackend({ fail: true });
  t.after(() => fake.restore());

  const res = await app.request(
    "/api/meeting/monthly-session",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ sessionDate: "2026-03-10", openTime: "09:00", cutoffTime: "12:00" }),
    },
    envFor()
  );
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: SAVE_ERROR });
});

// --- auth -----------------------------------------------------------------------

test("both monthly routes answer 401 without a cookie and 401 with an unknown token", async (t) => {
  freeze(t);
  const fake = createBackend();
  t.after(() => fake.restore());

  const noCookie = [
    app.request("/api/meeting/monthly-session", {}, envFor()),
    app.request(
      "/api/meeting/monthly-session",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionDate: "2026-03-10", openTime: "09:00", cutoffTime: "12:00" }),
      },
      envFor()
    ),
  ];
  for (const res of await Promise.all(noCookie)) {
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { ok: false, message: UNAUTHENTICATED });
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  assert.equal(fake.calls.length, 0);

  const badCookie = "hr_session=wrong-token";
  const unknown = [
    app.request("/api/meeting/monthly-session", { headers: { Cookie: badCookie } }, envFor()),
    app.request(
      "/api/meeting/monthly-session",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: badCookie },
        body: JSON.stringify({ sessionDate: "2026-03-10", openTime: "09:00", cutoffTime: "12:00" }),
      },
      envFor()
    ),
  ];
  for (const res of await Promise.all(unknown)) {
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { ok: false, message: UNAUTHENTICATED });
  }
});

test("both monthly routes answer 403 for a non-controller session", async (t) => {
  freeze(t);
  const fake = createBackend({ sessionRole: "hr" });
  t.after(() => fake.restore());

  const requests = [
    app.request("/api/meeting/monthly-session", { headers: { Cookie: COOKIE } }, envFor()),
    app.request(
      "/api/meeting/monthly-session",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: COOKIE },
        body: JSON.stringify({ sessionDate: "2026-03-10", openTime: "09:00", cutoffTime: "12:00" }),
      },
      envFor()
    ),
  ];
  for (const res of await Promise.all(requests)) {
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { ok: false, message: FORBIDDEN });
  }
  assert.equal(fake.state.auditLogs.length, 0);
});

// --- leakage --------------------------------------------------------------------

test("responses and logs never contain the session cookie token", async (t) => {
  freeze(t);
  const logs = [];
  const original = console.error;
  console.error = (...args) => {
    logs.push(args.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" "));
  };
  t.after(() => {
    console.error = original;
  });

  const fake = createBackend({ fail: true });
  t.after(() => fake.restore());

  const res = await app.request(
    "/api/meeting/monthly-session",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ sessionDate: "2026-03-10", openTime: "09:00", cutoffTime: "12:00" }),
    },
    envFor()
  );
  assert.equal(res.status, 500);

  const text = await res.text();
  const logged = logs.join("\n");
  assert.equal(text.includes(CONTROLLER_COOKIE_TOKEN), false);
  assert.equal(logged.includes(CONTROLLER_COOKIE_TOKEN), false);
  assert.equal(logged.includes("fake-service-role-key"), false);
});
