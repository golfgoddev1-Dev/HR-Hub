import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

// Fake project values. Not real credentials, tokens or employee data.
const TOKEN = "a".repeat(64);
const OTHER_TOKEN = "b".repeat(64);
const EMPLOYEE_ID = "123e4567-e89b-42d3-a456-426614174000";
const EMPLOYEE_ID_2 = "223e4567-e89b-42d3-a456-426614174000";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const BASE = "https://fake-project.supabase.co/rest/v1";
const NOW_MS = Date.parse("2026-01-05T03:00:00.000Z"); // Monday 10:00 in Bangkok
const NOW_ISO = "2026-01-05T03:00:00.000Z";

const LINK_ERROR = "ลิงก์ไม่ถูกต้อง กรุณาสแกน QR ใหม่อีกครั้ง";
const SERVER_ERROR = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";
const ROSTER_ERROR = "ไม่พบรายชื่อนี้ในรายชื่อการประชุม";
const DUPLICATE_ERROR = "ท่านได้ลงทะเบียนสำหรับประชุมนี้แล้ว";
const INVALID_BODY = "ข้อมูลไม่ถูกต้อง";
const TURNSTILE_ERROR = "ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่";
const RATE_LIMIT_ERROR = "ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่";
const BEFORE_MESSAGE = "ยังไม่ถึงเวลาลงทะเบียนเข้าประชุม";
const AFTER_MESSAGE = "หมดเวลาการลงทะเบียนเข้าประชุมแล้ว";
const NO_SESSION_MESSAGE = "ยังไม่ได้กำหนดรอบประชุม กรุณาแจ้งผู้ดูแล";

const SUP_TYPE = {
  id: "type-sup",
  code: "sup",
  name: "ประชุมหัวหน้างาน",
  qr_token: TOKEN,
  weekday: 1,
  default_open_time: "09:00:00",
  default_cutoff_time: "12:00:00",
};

const MONTHLY_TYPE = {
  id: "type-monthly",
  code: "monthly",
  name: "ประชุมประจำเดือน",
  qr_token: TOKEN,
  weekday: null,
  default_open_time: null,
  default_cutoff_time: null,
};

const EMPLOYEE = {
  id: EMPLOYEE_ID,
  full_name: "สมชาย ใจดี",
  department_id: "dept-1",
  position_id: "pos-1",
  departments: { name: "ฝ่ายบุคคล" },
  positions: { name: "เจ้าหน้าที่" },
};

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

function installFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input), init };
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

function tableOf(url) {
  return new URL(url).pathname.split("/").pop();
}

function makeLimiter({ success = true, throws = false } = {}) {
  const calls = [];
  return {
    calls,
    idFromName(key) {
      calls.push(key);
      return `id:${key}`;
    },
    get() {
      return {
        async fetch() {
          if (throws) throw new Error("binding unavailable");
          return Response.json({ success });
        },
      };
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    ...ENV,
    RL_CONTEXT_IP: makeLimiter(),
    RL_SUBMIT_IP: makeLimiter(),
    RL_SUBMIT_TOKEN: makeLimiter(),
    ...overrides,
  };
}

function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (key === "select" || key === "order" || key === "limit") continue;
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

function createFakeDb(options = {}) {
  const state = {
    types: options.types ?? [SUP_TYPE],
    sessions: options.sessions ?? [],
    roster: options.roster ?? [],
    employees: options.employees ?? [EMPLOYEE],
    attendance: options.attendance ?? [],
    sessionInsertError: options.sessionInsertError ?? null,
    attendanceInsertError: options.attendanceInsertError ?? null,
    fail: options.fail === true,
    turnstile: options.turnstile ?? (() => jsonResponse({ success: true })),
    nextSessionId: options.nextSessionId ?? "session-new",
  };

  const fake = installFetch(({ url, init }) => {
    if (url.startsWith("https://challenges.cloudflare.com/")) {
      return state.turnstile(url, init);
    }
    if (state.fail) throw new Error("database unavailable");

    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop();
    const method = init.method ?? "GET";
    const params = parsed.searchParams;

    if (method === "GET") {
      if (table === "meeting_types") return jsonResponse(state.types.filter((r) => matches(params, r)));
      if (table === "meeting_sessions") {
        return jsonResponse(state.sessions.filter((r) => matches(params, r)));
      }
      if (table === "meeting_roster") return jsonResponse(state.roster.filter((r) => matches(params, r)));
      if (table === "employees") return jsonResponse(state.employees.filter((r) => matches(params, r)));
      if (table === "meeting_attendance") {
        return jsonResponse(state.attendance.filter((r) => matches(params, r)));
      }
      return jsonResponse([]);
    }

    if (method === "POST") {
      const body = init.body ? JSON.parse(init.body) : {};
      if (table === "meeting_sessions") {
        if (state.sessionInsertError) {
          return jsonResponse({ code: state.sessionInsertError.code }, state.sessionInsertError.status);
        }
        const row = { id: state.nextSessionId, ...body };
        state.sessions.push(row);
        return jsonResponse([row], 201);
      }
      if (table === "meeting_attendance") {
        if (state.attendanceInsertError) {
          return jsonResponse(
            { code: state.attendanceInsertError.code },
            state.attendanceInsertError.status
          );
        }
        state.attendance.push(body);
        return emptyResponse(201);
      }
      return emptyResponse(201);
    }

    return emptyResponse(204);
  });

  fake.state = state;
  return fake;
}

function dataCalls(fake) {
  return fake.calls.filter((call) => !call.url.startsWith("https://challenges.cloudflare.com/"));
}

function callsTo(fake, table, method = "GET") {
  return dataCalls(fake).filter(
    (call) => tableOf(call.url) === table && (call.init.method ?? "GET") === method
  );
}

function getContext(token, env) {
  const query = token === undefined ? "" : `?t=${encodeURIComponent(token)}`;
  return app.request(`/api/register/context${query}`, {}, env);
}

function submit(body, env, { contentType = "application/json", raw = false } = {}) {
  return app.request(
    "/api/register/submit",
    {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: raw ? body : JSON.stringify(body),
    },
    env
  );
}

function validBody(overrides = {}) {
  return {
    t: TOKEN,
    employeeId: EMPLOYEE_ID,
    statusCode: "เข้าร่วมประชุม",
    ...overrides,
  };
}

function rosterRow(overrides = {}) {
  return {
    meeting_type_id: "type-sup",
    employee_id: EMPLOYEE_ID,
    is_active: true,
    employees: {
      full_name: "สมชาย ใจดี",
      departments: { name: "ฝ่ายบุคคล" },
      positions: { name: "เจ้าหน้าที่" },
    },
    ...overrides,
  };
}

// --- context ---------------------------------------------------------------

test("context: invalid token shapes are 404 before any limiter or database call", async () => {
  for (const token of ["", "A".repeat(64), "a".repeat(63), "g".repeat(64)]) {
    const fake = createFakeDb();
    try {
      const env = makeEnv();
      const res = await getContext(token, env);
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { ok: false, message: LINK_ERROR });
      assert.equal(fake.calls.length, 0);
      assert.equal(env.RL_CONTEXT_IP.calls.length, 0);
    } finally {
      fake.restore();
    }
  }
});

test("context: unknown token is 404 after the lookup", async (t) => {
  freeze(t);
  const fake = createFakeDb({ types: [] });
  t.after(() => fake.restore());

  const res = await getContext(TOKEN, makeEnv());
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { ok: false, message: LINK_ERROR });
  assert.equal(callsTo(fake, "meeting_types").length, 1);
  assert.match(callsTo(fake, "meeting_types")[0].url, /qr_token=eq\.a{64}/);
});

test("context: before returns the times and no roster", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    types: [{ ...SUP_TYPE, default_open_time: "11:00:00" }],
  });
  t.after(() => fake.restore());

  const res = await getContext(TOKEN, makeEnv());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.state, "before");
  assert.equal(body.openTime, "11:00");
  assert.equal(body.cutoffTime, "12:00");
  assert.equal(body.message, BEFORE_MESSAGE);
  assert.equal("employees" in body, false);
  assert.equal(callsTo(fake, "meeting_roster").length, 0);
});

test("context: open returns the active roster sorted by Thai name", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    roster: [
      rosterRow({
        employee_id: EMPLOYEE_ID_2,
        employees: {
          full_name: "ข ก",
          departments: { name: "ฝ่ายขาย" },
          positions: { name: "ผู้จัดการ" },
        },
      }),
      rosterRow(),
    ],
  });
  t.after(() => fake.restore());

  const res = await getContext(TOKEN, makeEnv());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.state, "open");
  assert.equal(body.openTime, "09:00");
  assert.equal(body.cutoffTime, "12:00");
  assert.deepEqual(body.employees, [
    {
      employeeId: EMPLOYEE_ID_2,
      fullName: "ข ก",
      departmentName: "ฝ่ายขาย",
      positionName: "ผู้จัดการ",
    },
    {
      employeeId: EMPLOYEE_ID,
      fullName: "สมชาย ใจดี",
      departmentName: "ฝ่ายบุคคล",
      positionName: "เจ้าหน้าที่",
    },
  ]);

  const rosterCalls = callsTo(fake, "meeting_roster");
  assert.equal(rosterCalls.length, 1);
  assert.match(rosterCalls[0].url, /meeting_type_id=eq\.type-sup/);
  assert.match(rosterCalls[0].url, /is_active=eq\.true/);
  assert.match(rosterCalls[0].url, /employees!meeting_roster_employee_id_fkey!inner/);
  assert.match(res.headers.get("cache-control"), /no-store/);
});

test("context: after the cutoff has the after state", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    types: [{ ...SUP_TYPE, default_cutoff_time: "09:00:00" }],
  });
  t.after(() => fake.restore());

  const body = await (await getContext(TOKEN, makeEnv())).json();
  assert.deepEqual(body, {
    ok: true,
    meetingName: SUP_TYPE.name,
    state: "after",
    statuses: ["เข้าร่วมประชุม", "ไม่เข้าร่วม", "ติดงานด่วน", "ลาประชุม"],
    shifts: ["กะ A", "กะ B"],
    reasonStatuses: ["ติดงานด่วน", "ลาประชุม"],
    leaveStatus: "ลาประชุม",
    message: AFTER_MESSAGE,
  });
});

test("context: sup on the wrong weekday has no session", async (t) => {
  freeze(t);
  const fake = createFakeDb({ types: [{ ...SUP_TYPE, weekday: 2 }] });
  t.after(() => fake.restore());

  const body = await (await getContext(TOKEN, makeEnv())).json();
  assert.equal(body.state, "no_session");
  assert.equal(body.message, NO_SESSION_MESSAGE);
});

test("context: monthly reads only today's session", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    types: [MONTHLY_TYPE],
    sessions: [
      {
        id: "old",
        meeting_type_id: "type-monthly",
        session_date: "2026-01-04",
        open_time: "01:00:00",
        cutoff_time: "02:00:00",
      },
      {
        id: "today",
        meeting_type_id: "type-monthly",
        session_date: "2026-01-05",
        open_time: "09:00:00",
        cutoff_time: "12:00:00",
      },
    ],
  });
  t.after(() => fake.restore());

  const body = await (await getContext(TOKEN, makeEnv())).json();
  assert.equal(body.state, "open");
  assert.equal(body.openTime, "09:00");
  assert.equal(body.cutoffTime, "12:00");
  assert.equal(callsTo(fake, "meeting_roster").length, 1);
});

test("context: monthly without a session today has no session", async (t) => {
  freeze(t);
  const fake = createFakeDb({ types: [MONTHLY_TYPE], sessions: [] });
  t.after(() => fake.restore());

  const body = await (await getContext(TOKEN, makeEnv())).json();
  assert.equal(body.state, "no_session");
});

test("context: 429 when the context limiter denies", async (t) => {
  freeze(t);
  const fake = createFakeDb();
  t.after(() => fake.restore());
  const env = makeEnv({ RL_CONTEXT_IP: makeLimiter({ success: false }) });

  const res = await getContext(TOKEN, env);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { ok: false, message: RATE_LIMIT_ERROR });
  assert.deepEqual(env.RL_CONTEXT_IP.calls, ["context|unknown"]);
  assert.equal(dataCalls(fake).length, 0);
});

test("context: missing or throwing binding is 503 and fails closed", async (t) => {
  freeze(t);

  for (const env of [
    { ...ENV },
    makeEnv({ RL_CONTEXT_IP: makeLimiter({ throws: true }) }),
  ]) {
    const fake = createFakeDb();
    try {
      const res = await getContext(TOKEN, env);
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { ok: false, message: SERVER_ERROR });
      assert.equal(dataCalls(fake).length, 0);
    } finally {
      fake.restore();
    }
  }
});

test("context: sends the CF-Connecting-IP into the limiter key", async (t) => {
  freeze(t);
  const fake = createFakeDb();
  t.after(() => fake.restore());
  const env = makeEnv();

  await app.request(
    `/api/register/context?t=${TOKEN}`,
    { headers: { "CF-Connecting-IP": "203.0.113.9" } },
    env
  );
  assert.deepEqual(env.RL_CONTEXT_IP.calls, ["context|203.0.113.9"]);
});

test("context: database errors are 500", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const fake = createFakeDb({ fail: true });
  t.after(() => fake.restore());

  const res = await getContext(TOKEN, makeEnv());
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: SERVER_ERROR });
});

test("context: GET has no attendance or audit side effect", async (t) => {
  freeze(t);
  const fake = createFakeDb({ roster: [rosterRow()] });
  t.after(() => fake.restore());

  await getContext(TOKEN, makeEnv());
  assert.equal(callsTo(fake, "meeting_attendance", "POST").length, 0);
  assert.equal(callsTo(fake, "audit_logs", "POST").length, 0);
});

// --- submit validation -----------------------------------------------------

test("submit: invalid token is 404 before any limiter or database call", async () => {
  for (const token of ["", "A".repeat(64), "short"]) {
    const fake = createFakeDb();
    try {
      const env = makeEnv();
      const res = await submit(validBody({ t: token }), env);
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { ok: false, message: LINK_ERROR });
      assert.equal(fake.calls.length, 0);
      assert.equal(env.RL_SUBMIT_IP.calls.length, 0);
      assert.equal(env.RL_SUBMIT_TOKEN.calls.length, 0);
    } finally {
      fake.restore();
    }
  }
});

test("submit: a body over 4 KB is 400 before any limiter", async () => {
  const fake = createFakeDb();
  try {
    const env = makeEnv();
    const body = validBody({ statusCode: "ติดงานด่วน", reason: "x".repeat(5000) });
    const res = await submit(body, env);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, message: INVALID_BODY });
    assert.equal(fake.calls.length, 0);
    assert.equal(env.RL_SUBMIT_IP.calls.length, 0);
  } finally {
    fake.restore();
  }
});

test("submit: wrong or missing content type is 400", async () => {
  for (const contentType of ["text/plain", ""]) {
    const fake = createFakeDb();
    try {
      const env = makeEnv();
      const res = await submit(JSON.stringify(validBody()), env, {
        contentType,
        raw: true,
      });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { ok: false, message: INVALID_BODY });
      assert.equal(env.RL_SUBMIT_IP.calls.length, 0);
    } finally {
      fake.restore();
    }
  }
});

test("submit: malformed JSON and non-object JSON are 400", async () => {
  for (const raw of ["{not json", "[]", "null", '"text"']) {
    const fake = createFakeDb();
    try {
      const res = await submit(raw, makeEnv(), { raw: true });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { ok: false, message: INVALID_BODY });
    } finally {
      fake.restore();
    }
  }
});

test("submit: the body is strict about extra and missing keys", async () => {
  const cases = [
    { body: validBody({ extra: "x" }), status: 400, message: INVALID_BODY },
    {
      body: { employeeId: EMPLOYEE_ID, statusCode: "เข้าร่วมประชุม" },
      status: 404,
      message: LINK_ERROR,
    },
    { body: { t: TOKEN, statusCode: "เข้าร่วมประชุม" }, status: 400, message: INVALID_BODY },
    { body: { t: TOKEN, employeeId: EMPLOYEE_ID }, status: 400, message: INVALID_BODY },
    { body: validBody({ turnstileToken: "fake-turnstile-token" }), status: 400, message: INVALID_BODY },
  ];

  for (const item of cases) {
    const fake = createFakeDb();
    try {
      const res = await submit(item.body, makeEnv());
      assert.equal(res.status, item.status);
      assert.deepEqual(await res.json(), { ok: false, message: item.message });
    } finally {
      fake.restore();
    }
  }
});

test("submit: invalid UUID, status label and field types are 400", async () => {
  const bodies = [
    validBody({ employeeId: "not-a-uuid" }),
    validBody({ employeeId: "123e4567-e89b-02d3-a456-426614174000" }),
    validBody({ statusCode: "มาแล้ว" }),
    validBody({ statusCode: 1 }),
    validBody({ shift: 1 }),
    validBody({ reason: 1 }),
  ];

  for (const body of bodies) {
    const fake = createFakeDb();
    try {
      const res = await submit(body, makeEnv());
      assert.equal(res.status, 400);
    } finally {
      fake.restore();
    }
  }
});

test("submit: accepts the nil and max UUIDs like Express", async (t) => {
  freeze(t);
  const ids = [
    "00000000-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
  ];

  for (const employeeId of ids) {
    const fake = createFakeDb();
    try {
      const res = await submit(validBody({ employeeId }), makeEnv());
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { ok: false, message: ROSTER_ERROR });
    } finally {
      fake.restore();
    }
  }
});

test("submit: leave requires a known shift and other statuses reject a shift", async () => {
  const bodies = [
    validBody({ statusCode: "ลาประชุม", reason: "ลาป่วย" }),
    validBody({ statusCode: "ลาประชุม", shift: "กะ C", reason: "ลาป่วย" }),
    validBody({ statusCode: "เข้าร่วมประชุม", shift: "กะ A" }),
    validBody({ statusCode: "ลาประชุม", shift: null, reason: "ลาป่วย" }),
  ];

  for (const body of bodies) {
    const fake = createFakeDb();
    try {
      const res = await submit(body, makeEnv());
      assert.equal(res.status, 400);
    } finally {
      fake.restore();
    }
  }
});

test("submit: reason is required for urgent/leave and rejected otherwise", async () => {
  const bodies = [
    validBody({ statusCode: "ติดงานด่วน" }),
    validBody({ statusCode: "ติดงานด่วน", reason: "   " }),
    validBody({ statusCode: "ติดงานด่วน", reason: "x".repeat(201) }),
    validBody({ statusCode: "เข้าร่วมประชุม", reason: "มีเหตุ" }),
    validBody({ statusCode: "ไม่เข้าร่วม", reason: "มีเหตุ" }),
  ];

  for (const body of bodies) {
    const fake = createFakeDb();
    try {
      const res = await submit(body, makeEnv());
      assert.equal(res.status, 400);
    } finally {
      fake.restore();
    }
  }
});

test("submit: unknown token is 404 after the lookup", async (t) => {
  freeze(t);
  const fake = createFakeDb({ types: [] });
  t.after(() => fake.restore());

  const res = await submit(validBody(), makeEnv());
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { ok: false, message: LINK_ERROR });
});

test("submit: before, after and no_session are 403 with the state message", async (t) => {
  freeze(t);
  const cases = [
    {
      types: [{ ...SUP_TYPE, default_open_time: "11:00:00" }],
      message: BEFORE_MESSAGE,
    },
    {
      types: [{ ...SUP_TYPE, default_cutoff_time: "09:00:00" }],
      message: AFTER_MESSAGE,
    },
    {
      types: [{ ...SUP_TYPE, weekday: 2 }],
      message: NO_SESSION_MESSAGE,
    },
    {
      types: [MONTHLY_TYPE],
      sessions: [],
      message: NO_SESSION_MESSAGE,
    },
  ];

  for (const item of cases) {
    const fake = createFakeDb({ types: item.types, sessions: item.sessions ?? [] });
    try {
      const res = await submit(validBody(), makeEnv());
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { ok: false, message: item.message });
      assert.equal(callsTo(fake, "meeting_roster").length, 0);
    } finally {
      fake.restore();
    }
  }
});

test("submit: a missing roster row or employee is 400", async (t) => {
  freeze(t);

  const noRoster = createFakeDb({ roster: [] });
  try {
    const res = await submit(validBody(), makeEnv());
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, message: ROSTER_ERROR });
    assert.equal(callsTo(noRoster, "employees").length, 0);
  } finally {
    noRoster.restore();
  }

  const fake = createFakeDb({ roster: [rosterRow()], employees: [] });
  t.after(() => fake.restore());
  const res = await submit(validBody(), makeEnv());
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, message: ROSTER_ERROR });
});

test("submit: an existing attendance row is 409 without an insert", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    sessions: [
      {
        id: "session-1",
        meeting_type_id: "type-sup",
        session_date: "2026-01-05",
        open_time: "09:00",
        cutoff_time: "12:00",
      },
    ],
    roster: [rosterRow()],
    attendance: [{ id: "att-1", session_id: "session-1", employee_id: EMPLOYEE_ID }],
  });
  t.after(() => fake.restore());

  const res = await submit(validBody(), makeEnv());
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { ok: false, message: DUPLICATE_ERROR });
  assert.equal(callsTo(fake, "meeting_attendance", "POST").length, 0);
});

test("submit: a unique violation on insert is 409", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    sessions: [
      {
        id: "session-1",
        meeting_type_id: "type-sup",
        session_date: "2026-01-05",
        open_time: "09:00",
        cutoff_time: "12:00",
      },
    ],
    roster: [rosterRow()],
    attendanceInsertError: { code: "23505", status: 409 },
  });
  t.after(() => fake.restore());

  const res = await submit(validBody(), makeEnv());
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { ok: false, message: DUPLICATE_ERROR });
});

test("submit: sup creates the day's session and writes attendance", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    sessions: [],
    roster: [rosterRow()],
    nextSessionId: "session-new",
  });
  t.after(() => fake.restore());

  const res = await submit(
    validBody({
      statusCode: "ลาประชุม",
      shift: "กะ A",
      reason: "  ลาป่วย  ",
    }),
    makeEnv()
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.summary.name, EMPLOYEE.full_name);
  assert.equal(body.summary.dept, "ฝ่ายบุคคล");
  assert.equal(body.summary.level, "เจ้าหน้าที่");
  assert.equal(body.summary.status, "ลาประชุม");
  assert.equal(body.summary.shift, "กะ A");
  assert.equal(body.summary.meetingName, SUP_TYPE.name);
  assert.match(body.summary.savedAt, /10:00 น\.$/);

  const sessionInserts = callsTo(fake, "meeting_sessions", "POST");
  assert.equal(sessionInserts.length, 1);
  assert.deepEqual(JSON.parse(sessionInserts[0].init.body), {
    meeting_type_id: "type-sup",
    session_date: "2026-01-05",
    cycle_key: "sup-2026-01-05",
    open_time: "09:00",
    cutoff_time: "12:00",
  });

  const attendanceInserts = callsTo(fake, "meeting_attendance", "POST");
  assert.equal(attendanceInserts.length, 1);
  assert.deepEqual(JSON.parse(attendanceInserts[0].init.body), {
    session_id: "session-new",
    employee_id: EMPLOYEE_ID,
    status_code: "leave",
    reason: "ลาป่วย",
    shift: "กะ A",
    department_id: "dept-1",
    position_id: "pos-1",
    registered_at: NOW_ISO,
  });

  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("submit: monthly without today's session is 403", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    types: [MONTHLY_TYPE],
    sessions: [],
    roster: [rosterRow()],
  });
  t.after(() => fake.restore());

  const res = await submit(validBody(), makeEnv());
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, message: NO_SESSION_MESSAGE });
  assert.equal(callsTo(fake, "meeting_attendance", "POST").length, 0);
});

test("submit: database errors are 500", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const fake = createFakeDb({ fail: true });
  t.after(() => fake.restore());

  const res = await submit(validBody(), makeEnv());
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: SERVER_ERROR });
});

// --- submit rate limits and Turnstile --------------------------------------

test("submit: the IP limiter triggers 429 before the token limiter or database", async (t) => {
  freeze(t);
  const fake = createFakeDb();
  t.after(() => fake.restore());
  const env = makeEnv({ RL_SUBMIT_IP: makeLimiter({ success: false }) });

  const res = await submit(validBody(), env);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { ok: false, message: RATE_LIMIT_ERROR });
  assert.deepEqual(env.RL_SUBMIT_IP.calls, ["submit|unknown"]);
  assert.equal(env.RL_SUBMIT_TOKEN.calls.length, 0);
  assert.equal(dataCalls(fake).length, 0);
});

test("submit: the token limiter triggers 429 before the database", async (t) => {
  freeze(t);
  const fake = createFakeDb();
  t.after(() => fake.restore());
  const env = makeEnv({ RL_SUBMIT_TOKEN: makeLimiter({ success: false }) });

  const res = await submit(validBody(), env);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { ok: false, message: RATE_LIMIT_ERROR });
  assert.deepEqual(env.RL_SUBMIT_IP.calls, ["submit|unknown"]);
  assert.deepEqual(env.RL_SUBMIT_TOKEN.calls, [`submit|${await sha256Hex(TOKEN)}`]);
  assert.match(env.RL_SUBMIT_TOKEN.calls[0], /^submit\|[0-9a-f]{64}$/);
  assert.equal(env.RL_SUBMIT_TOKEN.calls[0].includes(TOKEN), false);
  assert.equal(dataCalls(fake).length, 0);
});

test("submit: the token limiter key is a SHA-256 hash, not the raw token", async (t) => {
  freeze(t);
  const fake = createFakeDb({ roster: [rosterRow()] });
  t.after(() => fake.restore());
  const env = makeEnv();

  const res = await submit(validBody(), env);
  assert.equal(res.status, 200);
  assert.equal(env.RL_SUBMIT_TOKEN.calls.length, 1);

  const key = env.RL_SUBMIT_TOKEN.calls[0];
  assert.equal(key, `submit|${await sha256Hex(TOKEN)}`);
  assert.match(key, /^submit\|[0-9a-f]{64}$/);
  assert.equal(key.includes(TOKEN), false);
});

test("submit: a throwing limiter is 503", async (t) => {
  freeze(t);
  const fake = createFakeDb();
  t.after(() => fake.restore());
  const env = makeEnv({ RL_SUBMIT_TOKEN: makeLimiter({ throws: true }) });

  const res = await submit(validBody(), env);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, message: SERVER_ERROR });
  assert.equal(dataCalls(fake).length, 0);
});

test("submit: Turnstile off skips Siteverify and keeps the old body shape", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    sessions: [
      {
        id: "session-1",
        meeting_type_id: "type-sup",
        session_date: "2026-01-05",
        open_time: "09:00",
        cutoff_time: "12:00",
      },
    ],
    roster: [rosterRow()],
  });
  t.after(() => fake.restore());

  const res = await submit(validBody(), makeEnv());
  assert.equal(res.status, 200);
  assert.equal(
    fake.calls.filter((call) => call.url.startsWith("https://challenges.cloudflare.com/")).length,
    0
  );
});

test("submit: Turnstile on requires a token before the limiter", async (t) => {
  freeze(t);
  const fake = createFakeDb();
  t.after(() => fake.restore());
  const env = makeEnv({
    TURNSTILE_ENABLED: "true",
    TURNSTILE_SECRET_KEY: "fake-turnstile-secret",
  });

  const res = await submit(validBody(), env);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, message: TURNSTILE_ERROR });
  assert.equal(env.RL_SUBMIT_IP.calls.length, 0);
  assert.equal(dataCalls(fake).length, 0);
});

test("submit: Turnstile on rejects a failed verification with 403", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    turnstile: () => jsonResponse({ success: false }),
  });
  t.after(() => fake.restore());
  const env = makeEnv({
    TURNSTILE_ENABLED: "true",
    TURNSTILE_SECRET_KEY: "fake-turnstile-secret",
  });

  const res = await submit(validBody({ turnstileToken: "fake-turnstile-token" }), env);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, message: TURNSTILE_ERROR });
  assert.equal(dataCalls(fake).length, 0);
});

test("submit: Turnstile transport failure is 503", async (t) => {
  freeze(t);
  const responders = [
    () => {
      throw new Error("network unavailable");
    },
    () => jsonResponse({ success: false }, 500),
    () => new Response("not json", { status: 200 }),
  ];

  for (const turnstile of responders) {
    const fake = createFakeDb({ turnstile });
    try {
      const env = makeEnv({
        TURNSTILE_ENABLED: "true",
        TURNSTILE_SECRET_KEY: "fake-turnstile-secret",
      });

      const res = await submit(validBody({ turnstileToken: "fake-turnstile-token" }), env);
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { ok: false, message: SERVER_ERROR });
      assert.equal(dataCalls(fake).length, 0);
    } finally {
      fake.restore();
    }
  }
});

test("submit: Turnstile success proceeds to the database", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    sessions: [
      {
        id: "session-1",
        meeting_type_id: "type-sup",
        session_date: "2026-01-05",
        open_time: "09:00",
        cutoff_time: "12:00",
      },
    ],
    roster: [rosterRow()],
    turnstile: () => jsonResponse({ success: true }),
  });
  t.after(() => fake.restore());
  const env = makeEnv({
    TURNSTILE_ENABLED: "true",
    TURNSTILE_SECRET_KEY: "fake-turnstile-secret",
  });

  const res = await submit(validBody({ turnstileToken: "fake-turnstile-token" }), env);
  assert.equal(res.status, 200);
  assert.equal(callsTo(fake, "meeting_attendance", "POST").length, 1);
});

// --- leakage ---------------------------------------------------------------

test("error logs and responses never contain the QR or Turnstile token", async (t) => {
  freeze(t);
  const logs = [];
  const original = console.error;
  console.error = (...args) => {
    logs.push(
      args
        .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
        .join(" ")
    );
  };
  t.after(() => {
    console.error = original;
  });

  const fake = createFakeDb({ fail: true });
  t.after(() => fake.restore());

  const res = await submit(validBody(), makeEnv());
  assert.equal(res.status, 500);

  const text = await res.text();
  const logged = logs.join("\n");
  assert.equal(text.includes(TOKEN), false);
  assert.equal(logged.includes(TOKEN), false);
  assert.equal(logged.includes("fake-service-role-key"), false);
});

test("no response or write contains the QR token or Turnstile token", async (t) => {
  freeze(t);
  const turnstileToken = "fake-turnstile-token-value";
  const fake = createFakeDb({
    sessions: [
      {
        id: "session-1",
        meeting_type_id: "type-sup",
        session_date: "2026-01-05",
        open_time: "09:00",
        cutoff_time: "12:00",
      },
    ],
    roster: [rosterRow()],
    turnstile: () => jsonResponse({ success: true }),
  });

  try {
    const env = makeEnv({
      TURNSTILE_ENABLED: "true",
      TURNSTILE_SECRET_KEY: "fake-turnstile-secret",
    });
    const res = await submit(validBody({ turnstileToken }), env);
    assert.equal(res.status, 200);
    const text = await res.text();

    assert.equal(text.includes(TOKEN), false);
    assert.equal(text.includes(turnstileToken), false);
    assert.equal(text.includes("fake-turnstile-secret"), false);
    assert.equal(text.includes("fake-service-role-key"), false);

    const writes = dataCalls(fake)
      .filter((call) => call.init.method === "POST")
      .map((call) => String(call.init.body ?? ""))
      .join("\n");
    assert.equal(writes.includes(TOKEN), false);
    assert.equal(writes.includes(turnstileToken), false);
  } finally {
    fake.restore();
  }
});
