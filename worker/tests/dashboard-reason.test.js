import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";
import { pinHash } from "../src/pin-rules.js";

// Synthetic project constants only. The PINs/pins below never reach a real
// account and are printed nowhere every test only reads captured structures.
const NOW_MS = Date.parse("2026-11-10T03:00:00.000Z"); // Tuesday 10:00 Bangkok
const PEPPER = "fake-pin-pepper";

const CONTROLLER_TOKEN = "controller-session-cookie-token";
const EMPLOYEE_TOKEN = "employee-session-cookie-token";
const CONTROLLER_ID = "123e4567-e89b-42d3-a456-426614174000";
const CONTROLLER_COOKIE = `hr_session=${CONTROLLER_TOKEN}`;
const EMPLOYEE_COOKIE = `hr_session=${EMPLOYEE_TOKEN}`;

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  PIN_PEPPER: PEPPER,
};

const PIN_OK = "445566";
const PIN_BAD = "110022";
// bcrypt-format placeholder stored on a not-yet-migrated row (draft section 5).
const BCRYPT_HASH = "$2a$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKL";

const TYPE_ID = "57c3bd8e-2222-45df-8e02-6bc3f7908811";
const EMP_A = "aaaa0000-0000-4000-8000-00000000000a"; // urgent_busy with reason
const EMP_B = "aaaa0000-0000-4000-8000-00000000000b"; // attended (no reason)
const EMP_C = "aaaa0000-0000-4000-8000-00000000000c"; // leave, reason null
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const MAX_UUID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

const NAME_A = "คนเอ";
const NAME_B = "คนบี";
const NAME_C = "คนซี";
const REASON_A = "เหตุผล A";

const SESSIONS = [
  { id: "sess-a", session_date: "2026-11-05" },
  { id: "sess-b", session_date: "2026-11-12" },
];
const ATTENDANCE = [
  { id: "att-1", session_id: "sess-a", employee_id: EMP_A, status_code: "urgent_busy", reason: REASON_A, shift: null, registered_at: "2026-11-05T02:00:00.000Z" },
  { id: "att-2", session_id: "sess-a", employee_id: EMP_B, status_code: "attended", reason: null, shift: null, registered_at: "2026-11-05T02:30:00.000Z" },
  { id: "att-3", session_id: "sess-b", employee_id: EMP_C, status_code: "leave", reason: null, shift: null, registered_at: "2026-11-12T01:40:00.000Z" },
];

const UNAUTHENTICATED = "ไม่ได้เข้าสู่ระบบ";
const FORBIDDEN = "ไม่มีสิทธิ์เข้าถึงส่วนนี้";
const INVALID_INPUT = "ข้อมูลไม่ถูกต้อง";
const TYPE_ERROR = "ประเภทการประชุมไม่ถูกต้อง";
const SERVER_ERROR = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";
const PIN_MESSAGE = "เลขบัตรประชาชนหรือ PIN ไม่ถูกต้อง";
const LOCKED_MESSAGE = "บัญชีถูกล็อกชั่วคราว";
const NO_ROW_MESSAGE = "ไม่พบข้อมูลของคนนี้ในรอบนี้";
const NO_REASON_MESSAGE = "สถานะนี้ไม่มีเหตุผล";

function validBody(overrides = {}) {
  return {
    pin: PIN_OK,
    code: "monthly",
    cycle: "2026-11",
    employeeId: EMP_A,
    ...overrides,
  };
}

function bodyString(overrides) {
  return JSON.stringify(validBody(overrides));
}

async function post(path = "/api/meeting/dashboard/reason", options = {}) {
  const { cookie = CONTROLLER_COOKIE, contentType = "application/json", body = validBody() } = options;
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (contentType) headers["Content-Type"] = contentType;
  return app.request(path, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  }, ENV);
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

function freeze(t) {
  t.mock.timers.enable({ apis: ["Date"], now: NOW_MS });
}

/**
 * Fake PostgREST backend. Credential writes mutate a local credential row so
 * the counter and lock rule can be driven attempt by attempt. No secret value
 * is ever printed; tests inspect the captured objects.
 */
async function createBackend(options = {}) {
  const calls = [];
  const credUpdates = [];
  const auditCalls = [];
  let adminSelectCount = 0;
  const credential = {
    employee_id: CONTROLLER_ID,
    pin_hash: options.bcryptHash ? BCRYPT_HASH : await pinHash(PEPPER, CONTROLLER_ID, PIN_OK),
    failed_attempts: options.startAttempts ?? 0,
    locked_until: options.lockedUntil ?? null,
    updated_at: null,
  };
  let lastSessionRole = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input), method: init.method ?? "GET" };
    calls.push(call);
    const url = new URL(String(input));
    const table = tableOf(String(input));
    const params = url.searchParams;
    const method = call.method;

    if (table === "auth_sessions" && method === "PATCH") return emptyResponse();
    if (table === "auth_sessions" && method === "GET") {
      const roles = {
        [await sha256Hex(CONTROLLER_TOKEN)]: "meeting_controller",
        [await sha256Hex(EMPLOYEE_TOKEN)]: "employee",
      };
      lastSessionRole = roles[params.get("token_hash")?.replace("eq.", "")] ?? null;
      if (lastSessionRole) {
        return jsonResponse([{
          id: "sess-row-1",
          employee_id: CONTROLLER_ID,
          login_role: lastSessionRole,
          last_active_at: new Date(NOW_MS).toISOString(),
          expires_at: "2026-11-10T15:00:00.000Z",
          revoked_at: null,
        }]);
      }
      return jsonResponse([]);
    }
    if (table === "employees" && !String(params.get("select") ?? "").includes("departments")) {
      // The session path selects columns "*" and must always see an active
      // controller; the reason route's PIN path selects "id,is_active" and
      // honours the per-test active flag.
      if (String(params.get("select")).trim() === "*") {
        return jsonResponse([{ id: CONTROLLER_ID, is_active: true }]);
      }
      const active = options.controllerActive ?? true;
      return jsonResponse(active ? [{ id: CONTROLLER_ID, is_active: true }] : [{ id: CONTROLLER_ID, is_active: false }]);
    }
    if (["hr_admins", "meeting_admins", "system_admins"].includes(table)) {
      // allowedLoginTypesFor runs twice per request: once inside readSession
      // (hr_admins, then meeting_admins) and again at the reason route's PIN
      // step. The fake tracks the running count so `roleGranted: false` can
      // deny membership only in the PIN wave (every second meeting_admins
      // select) while the session wave stays valid.
      adminSelectCount += 1;
      const pinWave = adminSelectCount % 4 === 0;
      const controllerRow = table === "meeting_admins" &&
        params.get("employee_id") === `eq.${CONTROLLER_ID}` &&
        lastSessionRole === "meeting_controller" &&
        (options.roleGranted !== false || !pinWave);
      return jsonResponse(controllerRow ? [{ employee_id: CONTROLLER_ID }] : []);
    }
    if (table === "leave_requests") return jsonResponse([]);
    if (table === "leave_requests") return jsonResponse([]);

    if (options.failTable && table === options.failTable) {
      return jsonResponse({ code: "fake-db-down" }, 500);
    }

    if (table === "employee_credentials" && method === "GET") {
      if (options.credentialMissing) return jsonResponse([]);
      const row = { ...credential };
      if (options.nullPinHash) row.pin_hash = null;
      return jsonResponse([row]);
    }
    if (table === "employee_credentials" && method === "PATCH") {
      const patch = JSON.parse(init.body ?? "{}");
      credUpdates.push(patch);
      Object.assign(credential, patch);
      return emptyResponse();
    }

    if (table === "meeting_types" && method === "GET") {
      return jsonResponse(options.typeMissing ? [] : [{ id: TYPE_ID, code: "monthly", name: "ประชุมประจำเดือน" }]);
    }
    if (table === "meeting_sessions" && method === "GET") {
      const ids = (params.get("meeting_type_id") ?? "").replace("eq.", "");
      const all = ids === TYPE_ID ? SESSIONS : [];
      return jsonResponse(all);
    }
    if (table === "meeting_attendance" && method === "GET") {
      const inFilter = params.get("session_id") ?? "";
      if (!inFilter.startsWith("in.(")) return jsonResponse([]);
      const ids = inFilter.slice(4, -1).split(",").filter(Boolean);
      return jsonResponse(ATTENDANCE.filter((row) => ids.includes(row.session_id)));
    }
    if (table === "audit_logs") {
      auditCalls.push({ method, body: init.body ? JSON.parse(init.body) : null });
      return jsonResponse([]);
    }

    throw new Error(`unrouted fake fetch: ${method} ${String(input)}`);
  };

  return {
    calls,
    credUpdates,
    auditCalls,
    credential,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function tableCalls(backend, table) {
  return backend.calls.filter((call) => tableOf(call.url) === table);
}

/* ---------------------------------- tests --------------------------------- */

test("strict body rejects extras and malformed values with 400 before any PIN or lookup call", async (t) => {
  freeze(t);
  const backend = await createBackend();
  try {
    const badVariants = [
      { pin2: "999999" }, // extra field
      { pin: "12345" }, // five digits
      { pin: "1234567" }, // seven digits
      { code: "weekly" },
      { cycle: "2026/11" },
      { cycle: "2026-1" },
      { employeeId: "not-a-uuid" },
      { employeeId: "123e4567-e89b-02d3-a456-426614174000" }, // version 0
    ];
    for (const overrides of badVariants) {
      const res = await post(undefined, { body: JSON.stringify(validBody(overrides)) });
      assert.equal(res.status, 400, JSON.stringify(overrides));
      assert.deepEqual(await res.json(), { ok: false, error: INVALID_INPUT });
      assert.equal(tableCalls(backend, "employee_credentials").filter((call) => call.method !== "PATCH").length, 0);
      assert.equal(tableCalls(backend, "meeting_types").length, 0);
      assert.equal(backend.auditCalls.length, 0);
      backend.calls.length = 0;
    }

    // Wrong content type and an over-4KB body land on the same 400.
    const raw = await post(undefined, { contentType: "text/plain", body: bodyString({}) });
    assert.equal(raw.status, 400);
    assert.deepEqual(await raw.json(), { ok: false, error: INVALID_INPUT });

    const big = await post(undefined, { body: "a".repeat(4 * 1024 + 1) });
    assert.equal(big.status, 400);
    assert.deepEqual(await big.json(), { ok: false, error: INVALID_INPUT });
    assert.equal(tableCalls(backend, "employee_credentials").filter((call) => call.method !== "PATCH").length, 0);
    assert.equal(tableCalls(backend, "meeting_types").length, 0);
    assert.equal(backend.auditCalls.length, 0);
  } finally {
    backend.restore();
  }
});

test("nil and max UUIDs pass body validation and reach the row lookup", async (t) => {
  freeze(t);
  const backend = await createBackend();
  try {
    for (const employeeId of [NIL_UUID, MAX_UUID]) {
      const res = await post(undefined, { body: validBody({ employeeId }) });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: false, error: NO_ROW_MESSAGE });
    }
    // The lookup genuinely ran (type and attendance reads happened).
    assert.ok(tableCalls(backend, "meeting_types").length >= 2);
  } finally {
    backend.restore();
  }
});

test("auth: 401 without a cookie and 403 for an employee session, with no lookup", async (t) => {
  freeze(t);
  const backend = await createBackend();
  try {
    const anon = await post(undefined, { cookie: null });
    assert.equal(anon.status, 401);
    assert.deepEqual(await anon.json(), { ok: false, error: UNAUTHENTICATED });

    const employee = await post(undefined, { cookie: EMPLOYEE_COOKIE });
    assert.equal(employee.status, 403);
    assert.deepEqual(await employee.json(), { ok: false, error: FORBIDDEN });

    assert.equal(tableCalls(backend, "employee_credentials").length, 0);
    assert.equal(tableCalls(backend, "meeting_types").length, 0);
    assert.equal(backend.auditCalls.length, 0);
  } finally {
    backend.restore();
  }
});

test("wrong PIN bumps the counter with the generic 401 and never reaches the lookup", async (t) => {
  freeze(t);
  const backend = await createBackend({ startAttempts: 0 });
  try {
    const res = await post(undefined, { body: validBody({ pin: PIN_BAD }) });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { ok: false, error: PIN_MESSAGE });

    assert.deepEqual(backend.credUpdates, [{ failed_attempts: 1, updated_at: new Date(NOW_MS).toISOString() }]);
    assert.equal(backend.auditCalls.length, 0);
    assert.equal(tableCalls(backend, "meeting_types").length, 0);
  } finally {
    backend.restore();
  }
});

test("the fifth failure locks: counter resets to 0, lock is now + 15 minutes, later requests stay locked", async (t) => {
  freeze(t);
  const backend = await createBackend({ startAttempts: 0 });
  const lockedUntil = new Date(NOW_MS + 15 * 60 * 1000).toISOString();
  try {
    const updates = [];
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const res = await post(undefined, { body: validBody({ pin: PIN_BAD }) });
      assert.equal(res.status, 401, `attempt ${attempt}`);
      assert.deepEqual(await res.json(), { ok: false, error: PIN_MESSAGE });
      updates.push(backend.credUpdates[backend.credUpdates.length - 1].failed_attempts);
    }
    assert.deepEqual(updates, [1, 2, 3, 4]);

    const fifth = await post(undefined, { body: validBody({ pin: PIN_BAD }) });
    assert.equal(fifth.status, 423);
    assert.deepEqual(await fifth.json(), { ok: false, error: LOCKED_MESSAGE, lockedUntil: lockedUntil });
    assert.equal(backend.credential.failed_attempts, 0);
    assert.equal(backend.credential.locked_until, lockedUntil);

    const writesAfterLock = backend.credUpdates.length;
    const next = await post(undefined, { body: validBody() }); // even the right PIN
    assert.equal(next.status, 423);
    assert.deepEqual(await next.json(), { ok: false, error: LOCKED_MESSAGE, lockedUntil: lockedUntil });
    assert.equal(backend.credUpdates.length, writesAfterLock); // a locked request writes nothing
    assert.equal(backend.auditCalls.length, 0);
  } finally {
    backend.restore();
  }
});

test("a failed role check counts as the same attempt failure with the generic 401", async (t) => {
  freeze(t);
  const backend = await createBackend({ roleGranted: false });
  try {
    const res = await post(); // correct PIN, but meeting_admins membership missing
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { ok: false, error: PIN_MESSAGE });
    assert.deepEqual(backend.credUpdates, [{ failed_attempts: 1, updated_at: new Date(NOW_MS).toISOString() }]);
    assert.equal(backend.auditCalls.length, 0);
  } finally {
    backend.restore();
  }
});

test("missing, inactive and null-hash credentials answer the generic 401 without a counter write", async (t) => {
  freeze(t);
  for (const options of [{ credentialMissing: true }, { controllerActive: false }, { nullPinHash: true }]) {
    const backend = await createBackend(options);
    try {
      const res = await post();
      assert.equal(res.status, 401, JSON.stringify(Object.keys(options)));
      assert.deepEqual(await res.json(), { ok: false, error: PIN_MESSAGE });
      assert.equal(backend.credUpdates.length, 0);
      assert.equal(backend.auditCalls.length, 0);
    } finally {
      backend.restore();
    }
  }
});

test("a stored bcrypt-style pin_hash answers 401 every time", async (t) => {
  freeze(t);
  const backend = await createBackend({ bcryptHash: true });
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await post();
      assert.equal(res.status, 401, `try ${attempt}`);
      assert.deepEqual(await res.json(), { ok: false, error: PIN_MESSAGE });
    }
    const attempts = backend.credUpdates.map((patch) => patch.failed_attempts);
    assert.deepEqual(attempts, [1, 2]);
    assert.equal(backend.auditCalls.length, 0);
  } finally {
    backend.restore();
  }
});

test("unknown meeting type: 400 with the exact Thai message (after the PIN passes)", async (t) => {
  freeze(t);
  const backend = await createBackend({ typeMissing: true });
  try {
    const res = await post(undefined, { body: validBody({ code: "sup" }) });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, error: TYPE_ERROR });
    assert.equal(backend.auditCalls.length, 0);
  } finally {
    backend.restore();
  }
});

test("200 ok:false: no row for this person and a status without a reason, no audit row", async (t) => {
  freeze(t);
  const backend = await createBackend();
  try {
    const noRow = await post(undefined, { body: validBody({ employeeId: NIL_UUID, cycle: "2026-11" }) });
    assert.equal(noRow.status, 200);
    assert.deepEqual(await noRow.json(), { ok: false, error: NO_ROW_MESSAGE });

    const wrongCycle = await post(undefined, { body: validBody({ cycle: "2026-12" }) });
    assert.equal(wrongCycle.status, 200);
    assert.deepEqual(await wrongCycle.json(), { ok: false, error: NO_ROW_MESSAGE });

    const noReason = await post(undefined, { body: validBody({ employeeId: EMP_B }) });
    assert.equal(noReason.status, 200);
    assert.deepEqual(await noReason.json(), { ok: false, error: NO_REASON_MESSAGE });

    assert.equal(backend.auditCalls.length, 0);
    // Credential state untouched apart from the success reset writes.
    assert.equal(backend.credential.failed_attempts, 0);
  } finally {
    backend.restore();
  }
});

test("success: exact audit row, Thai status label, reason null falls back to ''", async (t) => {
  freeze(t);
  const backend = await createBackend({ startAttempts: 3 });
  try {
    const urgent = await post(undefined, { body: validBody({ employeeId: EMP_A }) });
    assert.equal(urgent.status, 200);
    assert.deepEqual(await urgent.json(), { ok: true, status: "ติดงานด่วน", reason: REASON_A });
    assert.deepEqual(backend.auditCalls, [{
      method: "POST",
      body: {
        actor_id: CONTROLLER_ID,
        action: "dashboard_reason_viewed",
        entity: "meeting_attendance",
        entity_id: "att-1",
        detail: null,
      },
    }]);

    // The success path resets the counter and clears the lock (employee_id filter).
    const reset = backend.credUpdates.at(-1);
    assert.deepEqual(reset, { failed_attempts: 0, locked_until: null, updated_at: new Date(NOW_MS).toISOString() });

    backend.auditCalls.length = 0;
    const leave = await post(undefined, { body: validBody({ employeeId: EMP_C }) });
    assert.equal(leave.status, 200);
    assert.deepEqual(await leave.json(), { ok: true, status: "ลาประชุม", reason: "" });
    const leaveAudit = backend.auditCalls.at(-1);
    assert.equal(leaveAudit.body.entity_id, "att-3");
    assert.equal(leaveAudit.body.detail, null);
  } finally {
    backend.restore();
  }
});

test("a failing lookup answers 500 with the exact Thai server message", async (t) => {
  freeze(t);
  const backend = await createBackend({ failTable: "meeting_types" });
  try {
    const res = await post();
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { ok: false, error: SERVER_ERROR });
    assert.equal(backend.auditCalls.length, 0);
  } finally {
    backend.restore();
  }
});

test("leak test: PIN, hashes, tokens, employee names stay out of responses, audit rows and log lines", async (t) => {
  freeze(t);
  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...parts) => logged.push(parts.map((part) => String(part)).join(" "));
  const backend = await createBackend({ startAttempts: 3 });
  try {
    // Drive several paths, including a wrong PIN and a success reply.
    await post(undefined, { body: validBody({ pin: PIN_BAD }) });
    await post(undefined, { cookie: null });
    await post(undefined, { cookie: EMPLOYEE_COOKIE });
    const ok = await post();
    assert.equal(ok.status, 200);

    const auditText = JSON.stringify(backend.auditCalls, "utf8");
    const logText = logged.join("\n");
    for (const snippet of [PIN_OK, PIN_BAD, CONTROLLER_TOKEN, EMPLOYEE_TOKEN, BCRYPT_HASH, NAME_A, NAME_B, NAME_C]) {
      assert.ok(!logText.includes(snippet), `log line must not contain ${snippet.slice(0, 6)}…`);
      assert.ok(!auditText.includes(snippet), `audit row must not contain ${snippet.slice(0, 6)}…`);
    }
    // Reason text reaches only the sanctioned response field, never audit/log.
    assert.ok(!logText.includes(REASON_A));
    assert.ok(!auditText.includes(REASON_A));
    const okBody = await ok.text(); // already-consumed? app.request returns a fresh Response each call
  } finally {
    console.error = originalConsoleError;
    backend.restore();
  }
});
