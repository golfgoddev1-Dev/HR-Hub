import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

// Fake project values. Not real credentials, tokens or employee data.
const CONTROLLER_COOKIE_TOKEN = "controller-session-cookie-token";
const EMPLOYEE_ID = "123e4567-e89b-42d3-a456-426614174000";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  APP_ORIGIN: "https://hr-hub.example.com",
};
// Blank APP_ORIGIN case (space) so getRequiredEnv rejects it like production.
const ENV_NO_ORIGIN = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  APP_ORIGIN: " ",
};

const NOW_MS = Date.parse("2026-01-05T03:00:00.000Z"); // Monday 10:00 in Bangkok
const NOW_ISO = "2026-01-05T03:00:00.000Z";

const SAVE_ERROR = "ไม่สามารถบันทึกได้ กรุณาลองใหม่";
const INVALID_BODY = "ข้อมูลไม่ถูกต้อง";
const SUP_ONLY_ERROR = "แก้ไขได้เฉพาะการประชุมหัวหน้างาน";
const NOT_FOUND_ERROR = "ไม่พบประเภทการประชุม";
const TIME_FORMAT_ERROR = "รูปแบบเวลาไม่ถูกต้อง";
const TIME_ORDER_ERROR = "เวลาเปิดรับต้องก่อนเวลาปิดรับ";
const UNAUTHENTICATED = "ไม่ได้เข้าสู่ระบบ";
const FORBIDDEN = "ไม่มีสิทธิ์เข้าถึงส่วนนี้";

const SESSION_ID = "session-1";

// Lazy memo: the hash of the fake session cookie, for the auth lookup.
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

/** PostgREST eq / is.null filter check against a fake row, like register tests. */
function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (key === "select" || key === "order" || key === "limit" || key === "onConflict") {
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

/** Applies a simple "column.asc" order string to fake rows. */
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

/**
 * Fake backend covering both the controller session flow and the meeting tables.
 * state.fail makes every non-auth call throw (database unavailable).
 */
function createBackend(options = {}) {
  const state = {
    types: options.types ?? [],
    sessions: options.sessions ?? [],
    fail: options.fail ?? false,
    sessionRole: options.sessionRole ?? "meeting_controller",
    typePatches: [],
    sessionUpserts: [],
    auditLogs: [],
    nextSessionId: options.nextSessionId ?? "saved-session-id",
  };

  const fake = installFetch(async ({ url, init }) => {
    const parsed = new URL(url);
    const table = tableOf(url);
    const method = init.method ?? "GET";
    const params = parsed.searchParams;

    // --- controller session flow (session.js) ---
    if (table === "auth_sessions" && method === "GET") {
      const hash = await controllerHash();
      if (params.get("token_hash") === `eq.${hash}`) {
        return jsonResponse([sessionRow(state.sessionRole)]);
      }
      return jsonResponse([]);
    }
    if (table === "auth_sessions" && method === "PATCH") return emptyResponse();
    if (table === "employees") return jsonResponse([{ id: EMPLOYEE_ID, is_active: true }]);
    if (
      table === "hr_admins" ||
      table === "meeting_admins" ||
      table === "system_admins"
    ) {
      const isAdminTable =
        (state.sessionRole === "hr" && table === "hr_admins") ||
        (state.sessionRole === "meeting_controller" && table === "meeting_admins");
      return jsonResponse(isAdminTable ? [{ employee_id: EMPLOYEE_ID }] : []);
    }
    if (table === "leave_requests") return jsonResponse([]);

    // --- meeting tables ---
    if (state.fail) throw new Error("database unavailable");

    if (table === "meeting_types") {
      if (method === "GET") {
        const rows = applyOrder(state.types.filter((r) => matches(params, r)), params.get("order"));
        return jsonResponse(rows);
      }
      if (method === "PATCH") {
        state.typePatches.push({ url, init, body: JSON.parse(init.body ?? "{}") });
        return emptyResponse();
      }
    }
    if (table === "meeting_sessions" && method === "GET") {
      const rows = applyOrder(state.sessions.filter((r) => matches(params, r)), params.get("order"));
      const limit = Number(params.get("limit"));
      return jsonResponse(
        Number.isFinite(limit) ? rows.slice(0, limit) : rows
      );
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

const COOKIE = `hr_session=${CONTROLLER_COOKIE_TOKEN}`;

function envFor(overrides = {}) {
  return { ...ENV, ...overrides };
}

// --- GET /api/meeting/types ---------------------------------------------------

test("types: returns both types ordered by code with the registerUrl", async (t) => {
  freeze(t);
  const fake = createBackend({
    types: [
      {
        id: "type-monthly",
        code: "monthly",
        name: "ประชุมประจำเดือน",
        qr_token: "b".repeat(64),
        weekday: null,
        default_open_time: null,
        default_cutoff_time: null,
      },
      {
        id: "type-sup",
        code: "sup",
        name: "ประชุมหัวหน้างาน",
        qr_token: "a".repeat(64),
        weekday: 1,
        default_open_time: "09:00:00",
        default_cutoff_time: "12:00:00",
      },
    ],
  });
  t.after(() => fake.restore());

  const res = await app.request("/api/meeting/types", { headers: { Cookie: COOKIE } }, envFor());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");

  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.types.length, 2);
  assert.deepEqual(
    body.types.map((type) => type.code),
    ["monthly", "sup"]
  );
  assert.deepEqual(body.types[0], {
    code: "monthly",
    name: "ประชุมประจำเดือน",
    registerUrl: `https://hr-hub.example.com/meeting/register?t=${"b".repeat(64)}`,
    weekday: null,
    openTime: null,
    cutoffTime: null,
  });
  assert.equal(body.types[1].weekday, 1);
  assert.equal(body.types[1].openTime, "09:00");
  assert.equal(body.types[1].cutoffTime, "12:00");
  assert.equal(body.types[1].registerUrl, `https://hr-hub.example.com/meeting/register?t=${"a".repeat(64)}`);

  // The database request orders by code ascending.
  const typesCall = fake.calls.find((call) => tableOf(call.url) === "meeting_types");
  assert.equal(new URL(typesCall.url).searchParams.get("order"), "code.asc");
});

test("types: APP_ORIGIN missing is 500 with the save message and no database call", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const fake = createBackend();
  t.after(() => fake.restore());

  const res = await app.request("/api/meeting/types", { headers: { Cookie: COOKIE } }, ENV_NO_ORIGIN);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: SAVE_ERROR });
  // Only the session flow happened before the failure.
  const meetingCalls = fake.calls.filter((call) => {
    const table = tableOf(call.url);
    return (table === "meeting_types" || table === "audit_logs");
  });
  assert.equal(meetingCalls.length, 0);
});

test("types: a database failure is 500", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const fake = createBackend({ fail: true });
  t.after(() => fake.restore());

  const res = await app.request("/api/meeting/types", { headers: { Cookie: COOKIE } }, envFor());
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: SAVE_ERROR });
});

// --- POST /api/meeting/qr/rotate ----------------------------------------------

test("rotate: the body is strict", async (t) => {
  freeze(t);
  const cases = [
    { body: null, raw: true },
    { body: {}, },
    { body: { code: "sup", extra: "x" } },
    { body: { code: 1 } },
  ];

  for (const item of cases) {
    const fake = createBackend();
    try {
      const res = await app.request(
        "/api/meeting/qr/rotate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: COOKIE },
          body: item.raw ? "null" : JSON.stringify(item.body),
        },
        envFor()
      );
      assert.equal(res.status, 400, JSON.stringify(item.body));
      assert.deepEqual(await res.json(), { ok: false, message: INVALID_BODY });
    } finally {
      fake.restore();
    }
  }
});

test("rotate: an unknown code value is 400 and writes nothing", async (t) => {
  freeze(t);
  const fake = createBackend({ types: [] });
  t.after(() => fake.restore());

  const res = await app.request(
    "/api/meeting/qr/rotate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ code: "weekly" }),
    },
    envFor()
  );
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, message: INVALID_BODY });
  assert.equal(fake.state.typePatches.length, 0);
  assert.equal(fake.state.auditLogs.length, 0);
});

test("rotate: a missing type row is 400 not found", async (t) => {
  freeze(t);
  const fake = createBackend({ types: [] });
  t.after(() => fake.restore());

  const res = await app.request(
    "/api/meeting/qr/rotate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ code: "sup" }),
    },
    envFor()
  );
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, message: NOT_FOUND_ERROR });
  assert.equal(fake.state.typePatches.length, 0);
  assert.equal(fake.state.auditLogs.length, 0);
});

test("rotate: writes a fresh 64-hex token and the audit row", async (t) => {
  freeze(t);
  const fake = createBackend({
    types: [{ id: "type-sup", code: "sup", name: "ประชุมหัวหน้างาน", qr_token: "a".repeat(64) }],
  });
  t.after(() => fake.restore());

  const res = await app.request(
    "/api/meeting/qr/rotate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ code: "sup" }),
    },
    envFor()
  );
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.ok, true);
  const registerUrl = body.registerUrl;
  assert.ok(registerUrl.startsWith("https://hr-hub.example.com/meeting/register?t="));
  const token = decodeURIComponent(registerUrl.split("?t=")[1]);
  assert.match(token, /^[0-9a-f]{64}$/);

  // The stored token is the response token.
  assert.equal(fake.state.typePatches.length, 1);
  const patch = fake.state.typePatches[0];
  assert.equal(new URL(patch.url).searchParams.get("code"), "eq.sup");
  assert.equal(patch.body.qr_token, token);

  assert.equal(fake.state.auditLogs.length, 1);
  assert.deepEqual(fake.state.auditLogs[0], {
    actor_id: EMPLOYEE_ID,
    action: "meeting_qr_rotated",
    entity: "meeting_type",
    entity_id: "type-sup",
    detail: null,
  });
});

test("rotate: APP_ORIGIN missing is 500 and writes nothing", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const fake = createBackend({
    types: [{ id: "type-sup", code: "sup", name: "ประชุมหัวหน้างาน", qr_token: "a".repeat(64) }],
  });
  t.after(() => fake.restore());

  const res = await app.request(
    "/api/meeting/qr/rotate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ code: "sup" }),
    },
    ENV_NO_ORIGIN
  );
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: SAVE_ERROR });
  assert.equal(fake.state.typePatches.length, 0);
  assert.equal(fake.state.auditLogs.length, 0);
});

test("rotate: a database failure after validation is 500", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const fake = createBackend({
    fail: true,
    types: [{ id: "type-sup", code: "sup", name: "ประชุมหัวหน้างาน", qr_token: "a".repeat(64) }],
  });
  t.after(() => fake.restore());

  const res = await app.request(
    "/api/meeting/qr/rotate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ code: "sup" }),
    },
    envFor()
  );
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: SAVE_ERROR });
});

// --- PUT /api/meeting/window --------------------------------------------------

test("window: the body is strict", async (t) => {
  freeze(t);
  for (const body of [
    {},
    { openTime: "09:00" },
    { cutoffTime: "12:00" },
    { openTime: "09:00", cutoffTime: "12:00", extra: "x" },
  ]) {
    const fake = createBackend();
    try {
      const res = await app.request(
        "/api/meeting/window",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: COOKIE },
          body: JSON.stringify(body),
        },
        envFor()
      );
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(await res.json(), { ok: false, message: INVALID_BODY });
    } finally {
      fake.restore();
    }
  }
});

test("window: a code other than sup is 400", async (t) => {
  freeze(t);
  const fake = createBackend();
  t.after(() => fake.restore());

  const res = await app.request(
    "/api/meeting/window",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ openTime: "09:00", cutoffTime: "12:00", code: "monthly" }),
    },
    envFor()
  );
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, message: SUP_ONLY_ERROR });
  assert.equal(fake.state.typePatches.length, 0);
});

test("window: invalid time formats are 400", async (t) => {
  freeze(t);
  for (const [openTime, cutoffTime] of [
    ["9:00", "12:00"],
    ["08:60", "12:00"],
    ["24:00", "12:00"],
  ]) {
    const fake = createBackend();
    try {
      const res = await app.request(
        "/api/meeting/window",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: COOKIE },
          body: JSON.stringify({ openTime, cutoffTime }),
        },
        envFor()
      );
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { ok: false, message: TIME_FORMAT_ERROR });
    } finally {
      fake.restore();
    }
  }
});

test("window: open at or after cutoff is 400", async (t) => {
  freeze(t);
  for (const [openTime, cutoffTime] of [
    ["12:00", "12:00"],
    ["13:00", "12:00"],
  ]) {
    const fake = createBackend();
    try {
      const res = await app.request(
        "/api/meeting/window",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: COOKIE },
          body: JSON.stringify({ openTime, cutoffTime }),
        },
        envFor()
      );
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { ok: false, message: TIME_ORDER_ERROR });
    } finally {
      fake.restore();
    }
  }
});

test("window: a missing sup type row is 400 not found", async (t) => {
  freeze(t);
  const fake = createBackend({ types: [] });
  t.after(() => fake.restore());

  const res = await app.request(
    "/api/meeting/window",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ openTime: "09:00", cutoffTime: "12:00" }),
    },
    envFor()
  );
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, message: NOT_FOUND_ERROR });
  assert.equal(fake.state.typePatches.length, 0);
});

test("window: updates both fields and audits old and new values", async (t) => {
  freeze(t);
  const fake = createBackend({
    types: [
      {
        id: "type-sup",
        code: "sup",
        name: "ประชุมหัวหน้างาน",
        qr_token: "a".repeat(64),
        default_open_time: "08:00:00",
        default_cutoff_time: "11:30:00",
      },
    ],
  });
  t.after(() => fake.restore());

  const res = await app.request(
    "/api/meeting/window",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ openTime: "09:00", cutoffTime: "12:00" }),
    },
    envFor()
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get("cache-control"), "no-store");

  assert.equal(fake.state.typePatches.length, 1);
  const patch = fake.state.typePatches[0];
  assert.match(patch.url, /id=eq\.type-sup/);
  assert.deepEqual(patch.body, {
    default_open_time: "09:00",
    default_cutoff_time: "12:00",
  });

  assert.equal(fake.state.auditLogs.length, 1);
  const audit = fake.state.auditLogs[0];
  assert.equal(audit.actor_id, EMPLOYEE_ID);
  assert.equal(audit.action, "meeting_window_updated");
  assert.equal(audit.entity, "meeting_type");
  assert.equal(audit.entity_id, "type-sup");
  assert.deepEqual(JSON.parse(audit.detail), {
    old: { openTime: "08:00", cutoffTime: "11:30" },
    new: { openTime: "09:00", cutoffTime: "12:00" },
  });
});

test("window: a database failure is 500", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const fake = createBackend({ fail: true });
  t.after(() => fake.restore());

  const res = await app.request(
    "/api/meeting/window",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ openTime: "09:00", cutoffTime: "12:00" }),
    },
    envFor()
  );
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: SAVE_ERROR });
});

// --- auth on every route -------------------------------------------------------

test("every route answers 401 without a cookie", async (t) => {
  freeze(t);
  const fake = createBackend();
  t.after(() => fake.restore());

  const requests = [
    app.request("/api/meeting/types", {}, envFor()),
    app.request(
      "/api/meeting/qr/rotate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "sup" }),
      },
      envFor()
    ),
    app.request(
      "/api/meeting/window",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openTime: "09:00", cutoffTime: "12:00" }),
      },
      envFor()
    ),
  ];

  for (const res of await Promise.all(requests)) {
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { ok: false, message: UNAUTHENTICATED });
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  // No session lookup without a cookie, and no data access.
  assert.equal(fake.calls.length, 0);
});

test("every route answers 401 with an unknown cookie token", async (t) => {
  freeze(t);
  const fake = createBackend();
  t.after(() => fake.restore());
  const badCookie = `hr_session=not-the-controller-token`;

  const requests = [
    app.request("/api/meeting/types", { headers: { Cookie: badCookie } }, envFor()),
    app.request(
      "/api/meeting/qr/rotate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: badCookie },
        body: JSON.stringify({ code: "sup" }),
      },
      envFor()
    ),
    app.request(
      "/api/meeting/window",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: badCookie },
        body: JSON.stringify({ openTime: "09:00", cutoffTime: "12:00" }),
      },
      envFor()
    ),
  ];

  for (const res of await Promise.all(requests)) {
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { ok: false, message: UNAUTHENTICATED });
  }
});

test("every route answers 403 for a non-controller session", async (t) => {
  freeze(t);
  const fake = createBackend({ sessionRole: "hr" });
  t.after(() => fake.restore());

  const requests = [
    app.request("/api/meeting/types", { headers: { Cookie: COOKIE } }, envFor()),
    app.request(
      "/api/meeting/qr/rotate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: COOKIE },
        body: JSON.stringify({ code: "sup" }),
      },
      envFor()
    ),
    app.request(
      "/api/meeting/window",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: COOKIE },
        body: JSON.stringify({ openTime: "09:00", cutoffTime: "12:00" }),
      },
      envFor()
    ),
  ];

  for (const res of await Promise.all(requests)) {
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { ok: false, message: FORBIDDEN });
    assert.equal(fake.state.auditLogs.length, 0);
  }
});

// --- leakage ------------------------------------------------------------------

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
    "/api/meeting/window",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({ openTime: "09:00", cutoffTime: "12:00" }),
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
