// The mandatory PIN change: a session that still carries a HR-issued PIN may
// only read its session, sign out and replace the PIN. The gate lives in
// src/app.js, so these tests call real routes through the app with a fake
// database; nothing touches a real project.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";
import { pinHash } from "../src/pin-rules.js";

const PIN_PEPPER = "test-pin-pepper";
const NATIONAL_ID_PEPPER = "test-national-pepper";
const PIN_RESET_SECRET = "test-reset-secret";

const HR_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "t".repeat(43);
const INITIAL_PIN = "246813";
const NEW_PIN = "135790";
const NATIONAL_ID = "1234567890123";
const NATIONAL_HASH = createHmac("sha256", NATIONAL_ID_PEPPER)
  .update(NATIONAL_ID)
  .digest("hex");

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  PIN_PEPPER,
  PIN_RESET_SECRET,
  NATIONAL_ID_PEPPER,
  COOKIE_SECURE: "false",
};

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

/** eq, is.null, gt, lt and in filters, as PostgREST applies them. */
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
      if (!value.slice(4, -1).split(",").includes(String(row[key]))) return false;
      continue;
    }
    if (value.startsWith("gt.") || value.startsWith("lt.")) {
      const left = toNumber(row[key]);
      const right = toNumber(value.slice(3));
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      if (value.startsWith("gt.") ? !(left > right) : !(left < right)) return false;
      continue;
    }
    return false;
  }
  return true;
}

async function createFake({ mustChangePin = true, role = "hr" } = {}) {
  const now = new Date();
  const state = {
    employees: [
      {
        id: HR_ID,
        employee_code: "HR001",
        full_name: "เจ้าหน้าที่ ทดสอบ",
        is_active: true,
      },
    ],
    hr_admins: role === "hr" ? [{ employee_id: HR_ID }] : [],
    meeting_admins: role === "meeting_controller" ? [{ employee_id: HR_ID }] : [],
    system_admins: role === "system_admin" ? [{ employee_id: HR_ID }] : [],
    employee_credentials: [
      {
        employee_id: HR_ID,
        national_id_hash: NATIONAL_HASH,
        national_id_enc: null,
        pin_hash: await pinHash(PIN_PEPPER, HR_ID, INITIAL_PIN),
        pin_set_at: now.toISOString(),
        must_change_pin: mustChangePin,
        failed_attempts: 0,
        locked_until: null,
        updated_at: now.toISOString(),
      },
    ],
    auth_sessions: [
      {
        id: "session-1",
        token_hash: await sha256Hex(TOKEN),
        employee_id: HR_ID,
        login_role: role,
        revoked_at: null,
        last_active_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
        // The session query embeds the flag, like PostgREST does for the real row.
        employee_credentials: [{ must_change_pin: mustChangePin }],
      },
    ],
    audit_logs: [],
    leave_requests: [],
    departments: [],
    positions: [],
  };

  const writes = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop();
    const params = parsed.searchParams;
    const body = init.body ? JSON.parse(init.body) : null;

    if (method === "GET") {
      return jsonResponse((state[table] ?? []).filter((row) => matches(params, row)));
    }
    if (method === "PATCH") {
      const patch = body ?? {};
      for (const row of state[table] ?? []) {
        if (matches(params, row)) Object.assign(row, patch);
      }
      writes.push({ method, table, body: patch });
      if (table === "employee_credentials") {
        for (const row of state.auth_sessions ?? []) {
          const credential = (state.employee_credentials ?? []).find(
            (item) => item.employee_id === row.employee_id
          );
          if (credential) {
            row.employee_credentials = [{ must_change_pin: credential.must_change_pin === true }];
          }
        }
      }
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
    credential: () => state.employee_credentials[0],
    restore() {
      globalThis.fetch = original;
    },
  };
}

function login(pin = INITIAL_PIN) {
  return app.request(
    "https://fake.local/api/auth/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loginType: "hr", nationalId: NATIONAL_ID, pin }),
    },
    ENV
  );
}

function withSession(url, init = {}) {
  return app.request(
    url,
    { ...init, headers: { ...(init.headers ?? {}), Cookie: `hr_session=${TOKEN}` } },
    ENV
  );
}

function changePin(pin = NEW_PIN, pinConfirm = NEW_PIN) {
  return withSession("https://fake.local/api/auth/change-pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin, pinConfirm }),
  });
}

test("login with a HR-issued PIN answers mustChangePin and lands on /change-pin", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await login();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.mustChangePin, true);
  assert.equal(body.redirectTo, "/change-pin");
});

test("a session with an unchanged HR PIN is refused on every other API call", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const blocked = await withSession("https://fake.local/api/hr/directory/catalog");
  const blockedBody = await blocked.json();
  assert.equal(blocked.status, 403);
  assert.equal(blockedBody.ok, false);
  assert.equal(blockedBody.message, "ต้องเปลี่ยน PIN ก่อนใช้งานระบบ");

  // The three exempt routes still work so the employee can comply or leave.
  const me = await withSession("https://fake.local/api/auth/me");
  const meBody = await me.json();
  assert.equal(me.status, 200);
  assert.equal(meBody.mustChangePin, true);
  assert.equal(meBody.redirectTo, "/change-pin");

  const logout = await withSession("https://fake.local/api/auth/logout", { method: "POST" });
  assert.equal(logout.status, 200);
});

test("changing the PIN stores only the new hash, clears the flag and audits without the PIN", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await changePin();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.mustChangePin, false);
  assert.equal(body.redirectTo, "/hr");

  const credential = fake.credential();
  assert.equal(credential.pin_hash, await pinHash(PIN_PEPPER, HR_ID, NEW_PIN));
  assert.equal(credential.pin_hash.length, 64);
  assert.notEqual(credential.pin_hash, NEW_PIN);
  assert.equal(credential.must_change_pin, false);
  assert.equal(credential.failed_attempts, 0);
  assert.equal(credential.locked_until, null);
  assert.equal(typeof credential.pin_set_at, "string");

  const patch = fake.writes.find((write) => write.table === "employee_credentials" && write.method === "PATCH");
  assert.ok(patch, "the credential row is updated");
  assert.equal(patch.body.pin, undefined, "the raw PIN is never a column");
  assert.equal(JSON.stringify(patch.body).includes(NEW_PIN), false);

  const audit = fake.writes.find((write) => write.table === "audit_logs" && write.method === "POST");
  assert.ok(audit, "the audit row is written");
  assert.equal(audit.body.action, "pin_changed");
  assert.equal(audit.body.detail, null);
  assert.equal(JSON.stringify(audit.body).includes(NEW_PIN), false);
});

test("after the change the API is reachable and the initial PIN no longer logs in", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  assert.equal((await changePin()).status, 200);

  const open = await withSession("https://fake.local/api/hr/directory/catalog");
  assert.equal(open.status !== 403, true);

  const reused = await login(INITIAL_PIN);
  assert.equal(reused.status, 401);
});

test("a non-admin cannot change a PIN it already set", async (t) => {
  const fake = await createFake({ mustChangePin: false });
  t.after(() => fake.restore());

  const response = await changePin();
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.ok, false);
  assert.equal(
    fake.writes.filter((write) => write.table === "employee_credentials").length,
    0
  );
});

test("the system admin can change its own PIN without the first-time flag", async (t) => {
  const fake = await createFake({ mustChangePin: false, role: "system_admin" });
  t.after(() => fake.restore());

  const response = await changePin();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.mustChangePin, false);
  assert.equal(fake.credential().pin_hash, await pinHash(PIN_PEPPER, HR_ID, NEW_PIN));
});

test("change-pin needs a session", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await app.request(
    "https://fake.local/api/auth/change-pin",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: NEW_PIN, pinConfirm: NEW_PIN }),
    },
    ENV
  );

  assert.equal(response.status, 401);
  assert.equal(fake.writes.length, 0);
});

test("change-pin rejects a weak PIN and a mismatched confirmation", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const weak = await changePin("000000", "000000");
  assert.equal(weak.status, 400);

  const mismatch = await changePin(NEW_PIN, "135791");
  assert.equal(mismatch.status, 400);

  assert.equal(fake.credential().must_change_pin, true);
  assert.equal(
    fake.writes.filter((write) => write.table === "employee_credentials").length,
    0
  );
});
