import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

import app from "../src/app.js";

// Fake project values. Not real credentials, PINs, IDs or codes.
const PIN_PEPPER = "test-pin-pepper";
const NATIONAL_ID_PEPPER = "test-national-pepper";
const PIN_RESET_SECRET = "test-reset-secret";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  NATIONAL_ID_PEPPER,
  PIN_PEPPER,
  PIN_RESET_SECRET,
};

const BASE = "https://fake-project.supabase.co/rest/v1";
const EMPLOYEE_ID = "emp-1";
const SESSION_ID = "session-1";

const FAKE_NATIONAL_ID = "1-2345-67890-12-3";
const NORMALIZED_NATIONAL_ID = "1234567890123";
const NATIONAL_HASH = createHmac("sha256", NATIONAL_ID_PEPPER)
  .update(NORMALIZED_NATIONAL_ID)
  .digest("hex");

const PIN = "246813";
const WRONG_PIN = "135790";
const NEW_PIN = "864209";
const RESET_CODE = "12345678";
const WRONG_RESET_CODE = "87654321";

const NOW_MS = Date.parse("2026-01-01T09:00:00.000Z");
const NOW_ISO = "2026-01-01T09:00:00.000Z";
const LOCKED_UNTIL = "2026-01-01T09:15:00.000Z";

const INVALID_MESSAGE = "ข้อมูลไม่ถูกต้อง";
const LOGIN_INVALID_MESSAGE = "เลขบัตรประชาชนหรือ PIN ไม่ถูกต้อง";
const LOCKED_MESSAGE = "บัญชีถูกล็อกชั่วคราว";
const CONNECTION_MESSAGE = "ไม่สามารถเชื่อมต่อได้ กรุณาลองใหม่";
const UNAUTHENTICATED_MESSAGE = "ไม่ได้เข้าสู่ระบบ";
const LOGOUT_FAILED_MESSAGE = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";
const SET_PIN_INVALID_MESSAGE = "เลขบัตรประชาชนหรือรหัสจาก HR ไม่ถูกต้อง";
const PIN_CONFIRM_MESSAGE = "PIN ทั้งสองช่องไม่ตรงกัน";
const SET_PIN_FAILED_MESSAGE = "ไม่สามารถตั้ง PIN ได้ กรุณาลองใหม่";

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
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function matchesEq(params, column, row) {
  if (!params.has(column)) return true;
  const raw = params.get(column);
  if (raw === "is.null") return row[column] === null || row[column] === undefined;
  if (raw.startsWith("eq.")) return String(row[column]) === raw.slice(3);
  return true;
}

function createFakeDb(overrides = {}) {
  const state = {
    credentials: overrides.credentials ?? [],
    employees: overrides.employees ?? [],
    admins: overrides.admins ?? {},
    leaveRequests: overrides.leaveRequests ?? [],
    resetCodes: overrides.resetCodes ?? [],
    sessions: overrides.sessions ?? [],
    auditThrows: overrides.auditThrows === true,
    patchStatus: overrides.patchStatus ?? {},
    insertStatus: overrides.insertStatus ?? {},
    failGet: overrides.failGet === true,
  };

  return installFetch(({ url, init }) => {
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop();
    const method = init.method ?? "GET";
    const params = parsed.searchParams;

    if (method === "GET") {
      if (state.failGet) throw new Error("database unavailable");

      if (table === "employee_credentials") {
        return jsonResponse(
          state.credentials.filter(
            (row) =>
              matchesEq(params, "id", row) &&
              matchesEq(params, "national_id_hash", row) &&
              matchesEq(params, "employee_id", row)
          )
        );
      }
      if (table === "employees") {
        return jsonResponse(state.employees.filter((row) => matchesEq(params, "id", row)));
      }
      if (table === "hr_admins" || table === "meeting_admins" || table === "system_admins") {
        return jsonResponse(state.admins[table] ?? []);
      }
      if (table === "leave_requests") return jsonResponse(state.leaveRequests);
      if (table === "auth_sessions") {
        return jsonResponse(
          state.sessions.filter(
            (row) =>
              matchesEq(params, "id", row) &&
              matchesEq(params, "token_hash", row) &&
              matchesEq(params, "revoked_at", row)
          )
        );
      }
      if (table === "pin_reset_codes") {
        return jsonResponse(
          state.resetCodes.filter((row) => matchesEq(params, "used_at", row))
        );
      }
      return jsonResponse([]);
    }

    if (method === "POST") {
      if (table === "audit_logs" && state.auditThrows) throw new Error("audit unavailable");
      const status = state.insertStatus[table];
      if (status) return jsonResponse({ code: "insert_failed" }, status);
      return jsonResponse([], 201);
    }

    if (method === "PATCH") {
      const status = state.patchStatus[table];
      if (status) return jsonResponse({ code: "patch_failed" }, status);
      return emptyResponse(204);
    }

    return emptyResponse(204);
  });
}

function credential(overrides = {}) {
  return {
    employee_id: EMPLOYEE_ID,
    national_id_hash: NATIONAL_HASH,
    pin_hash: createHmac("sha256", PIN_PEPPER)
      .update(`${EMPLOYEE_ID}:${PIN}`)
      .digest("hex"),
    failed_attempts: 0,
    locked_until: null,
    updated_at: NOW_ISO,
    ...overrides,
  };
}

function employee(overrides = {}) {
  return {
    id: EMPLOYEE_ID,
    full_name: "Test Employee",
    employee_code: "TEST-EMP-001",
    is_active: true,
    ...overrides,
  };
}

function resetCode(overrides = {}) {
  return {
    id: "reset-1",
    employee_id: EMPLOYEE_ID,
    code_hash: createHmac("sha256", PIN_RESET_SECRET)
      .update(`${EMPLOYEE_ID}:${RESET_CODE}`)
      .digest("hex"),
    attempts: 0,
    used_at: null,
    expires_at: "2026-01-01T10:00:00.000Z",
    created_at: NOW_ISO,
    ...overrides,
  };
}

function sessionFor(token, overrides = {}) {
  return {
    id: SESSION_ID,
    employee_id: EMPLOYEE_ID,
    login_role: "employee",
    token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
    last_active_at: NOW_ISO,
    expires_at: "2026-01-01T21:00:00.000Z",
    revoked_at: null,
    ...overrides,
  };
}

function callsTo(calls, table, method) {
  return calls.filter(
    (call) => tableOf(call.url) === table && (call.init.method ?? "GET") === method
  );
}

function login(body, env = ENV) {
  return app.request(
    "/api/auth/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env
  );
}

function setPin(body, env = ENV) {
  return app.request(
    "/api/auth/set-pin",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env
  );
}

function me(token) {
  const init = token ? { headers: { Cookie: `hr_session=${token}` } } : {};
  return app.request("/api/auth/me", init, ENV);
}

function logout(token) {
  return app.request(
    "/api/auth/logout",
    { method: "POST", headers: { Cookie: `hr_session=${token}` } },
    ENV
  );
}

// --- login -----------------------------------------------------------------

test("login: rejects a malformed national ID with 400", async (t) => {
  const fake = createFakeDb();
  t.after(() => fake.restore());

  const res = await login({ loginType: "employee", nationalId: "123", pin: PIN });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, message: INVALID_MESSAGE });
  assert.equal(fake.calls.length, 0);
});

test("login: rejects extra keys, wrong types and unknown login types", async (t) => {
  const fake = createFakeDb();
  t.after(() => fake.restore());

  const bodies = [
    { loginType: "employee", nationalId: FAKE_NATIONAL_ID, pin: PIN, extra: "x" },
    { loginType: "employee", nationalId: FAKE_NATIONAL_ID, pin: 246813 },
    { loginType: "admin", nationalId: FAKE_NATIONAL_ID, pin: PIN },
  ];

  for (const body of bodies) {
    const res = await login(body);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, message: INVALID_MESSAGE });
  }
  assert.equal(fake.calls.length, 0);
});

test("login: unknown national ID is 401 with no failure count", async (t) => {
  freeze(t);
  const fake = createFakeDb({ credentials: [], employees: [] });
  t.after(() => fake.restore());

  const res = await login({ loginType: "employee", nationalId: FAKE_NATIONAL_ID, pin: PIN });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, message: LOGIN_INVALID_MESSAGE });
  assert.equal(callsTo(fake.calls, "employee_credentials", "PATCH").length, 0);
});

test("login: inactive employee is 401 with no failure count", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    credentials: [credential()],
    employees: [employee({ is_active: false })],
  });
  t.after(() => fake.restore());

  const res = await login({ loginType: "employee", nationalId: FAKE_NATIONAL_ID, pin: PIN });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, message: LOGIN_INVALID_MESSAGE });
  assert.equal(callsTo(fake.calls, "employee_credentials", "PATCH").length, 0);
});

test("login: locked account is 423 with lockedUntil", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    credentials: [credential({ locked_until: "2026-01-01T09:10:00.000Z" })],
    employees: [employee()],
  });
  t.after(() => fake.restore());

  const res = await login({ loginType: "employee", nationalId: FAKE_NATIONAL_ID, pin: PIN });
  assert.equal(res.status, 423);
  assert.deepEqual(await res.json(), {
    ok: false,
    message: LOCKED_MESSAGE,
    lockedUntil: "2026-01-01T09:10:00.000Z",
  });
  assert.equal(callsTo(fake.calls, "employee_credentials", "PATCH").length, 0);
});

test("login: wrong PIN increments failed_attempts to 1", async (t) => {
  freeze(t);
  const fake = createFakeDb({ credentials: [credential()], employees: [employee()] });
  t.after(() => fake.restore());

  const res = await login({ loginType: "employee", nationalId: FAKE_NATIONAL_ID, pin: WRONG_PIN });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, message: LOGIN_INVALID_MESSAGE });

  const patches = callsTo(fake.calls, "employee_credentials", "PATCH");
  assert.equal(patches.length, 1);
  assert.match(patches[0].url, /employee_id=eq\.emp-1/);
  assert.deepEqual(JSON.parse(patches[0].init.body), {
    failed_attempts: 1,
    updated_at: NOW_ISO,
  });
  assert.equal(callsTo(fake.calls, "auth_sessions", "POST").length, 0);
});

test("login: the fifth wrong PIN locks for 15 minutes and resets the count", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    credentials: [credential({ failed_attempts: 4 })],
    employees: [employee()],
  });
  t.after(() => fake.restore());

  const res = await login({ loginType: "employee", nationalId: FAKE_NATIONAL_ID, pin: WRONG_PIN });
  assert.equal(res.status, 423);
  assert.deepEqual(await res.json(), {
    ok: false,
    message: LOCKED_MESSAGE,
    lockedUntil: LOCKED_UNTIL,
  });

  const patches = callsTo(fake.calls, "employee_credentials", "PATCH");
  assert.equal(patches.length, 1);
  assert.match(patches[0].url, /employee_id=eq\.emp-1/);
  assert.deepEqual(JSON.parse(patches[0].init.body), {
    failed_attempts: 0,
    locked_until: LOCKED_UNTIL,
    updated_at: NOW_ISO,
  });
});

test("login: correct PIN with the wrong role counts as a failed attempt", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    credentials: [credential()],
    employees: [employee()],
    admins: {},
  });
  t.after(() => fake.restore());

  const res = await login({ loginType: "hr", nationalId: FAKE_NATIONAL_ID, pin: PIN });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, message: LOGIN_INVALID_MESSAGE });

  const patches = callsTo(fake.calls, "employee_credentials", "PATCH");
  assert.equal(patches.length, 1);
  assert.deepEqual(JSON.parse(patches[0].init.body), {
    failed_attempts: 1,
    updated_at: NOW_ISO,
  });
});

test("login: a bcrypt-style stored hash never verifies", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    credentials: [credential({ pin_hash: "$2b$10$" + "x".repeat(53) })],
    employees: [employee()],
  });
  t.after(() => fake.restore());

  const res = await login({ loginType: "employee", nationalId: FAKE_NATIONAL_ID, pin: PIN });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, message: LOGIN_INVALID_MESSAGE });
  assert.equal(callsTo(fake.calls, "employee_credentials", "PATCH").length, 1);
});

test("login: correct PIN sets the session cookie and clears the counters", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    credentials: [credential({ failed_attempts: 3 })],
    employees: [employee()],
    admins: { hr_admins: [{ employee_id: EMPLOYEE_ID }] },
  });
  t.after(() => fake.restore());

  const res = await login({ loginType: "hr", nationalId: FAKE_NATIONAL_ID, pin: PIN });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, redirectTo: "/leave/hr" });

  const setCookie = res.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /Max-Age=43200/);
  assert.match(setCookie, /Secure/);

  const patches = callsTo(fake.calls, "employee_credentials", "PATCH");
  assert.equal(patches.length, 1);
  assert.deepEqual(JSON.parse(patches[0].init.body), {
    failed_attempts: 0,
    locked_until: null,
    updated_at: NOW_ISO,
  });

  const token = setCookie.match(/hr_session=([^;]+)/)[1];
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);

  const inserts = callsTo(fake.calls, "auth_sessions", "POST");
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].url, `${BASE}/auth_sessions`);
  const sessionBody = JSON.parse(inserts[0].init.body);
  assert.equal(sessionBody.token_hash, createHash("sha256").update(token).digest("hex"));
  assert.equal(sessionBody.employee_id, EMPLOYEE_ID);
  assert.equal(sessionBody.login_role, "hr");
  assert.equal(sessionBody.created_at, NOW_ISO);
  assert.equal(sessionBody.expires_at, "2026-01-01T21:00:00.000Z");
});

test("login: employee with a pending approval is redirected to approvals", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    credentials: [credential()],
    employees: [employee()],
    admins: {},
    leaveRequests: [{ id: "leave-1" }],
  });
  t.after(() => fake.restore());

  const res = await login({ loginType: "employee", nationalId: FAKE_NATIONAL_ID, pin: PIN });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    redirectTo: "/pending?to=%2Fleave%2Fapprovals",
  });
});

test("login: COOKIE_SECURE=false drops Secure only", async (t) => {
  freeze(t);
  const insecureEnv = { ...ENV, COOKIE_SECURE: "false" };
  const fake = createFakeDb({
    credentials: [credential()],
    employees: [employee()],
    admins: {},
  });
  t.after(() => fake.restore());

  const res = await login(
    { loginType: "employee", nationalId: FAKE_NATIONAL_ID, pin: PIN },
    insecureEnv
  );
  assert.equal(res.status, 200);

  const setCookie = res.headers.get("set-cookie");
  assert.equal(/;\s*Secure/.test(setCookie), false);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /Max-Age=43200/);

  // Only the exact string "false" disables Secure.
  const otherFake = createFakeDb({
    credentials: [credential()],
    employees: [employee()],
    admins: {},
  });
  t.after(() => otherFake.restore());
  const otherRes = await login(
    { loginType: "employee", nationalId: FAKE_NATIONAL_ID, pin: PIN },
    { ...ENV, COOKIE_SECURE: "FALSE" }
  );
  assert.match(otherRes.headers.get("set-cookie"), /;\s*Secure/);
});

test("login: thrown database errors become 500", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const fake = createFakeDb({ failGet: true });
  t.after(() => fake.restore());

  const res = await login({ loginType: "employee", nationalId: FAKE_NATIONAL_ID, pin: PIN });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: CONNECTION_MESSAGE });
});

// --- me --------------------------------------------------------------------

test("me: no cookie is 401", async (t) => {
  const fake = createFakeDb();
  t.after(() => fake.restore());

  const res = await me(null);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, message: UNAUTHENTICATED_MESSAGE });
  assert.equal(fake.calls.length, 0);
});

test("me: a valid session returns role and redirectTo without employeeId", async (t) => {
  freeze(t);
  const token = "me-test-token";
  const fake = createFakeDb({
    sessions: [sessionFor(token)],
    employees: [employee()],
    admins: {},
    leaveRequests: [],
  });
  t.after(() => fake.restore());

  const res = await me(token);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {
    ok: true,
    role: "employee",
    redirectTo: "/pending?to=%2Fleave",
  });
  assert.equal("employeeId" in body, false);
});

// --- logout ----------------------------------------------------------------

test("logout: clears the cookie, revokes the session and writes an audit row", async (t) => {
  freeze(t);
  const token = "logout-test-token";
  const fake = createFakeDb({ sessions: [sessionFor(token)] });
  t.after(() => fake.restore());

  const res = await logout(token);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get("cache-control"), "no-store");

  const setCookie = res.headers.get("set-cookie");
  assert.match(setCookie, /hr_session=;/);
  assert.match(setCookie, /Max-Age=0/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /;\s*Secure/);

  const patches = callsTo(fake.calls, "auth_sessions", "PATCH");
  assert.equal(patches.length, 1);
  assert.match(patches[0].url, /token_hash=eq\.[0-9a-f]{64}/);
  assert.match(patches[0].url, /revoked_at=is\.null/);
  assert.deepEqual(JSON.parse(patches[0].init.body), { revoked_at: NOW_ISO });

  const audits = callsTo(fake.calls, "audit_logs", "POST");
  assert.equal(audits.length, 1);
  assert.deepEqual(JSON.parse(audits[0].init.body), {
    actor_id: EMPLOYEE_ID,
    action: "logout",
    entity: "auth_session",
    entity_id: SESSION_ID,
    detail: null,
  });
});

test("logout: audit failure still answers 200", async (t) => {
  freeze(t);
  const token = "logout-audit-token";
  const fake = createFakeDb({ sessions: [sessionFor(token)], auditThrows: true });
  t.after(() => fake.restore());

  const res = await logout(token);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.match(res.headers.get("set-cookie"), /Max-Age=0/);
});

test("logout: revoke failure clears the cookie and answers 500", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const token = "logout-fail-token";
  const fake = createFakeDb({
    sessions: [sessionFor(token)],
    patchStatus: { auth_sessions: 500 },
  });
  t.after(() => fake.restore());

  const res = await logout(token);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: LOGOUT_FAILED_MESSAGE });
  assert.match(res.headers.get("set-cookie"), /Max-Age=0/);
});

// --- set-pin ---------------------------------------------------------------

test("set-pin: rejects a simple PIN with the validation message", async (t) => {
  const fake = createFakeDb();
  t.after(() => fake.restore());

  const res = await setPin({
    nationalId: FAKE_NATIONAL_ID,
    code: RESET_CODE,
    pin: "111111",
    pinConfirm: "111111",
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, message: "PIN ง่ายเกินไป กรุณาตั้งใหม่" });
  assert.equal(fake.calls.length, 0);
});

test("set-pin: rejects a mismatched confirmation", async (t) => {
  const fake = createFakeDb();
  t.after(() => fake.restore());

  const res = await setPin({
    nationalId: FAKE_NATIONAL_ID,
    code: RESET_CODE,
    pin: NEW_PIN,
    pinConfirm: "246814",
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, message: PIN_CONFIRM_MESSAGE });
  assert.equal(fake.calls.length, 0);
});

test("set-pin: rejects a body with the wrong shape", async (t) => {
  const fake = createFakeDb();
  t.after(() => fake.restore());

  const res = await setPin({ nationalId: FAKE_NATIONAL_ID, code: RESET_CODE, pin: NEW_PIN });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, message: INVALID_MESSAGE });
  assert.equal(fake.calls.length, 0);
});

test("set-pin: unknown or inactive employee is 401", async (t) => {
  freeze(t);
  const unknown = createFakeDb({ credentials: [] });
  t.after(() => unknown.restore());

  const unknownRes = await setPin({
    nationalId: FAKE_NATIONAL_ID,
    code: RESET_CODE,
    pin: NEW_PIN,
    pinConfirm: NEW_PIN,
  });
  assert.equal(unknownRes.status, 401);
  assert.deepEqual(await unknownRes.json(), { ok: false, message: SET_PIN_INVALID_MESSAGE });
  assert.equal(callsTo(unknown.calls, "pin_reset_codes", "GET").length, 0);

  unknown.restore();
  const inactive = createFakeDb({
    credentials: [credential()],
    employees: [employee({ is_active: false })],
    resetCodes: [resetCode()],
  });
  t.after(() => inactive.restore());

  const inactiveRes = await setPin({
    nationalId: FAKE_NATIONAL_ID,
    code: RESET_CODE,
    pin: NEW_PIN,
    pinConfirm: NEW_PIN,
  });
  assert.equal(inactiveRes.status, 401);
  assert.deepEqual(await inactiveRes.json(), { ok: false, message: SET_PIN_INVALID_MESSAGE });
});

test("set-pin: no usable reset code is 401", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    credentials: [credential()],
    employees: [employee()],
    resetCodes: [],
  });
  t.after(() => fake.restore());

  const res = await setPin({
    nationalId: FAKE_NATIONAL_ID,
    code: RESET_CODE,
    pin: NEW_PIN,
    pinConfirm: NEW_PIN,
  });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, message: SET_PIN_INVALID_MESSAGE });

  const codeCalls = callsTo(fake.calls, "pin_reset_codes", "GET");
  assert.equal(codeCalls.length, 1);
  assert.match(codeCalls[0].url, /used_at=is\.null/);
  assert.match(codeCalls[0].url, /attempts=lt\.5/);
  assert.match(codeCalls[0].url, /order=created_at\.desc/);
});

test("set-pin: a wrong code increments attempts", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    credentials: [credential()],
    employees: [employee()],
    resetCodes: [resetCode()],
  });
  t.after(() => fake.restore());

  const res = await setPin({
    nationalId: FAKE_NATIONAL_ID,
    code: WRONG_RESET_CODE,
    pin: NEW_PIN,
    pinConfirm: NEW_PIN,
  });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, message: SET_PIN_INVALID_MESSAGE });

  const patches = callsTo(fake.calls, "pin_reset_codes", "PATCH");
  assert.equal(patches.length, 1);
  assert.match(patches[0].url, /id=eq\.reset-1/);
  assert.match(patches[0].url, /used_at=is\.null/);
  assert.deepEqual(JSON.parse(patches[0].init.body), { attempts: 1 });
});

test("set-pin: a code that is already used is not incremented", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    credentials: [credential()],
    employees: [employee()],
    resetCodes: [resetCode({ used_at: NOW_ISO })],
  });
  t.after(() => fake.restore());

  const res = await setPin({
    nationalId: FAKE_NATIONAL_ID,
    code: WRONG_RESET_CODE,
    pin: NEW_PIN,
    pinConfirm: NEW_PIN,
  });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, message: SET_PIN_INVALID_MESSAGE });
  assert.equal(callsTo(fake.calls, "pin_reset_codes", "PATCH").length, 0);
});

test("set-pin: the fifth wrong code marks the code used", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    credentials: [credential()],
    employees: [employee()],
    resetCodes: [resetCode({ attempts: 4 })],
  });
  t.after(() => fake.restore());

  const res = await setPin({
    nationalId: FAKE_NATIONAL_ID,
    code: WRONG_RESET_CODE,
    pin: NEW_PIN,
    pinConfirm: NEW_PIN,
  });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, message: SET_PIN_INVALID_MESSAGE });

  const patches = callsTo(fake.calls, "pin_reset_codes", "PATCH");
  assert.equal(patches.length, 1);
  assert.deepEqual(JSON.parse(patches[0].init.body), {
    attempts: 5,
    used_at: NOW_ISO,
  });
});

test("set-pin: success stores the new hash, revokes sessions and writes audit", async (t) => {
  freeze(t);
  const fake = createFakeDb({
    credentials: [credential({ failed_attempts: 2, locked_until: "2026-01-01T08:30:00.000Z" })],
    employees: [employee()],
    resetCodes: [resetCode()],
    sessions: [sessionFor("old-session-token")],
  });
  t.after(() => fake.restore());

  const res = await setPin({
    nationalId: FAKE_NATIONAL_ID,
    code: RESET_CODE,
    pin: NEW_PIN,
    pinConfirm: NEW_PIN,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const credentialPatches = callsTo(fake.calls, "employee_credentials", "PATCH");
  assert.equal(credentialPatches.length, 1);
  assert.match(credentialPatches[0].url, /employee_id=eq\.emp-1/);
  assert.equal(/[?&]id=eq\./.test(credentialPatches[0].url), false);
  const credentialBody = JSON.parse(credentialPatches[0].init.body);
  assert.equal(
    credentialBody.pin_hash,
    createHmac("sha256", PIN_PEPPER).update(`${EMPLOYEE_ID}:${NEW_PIN}`).digest("hex")
  );
  assert.equal(credentialBody.pin_set_at, NOW_ISO);
  assert.equal(credentialBody.failed_attempts, 0);
  assert.equal(credentialBody.locked_until, null);
  assert.equal(credentialBody.updated_at, NOW_ISO);

  const codePatches = callsTo(fake.calls, "pin_reset_codes", "PATCH");
  assert.equal(codePatches.length, 1);
  assert.deepEqual(JSON.parse(codePatches[0].init.body), { used_at: NOW_ISO });

  const sessionPatches = callsTo(fake.calls, "auth_sessions", "PATCH");
  assert.equal(sessionPatches.length, 1);
  assert.match(sessionPatches[0].url, /employee_id=eq\.emp-1/);
  assert.match(sessionPatches[0].url, /revoked_at=is\.null/);
  assert.deepEqual(JSON.parse(sessionPatches[0].init.body), { revoked_at: NOW_ISO });

  const audits = callsTo(fake.calls, "audit_logs", "POST");
  assert.equal(audits.length, 1);
  assert.deepEqual(JSON.parse(audits[0].init.body), {
    actor_id: EMPLOYEE_ID,
    action: "pin_set",
    entity: "employee",
    entity_id: EMPLOYEE_ID,
    detail: null,
  });
});

test("set-pin: thrown write errors become 500", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const fake = createFakeDb({
    credentials: [credential()],
    employees: [employee()],
    resetCodes: [resetCode()],
    patchStatus: { employee_credentials: 500 },
  });
  t.after(() => fake.restore());

  const res = await setPin({
    nationalId: FAKE_NATIONAL_ID,
    code: RESET_CODE,
    pin: NEW_PIN,
    pinConfirm: NEW_PIN,
  });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: SET_PIN_FAILED_MESSAGE });
});

// --- no leakage ------------------------------------------------------------

test("responses and audit rows never contain the PIN, code or token", async (t) => {
  freeze(t);
  const logoutToken = "leak-test-session-token";
  const fake = createFakeDb({
    credentials: [credential()],
    employees: [employee()],
    admins: {},
    leaveRequests: [],
    resetCodes: [resetCode()],
    sessions: [sessionFor(logoutToken)],
  });

  try {
    const loginRes = await login({
      loginType: "employee",
      nationalId: FAKE_NATIONAL_ID,
      pin: PIN,
    });
    const loginText = await loginRes.text();
    const setCookie = loginRes.headers.get("set-cookie");
    const loginToken = setCookie.match(/hr_session=([^;]+)/)[1];

    const setPinRes = await setPin({
      nationalId: FAKE_NATIONAL_ID,
      code: RESET_CODE,
      pin: NEW_PIN,
      pinConfirm: NEW_PIN,
    });
    const setPinText = await setPinRes.text();

    const logoutRes = await logout(logoutToken);
    const logoutText = await logoutRes.text();

    const auditText = callsTo(fake.calls, "audit_logs", "POST")
      .map((call) => call.init.body)
      .join("\n");

    const exposed = [loginText, setPinText, logoutText, auditText].join("\n");
    for (const secret of [PIN, NEW_PIN, RESET_CODE, loginToken, logoutToken, NORMALIZED_NATIONAL_ID]) {
      assert.equal(exposed.includes(secret), false);
    }
  } finally {
    fake.restore();
  }
});
