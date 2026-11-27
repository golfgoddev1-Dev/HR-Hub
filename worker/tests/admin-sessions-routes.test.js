// /api/admin/sessions, /sessions/:id/revoke and /accounts/:id/unlock — role gate,
// what is listed, the own-session rule, the writes, and the audit rows.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const ADMIN_TOKEN = "a".repeat(43);
const HR_TOKEN = "h".repeat(43);
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const HR_ID = "33333333-3333-4333-8333-333333333333";
const EMP_ID = "55555555-5555-4555-8555-555555555555";
const LOCKED_ID = "66666666-6666-4666-8666-666666666666";
const NO_CRED_ID = "77777777-7777-4777-8777-777777777777";

const S_EMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S_OWN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const S_IDLE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const S_REVOKED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const S_MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const NOW = Date.now();
const iso = (offsetMinutes) => new Date(NOW + offsetMinutes * 60 * 1000).toISOString();

function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit"].includes(key)) continue;
    const time = (v) => Date.parse(v);
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
    } else if (value.startsWith("gt.")) {
      if (row[key] === null || row[key] === undefined || !(time(row[key]) > time(value.slice(3)))) return false;
    } else if (value.startsWith("eq.")) {
      if (String(row[key]) !== value.slice(3)) return false;
    } else if (value.startsWith("in.(")) {
      if (!value.slice(4, -1).split(",").includes(String(row[key]))) return false;
    } else {
      return false;
    }
  }
  return true;
}

async function createFake() {
  const future = iso(6 * 60);
  const session = async (id, token, employeeId, role) => ({
    id,
    token_hash: await sha256Hex(token),
    employee_id: employeeId,
    login_role: role,
    revoked_at: null,
    created_at: iso(-30),
    last_active_at: iso(0),
    expires_at: future,
  });
  const state = {
    employees: [
      { id: ADMIN_ID, employee_code: "ADM001", full_name: "ผู้ดูแล ระบบ", is_active: true },
      { id: HR_ID, employee_code: "HR001", full_name: "เจ้าหน้าที่ HR", is_active: true },
      { id: EMP_ID, employee_code: "AB001", full_name: "พนักงาน หนึ่ง", is_active: true },
      { id: LOCKED_ID, employee_code: "LK001", full_name: "พนักงาน ล็อก", is_active: true },
    ],
    hr_admins: [{ employee_id: HR_ID }],
    system_admins: [{ employee_id: ADMIN_ID }],
    employee_credentials: [
      { employee_id: LOCKED_ID, locked_until: iso(10), failed_attempts: 0, pin_hash: "SECRET-PIN-HASH", national_id_hash: "SECRET-ID" },
      { employee_id: EMP_ID, locked_until: iso(-10), failed_attempts: 2, pin_hash: "SECRET-PIN-HASH" },
    ],
    auth_sessions: [
      await session("00000000-0000-4000-8000-0000000000a1", ADMIN_TOKEN, ADMIN_ID, "system_admin"),
      await session("00000000-0000-4000-8000-0000000000a2", HR_TOKEN, HR_ID, "hr"),
      { ...(await session(S_EMP, "x".repeat(43), EMP_ID, "employee")), last_active_at: iso(-2) },
      { ...(await session(S_OWN, "y".repeat(43), ADMIN_ID, "system_admin")), last_active_at: iso(-3) },
      { ...(await session(S_IDLE, "z".repeat(43), EMP_ID, "employee")), last_active_at: iso(-60) },
      { ...(await session(S_REVOKED, "w".repeat(43), EMP_ID, "employee")), revoked_at: iso(-5) },
    ],
    audit_logs: [],
  };
  const writes = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const parsed = new URL(String(input));
    const table = parsed.pathname.split("/").pop();
    const method = (init.method ?? "GET").toUpperCase();
    const params = parsed.searchParams;
    const body = init.body ? JSON.parse(init.body) : null;
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

    if (method === "GET") {
      let rows = (state[table] ?? []).filter((row) => matches(params, row));
      const order = params.get("order");
      if (order === "last_active_at.desc") rows = [...rows].sort((a, b) => Date.parse(b.last_active_at) - Date.parse(a.last_active_at));
      const limit = Number(params.get("limit"));
      return json(limit > 0 ? rows.slice(0, limit) : rows);
    }
    if (method === "PATCH") {
      const updated = [];
      for (const row of state[table] ?? []) {
        if (!matches(params, row)) continue;
        Object.assign(row, body);
        updated.push({ ...row });
      }
      if (table !== "auth_sessions" || !("last_active_at" in (body ?? {}))) writes.push({ method, table, body, count: updated.length });
      return String(init.headers?.Prefer ?? "").includes("return=representation") ? json(updated) : new Response(null, { status: 204 });
    }
    if (method === "POST") {
      state[table] = [...(state[table] ?? []), body];
      writes.push({ method, table, body });
      return json([body], 201);
    }
    return new Response(null, { status: 204 });
  };
  return { state, writes, restore: () => { globalThis.fetch = original; } };
}

function call(path, { method = "GET", token = ADMIN_TOKEN } = {}) {
  const env = { SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "key" };
  const headers = token ? { Cookie: `hr_session=${token}` } : {};
  return app.request(`https://fake.local${path}`, { method, headers }, env);
}

const dataWrites = (fake) => fake.writes.filter((w) => !(w.table === "auth_sessions" && w.body && "last_active_at" in w.body));

test("every sessions route answers 401 without a session and 403 for a non system_admin", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  for (const [path, method] of [
    ["/api/admin/sessions", "GET"],
    [`/api/admin/sessions/${S_EMP}/revoke`, "POST"],
    [`/api/admin/accounts/${LOCKED_ID}/unlock`, "POST"],
  ]) {
    assert.equal((await call(path, { method, token: "" })).status, 401, path);
    assert.equal((await call(path, { method, token: HR_TOKEN })).status, 403, path);
  }
  assert.equal(dataWrites(fake).length, 0);
});

test("the list shows only live sessions and active locks, and no credential value", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await call("/api/admin/sessions");
  const text = await response.text();
  const body = JSON.parse(text);

  assert.equal(response.status, 200);
  const ids = body.sessions.map((s) => s.id);
  assert.ok(ids.includes(S_EMP));
  assert.ok(!ids.includes(S_IDLE), "an idle session is already dead");
  assert.ok(!ids.includes(S_REVOKED), "a revoked session is gone");
  assert.equal(body.sessions.find((s) => s.id === S_EMP).fullName, "พนักงาน หนึ่ง");
  assert.equal(body.sessions.find((s) => s.id === S_OWN).isOwn, true);
  assert.equal(body.sessions.find((s) => s.id === S_EMP).isOwn, false);
  assert.deepEqual(body.locked.map((l) => l.employeeId), [LOCKED_ID]);
  assert.equal(body.locked[0].employeeCode, "LK001");
  assert.ok(!text.includes("SECRET"));
  assert.ok(!text.includes("token_hash"));
});

test("revoke signs one session out and writes one audit row without a token", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await call(`/api/admin/sessions/${S_EMP}/revoke`, { method: "POST" });
  assert.equal(response.status, 200);
  assert.ok(fake.state.auth_sessions.find((s) => s.id === S_EMP).revoked_at);
  assert.equal(fake.state.auth_sessions.find((s) => s.id === S_IDLE).revoked_at, null);

  const audit = fake.state.audit_logs;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "session_revoked");
  assert.equal(audit[0].entity_id, EMP_ID);
  assert.equal(audit[0].actor_id, ADMIN_ID);
  assert.ok(!JSON.stringify(audit[0]).includes("token"));

  const again = await call(`/api/admin/sessions/${S_EMP}/revoke`, { method: "POST" });
  assert.equal(again.status, 404);
  assert.equal(fake.state.audit_logs.length, 1);
});

test("revoke refuses the admin's own sessions, unknown ids and bad ids", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const own = await call(`/api/admin/sessions/${S_OWN}/revoke`, { method: "POST" });
  assert.equal(own.status, 409);
  assert.equal(fake.state.auth_sessions.find((s) => s.id === S_OWN).revoked_at, null);

  assert.equal((await call(`/api/admin/sessions/${S_MISSING}/revoke`, { method: "POST" })).status, 404);
  assert.equal((await call(`/api/admin/sessions/${S_REVOKED}/revoke`, { method: "POST" })).status, 404);
  assert.equal((await call("/api/admin/sessions/not-a-uuid/revoke", { method: "POST" })).status, 400);
  assert.equal(fake.state.audit_logs.length, 0);
});

test("unlock clears the lock and the counter and audits it", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await call(`/api/admin/accounts/${LOCKED_ID}/unlock`, { method: "POST" });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.changed, true);

  const credential = fake.state.employee_credentials.find((c) => c.employee_id === LOCKED_ID);
  assert.equal(credential.locked_until, null);
  assert.equal(credential.failed_attempts, 0);
  assert.equal(credential.pin_hash, "SECRET-PIN-HASH");

  assert.equal(fake.state.audit_logs.length, 1);
  assert.equal(fake.state.audit_logs[0].action, "account_unlocked");
  assert.equal(fake.state.audit_logs[0].entity_id, LOCKED_ID);
});

test("unlock changes nothing for an account that is not locked, and 404s for no credential", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const expired = await call(`/api/admin/accounts/${EMP_ID}/unlock`, { method: "POST" });
  assert.deepEqual(await expired.json(), { ok: true, changed: false });
  assert.equal(fake.state.employee_credentials.find((c) => c.employee_id === EMP_ID).failed_attempts, 2);

  assert.equal((await call(`/api/admin/accounts/${NO_CRED_ID}/unlock`, { method: "POST" })).status, 404);
  assert.equal((await call("/api/admin/accounts/nope/unlock", { method: "POST" })).status, 400);
  assert.equal(fake.state.audit_logs.length, 0);
});
