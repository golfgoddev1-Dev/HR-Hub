// HR PIN and reset-code issuance. Every database call is a fake fetch, so no
// real row is ever written. The assertions check that only hashes are stored and
// that the raw value never reaches an audit row or a query string.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";
import { nationalIdHash } from "../src/national-id.js";
import { pinHash, validatePin } from "../src/pin-rules.js";

const PIN_PEPPER = "test-pin-pepper";
const RESET_SECRET = "test-reset-secret";
const NATIONAL_PEPPER = "test-national-pepper";

const HR_TOKEN = "h".repeat(43);
const EMPLOYEE_TOKEN = "e".repeat(43);
const HR_ID = "11111111-1111-4111-8111-111111111111";
const EMP_ID = "22222222-2222-4222-8222-222222222222";
const INACTIVE_ID = "33333333-3333-4333-8333-333333333333";
const UNKNOWN_ID = "44444444-4444-4444-8444-444444444444";
const NATIONAL_ID = "1234567890123";
const CODE = "12345678";
const DAY_MS = 24 * 60 * 60 * 1000;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function toNumber(value) {
  const text = String(value ?? "");
  if (/^\d+$/.test(text)) return Number(text);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/** Applies the PostgREST filters the Worker sends: eq, is.null, gt, lt, in. */
function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit"].includes(key)) continue;
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (String(row[key]) !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("in.(")) {
      const list = value.slice(4, -1).split(",");
      if (!list.includes(String(row[key]))) return false;
      continue;
    }
    if (value.startsWith("gt.") || value.startsWith("lt.")) {
      const op = value.slice(0, 2);
      const left = toNumber(row[key]);
      const right = toNumber(value.slice(3));
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      if (op === "gt" ? !(left > right) : !(left < right)) return false;
      continue;
    }
    // An operator this fake does not model must not quietly match.
    return false;
  }
  return true;
}

function makeLimiter({ success = true } = {}) {
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
          return Response.json({ success });
        },
      };
    },
  };
}

async function createFake(overrides = {}) {
  const now = new Date();
  const future = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
  const session = async (token, employeeId, role) => ({
    id: `session-${role}`,
    token_hash: await sha256Hex(token),
    employee_id: employeeId,
    login_role: role,
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: future,
  });

  const state = {
    employees: [
      { id: HR_ID, employee_code: "HR001", full_name: "เจ้าหน้าที่ ทดสอบ", is_active: true },
      { id: EMP_ID, employee_code: "EMP001", full_name: "พนักงาน ทดสอบ", is_active: true },
      { id: INACTIVE_ID, employee_code: "EMP002", full_name: "ปิดใช้งาน", is_active: false },
    ],
    hr_admins: [{ employee_id: HR_ID }],
    employee_credentials: [],
    pin_reset_codes: [],
    audit_logs: [],
    auth_sessions: [
      await session(HR_TOKEN, HR_ID, "hr"),
      await session(EMPLOYEE_TOKEN, EMP_ID, "employee"),
    ],
    ...overrides,
  };

  const writes = [];
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop();
    const params = parsed.searchParams;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, table, body });

    if (method === "GET") {
      return jsonResponse((state[table] ?? []).filter((row) => matches(params, row)));
    }
    if (method === "PATCH") {
      const patch = body ?? {};
      for (const row of state[table] ?? []) {
        if (matches(params, row)) Object.assign(row, patch);
      }
      writes.push({ method, table, body: patch });
      return new Response(null, { status: 204 });
    }

    writes.push({ method, table, body });
    if (method === "POST") {
      const rows = Array.isArray(body) ? body : [body];
      state[table] = [...(state[table] ?? []), ...rows];
      return jsonResponse(rows, 201);
    }
    return new Response(null, { status: 204 });
  };

  return {
    state,
    writes,
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    SUPABASE_URL: "https://fake-project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
    PIN_PEPPER,
    PIN_RESET_SECRET: RESET_SECRET,
    NATIONAL_ID_PEPPER: NATIONAL_PEPPER,
    RL_CONTEXT_IP: makeLimiter(),
    ...overrides,
  };
}

function issue(employeeId, action, env = makeEnv(), cookie = `hr_session=${HR_TOKEN}`) {
  return app.request(
    `https://fake.local/api/hr/employees/${employeeId}/${action}`,
    { method: "POST", headers: { Cookie: cookie } },
    env
  );
}

function writeOf(fake, table, method) {
  return fake.writes.find((write) => write.table === table && write.method === method) ?? null;
}

/** Writes other than the session last_active_at touch every request makes. */
function dataWrites(fake) {
  return fake.writes.filter((write) => write.table !== "auth_sessions");
}

test("HR issues an initial PIN that is stored only as an HMAC with PIN_PEPPER", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await issue(EMP_ID, "initial-pin");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.match(body.pin, /^\d{6}$/);
  assert.equal(validatePin(body.pin).ok, true);
  assert.equal(body.employeeCode, "EMP001");
  assert.equal(body.mustChangePin, true);

  const credential = writeOf(fake, "employee_credentials", "POST");
  assert.ok(credential, "the credential row is written");
  assert.equal(credential.body.employee_id, EMP_ID);
  assert.equal(credential.body.pin, undefined, "the raw PIN is never a column");
  assert.equal(credential.body.pin_hash, await pinHash(PIN_PEPPER, EMP_ID, body.pin));
  assert.equal(credential.body.pin_hash.length, 64);
  assert.notEqual(credential.body.pin_hash, body.pin);
  assert.equal(credential.body.pin_set_at.length > 0, true);
  assert.equal(credential.body.must_change_pin, true);
  assert.equal(credential.body.failed_attempts, 0);
  assert.equal(credential.body.locked_until, null);

  const audit = writeOf(fake, "audit_logs", "POST");
  assert.ok(audit, "the audit row is written");
  assert.equal(audit.body.action, "employee_initial_pin_issued");
  assert.equal(audit.body.entity, "employee");
  assert.equal(audit.body.entity_id, EMP_ID);
  assert.equal(audit.body.actor_id, HR_ID);
  assert.equal(audit.body.detail, null);
  assert.equal(audit.body.pin, undefined);
  assert.equal(JSON.stringify(audit.body).includes(body.pin), false);
  assert.equal(fake.calls.some((call) => call.url.includes(`pin=${body.pin}`)), false);
});

test("an inactive employee gets no initial PIN and nothing is written", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await issue(INACTIVE_ID, "initial-pin");
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(dataWrites(fake).length, 0);
});

test("non-HR roles and anonymous callers cannot issue a PIN", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const asEmployee = await issue(EMP_ID, "initial-pin", makeEnv(), `hr_session=${EMPLOYEE_TOKEN}`);
  assert.equal(asEmployee.status, 403);

  const anonymous = await app.request(
    `https://fake.local/api/hr/employees/${EMP_ID}/initial-pin`,
    { method: "POST" },
    makeEnv()
  );
  assert.equal(anonymous.status, 401);

  assert.equal(dataWrites(fake).length, 0);
});

test("initial PIN issuance is rate limited", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const env = makeEnv({ RL_CONTEXT_IP: makeLimiter({ success: false }) });
  const response = await issue(EMP_ID, "initial-pin", env);

  assert.equal(response.status, 429);
  assert.deepEqual(env.RL_CONTEXT_IP.calls, ["hr-initial-pin|unknown"]);
  assert.equal(dataWrites(fake).length, 0);
});

test("HR issues an 8-digit reset code valid for 24 hours and stored hashed", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const before = Date.now();
  const response = await issue(EMP_ID, "reset-code");
  const after = Date.now();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.match(body.code, /^\d{8}$/);
  assert.equal(body.singleUse, true);
  assert.equal(body.employeeCode, "EMP001");

  const expiresMs = Date.parse(body.expiresAt);
  assert.equal(expiresMs >= before + DAY_MS - 60_000, true);
  assert.equal(expiresMs <= after + DAY_MS + 60_000, true);

  const insertIndex = fake.writes.findIndex(
    (write) => write.table === "pin_reset_codes" && write.method === "POST"
  );
  const inserted = fake.writes[insertIndex];
  assert.ok(inserted, "a reset code row is inserted");
  assert.equal(inserted.body.employee_id, EMP_ID);
  assert.equal(inserted.body.code, undefined, "the raw code is never a column");
  assert.equal(
    inserted.body.code_hash,
    createHmac("sha256", RESET_SECRET).update(`${EMP_ID}:${body.code}`).digest("hex")
  );
  assert.equal(inserted.body.created_by, HR_ID);
  assert.equal(inserted.body.expires_at, body.expiresAt);
  assert.equal(inserted.body.used_at, null);
  assert.equal(inserted.body.attempts, 0);

  // Older codes are retired before the new one is written.
  const invalidateIndex = fake.writes.findIndex(
    (write) => write.table === "pin_reset_codes" && write.method === "PATCH"
  );
  assert.ok(invalidateIndex >= 0, "previous codes are invalidated");
  assert.equal(invalidateIndex < insertIndex, true);
  assert.equal(typeof fake.writes[invalidateIndex].body.used_at, "string");

  const audit = writeOf(fake, "audit_logs", "POST");
  assert.equal(audit.body.action, "pin_reset_code_issued");
  assert.equal(audit.body.detail, null);
  assert.equal(JSON.stringify(audit.body).includes(body.code), false);
  assert.equal(fake.calls.some((call) => call.url.includes(`code=${body.code}`)), false);
});

test("an unknown employee gets no reset code", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await issue(UNKNOWN_ID, "reset-code");

  assert.equal(response.status, 404);
  assert.equal(dataWrites(fake).length, 0);
});

test("a used reset code cannot be redeemed when setting a PIN", async (t) => {
  const codeHash = createHmac("sha256", RESET_SECRET).update(`${EMP_ID}:${CODE}`).digest("hex");
  const fake = await createFake({
    employee_credentials: [
      {
        employee_id: EMP_ID,
        national_id_hash: await nationalIdHash(NATIONAL_ID, NATIONAL_PEPPER),
        national_id_enc: null,
        pin_hash: null,
        pin_set_at: null,
      },
    ],
    pin_reset_codes: [
      {
        id: "reset-used",
        employee_id: EMP_ID,
        code_hash: codeHash,
        created_by: HR_ID,
        created_at: new Date(Date.now() - 60_000).toISOString(),
        expires_at: new Date(Date.now() + DAY_MS).toISOString(),
        used_at: new Date(Date.now() - 30_000).toISOString(),
        attempts: 0,
      },
    ],
  });
  t.after(() => fake.restore());

  const response = await app.request(
    "https://fake.local/api/auth/set-pin",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nationalId: NATIONAL_ID, code: CODE, pin: "135790", pinConfirm: "135790" }),
    },
    makeEnv()
  );

  assert.equal(response.status, 401);
  assert.equal(dataWrites(fake).length, 0, "a used code writes nothing");
});

test("an expired reset code cannot be redeemed when setting a PIN", async (t) => {
  const codeHash = createHmac("sha256", RESET_SECRET).update(`${EMP_ID}:${CODE}`).digest("hex");
  const fake = await createFake({
    employee_credentials: [
      {
        employee_id: EMP_ID,
        national_id_hash: await nationalIdHash(NATIONAL_ID, NATIONAL_PEPPER),
        national_id_enc: null,
        pin_hash: null,
        pin_set_at: null,
      },
    ],
    pin_reset_codes: [
      {
        id: "reset-expired",
        employee_id: EMP_ID,
        code_hash: codeHash,
        created_by: HR_ID,
        created_at: new Date(Date.now() - 2 * DAY_MS).toISOString(),
        expires_at: new Date(Date.now() - DAY_MS).toISOString(),
        used_at: null,
        attempts: 0,
      },
    ],
  });
  t.after(() => fake.restore());

  const response = await app.request(
    "https://fake.local/api/auth/set-pin",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nationalId: NATIONAL_ID, code: CODE, pin: "135790", pinConfirm: "135790" }),
    },
    makeEnv()
  );

  assert.equal(response.status, 401);
  assert.equal(dataWrites(fake).length, 0, "an expired code writes nothing");
});
