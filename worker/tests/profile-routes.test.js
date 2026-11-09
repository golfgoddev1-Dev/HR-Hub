// The employee profile is read-only. These tests pin the remaining reads and
// prove the old self-service PATCH is refused at the Worker for every role.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const TOKEN = "t".repeat(43);
const HR_TOKEN = "h".repeat(43);
const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const HR_ID = "99999999-9999-4999-8999-999999999999";
const DEPT_ACTIVE = "22222222-2222-4222-8222-222222222222";
const DEPT_OTHER = "33333333-3333-4333-8333-333333333333";
const POSITION_ID = "55555555-5555-4555-8555-555555555555";

const EMPLOYEE = {
  id: EMPLOYEE_ID,
  employee_code: "EMP-00001",
  name_prefix: "นาย",
  full_name: "สมชาย ทดสอบ",
  email: null,
  phone: null,
  department_id: DEPT_ACTIVE,
  position_id: POSITION_ID,
  is_active: true,
};

const DEPARTMENTS = [
  { id: DEPT_ACTIVE, name: "ฝ่ายบุคคล", is_active: true },
  { id: DEPT_OTHER, name: "ฝ่ายขาย", is_active: true },
  { id: "44444444-4444-4444-8444-444444444444", name: "ฝ่ายเก่า", is_active: false },
];

const POSITIONS = [{ id: POSITION_ID, name: "เจ้าหน้าที่" }];
const PREFIXES = [
  { name: "นาย", is_active: true },
  { name: "นาง", is_active: true },
  { name: "นางสาว", is_active: true },
  { name: "Mr.", is_active: false },
];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

function matches(row, params) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit"].includes(key)) continue;
    const actual = row[key] === undefined || row[key] === null ? "" : String(row[key]);
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (actual !== value.slice(3)) return false;
    }
  }
  return true;
}

async function createBackend({ role = "employee", employeeOverrides = {} } = {}) {
  const now = new Date();
  const token = role === "hr" ? HR_TOKEN : TOKEN;
  const employeeId = role === "hr" ? HR_ID : EMPLOYEE_ID;
  const state = {
    auth_sessions: [
      {
        id: "session-1",
        token_hash: await sha256Hex(token),
        employee_id: employeeId,
        login_role: role,
        revoked_at: null,
        last_active_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
      },
    ],
    employees: [{ ...EMPLOYEE, id: employeeId, ...employeeOverrides }],
    employee_credentials: [],
    departments: DEPARTMENTS.map((row) => ({ ...row })),
    positions: POSITIONS.map((row) => ({ ...row })),
    name_prefixes: PREFIXES.map((row) => ({ ...row })),
    audit_logs: [],
    hr_admins: role === "hr" ? [{ employee_id: HR_ID }] : [],
    meeting_admins: [],
    system_admins: [],
  };

  const calls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop();
    const params = parsed.searchParams;
    calls.push({ url, method, table, init });

    if (method === "GET") {
      return jsonResponse((state[table] ?? []).filter((row) => matches(row, params)));
    }
    return emptyResponse(204);
  };

  return {
    state,
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function call(path, token = TOKEN) {
  const init = token ? { headers: { Cookie: `hr_session=${token}` } } : {};
  return app.request(`https://fake.local${path}`, init, ENV);
}

function patch(body, token = TOKEN) {
  return app.request(
    "https://fake.local/api/profile/me",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: `hr_session=${token}` },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    ENV
  );
}

function writes(fake) {
  return fake.calls.filter((entry) => entry.method !== "GET" && entry.table !== "auth_sessions");
}

test("GET /me returns the caller's own record and no national id", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/profile/me");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.profile.id, EMPLOYEE_ID);
  assert.equal(body.profile.employeeCode, "EMP-00001");
  assert.equal(body.profile.departmentName, "ฝ่ายบุคคล");
  assert.equal(body.profile.positionName, "เจ้าหน้าที่");
  assert.equal("nationalId" in body.profile, false);

  const credentialReads = fake.calls.filter(
    (entry) =>
      entry.table === "employee_credentials" &&
      !new URL(entry.url).searchParams.get("select")?.includes("must_change_pin")
  );
  assert.deepEqual(credentialReads, []);
});

test("GET /me reports the account notification setting", async (t) => {
  const on = await createBackend({ employeeOverrides: { notifications_enabled: true } });
  t.after(() => on.restore());
  assert.equal((await (await call("/api/profile/me")).json()).profile.notificationsEnabled, true);

  const off = await createBackend({ employeeOverrides: { notifications_enabled: false } });
  t.after(() => off.restore());
  assert.equal((await (await call("/api/profile/me")).json()).profile.notificationsEnabled, false);
});

test("PATCH /me is forbidden for an employee and changes nothing", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await patch({
    full_name: "ชื่อใหม่",
    email: "new@example.com",
    phone: "0812345678",
    department_id: DEPT_OTHER,
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.ok, false);
  assert.equal(body.code, "profile_read_only");
  assert.equal(body.message, "ข้อมูลส่วนตัวเป็นแบบอ่านอย่างเดียว กรุณาติดต่อฝ่ายบุคคล (HR)");
  assert.deepEqual(writes(fake), []);
  assert.deepEqual(fake.state.employees[0], EMPLOYEE);
  assert.deepEqual(fake.state.audit_logs, []);
});

test("PATCH /me is forbidden for HR too, so editing stays on the HR page", async (t) => {
  const fake = await createBackend({ role: "hr" });
  t.after(() => fake.restore());

  const response = await patch({ full_name: "ชื่อใหม่" }, HR_TOKEN);
  assert.equal(response.status, 403);
  assert.deepEqual(writes(fake), []);
  assert.deepEqual(fake.state.audit_logs, []);
});

test("a malformed PATCH body is still refused with 403, not accepted", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  for (const body of ["", "not-json", {}, { employee_code: "EMP-99999" }]) {
    const response = await patch(body);
    assert.equal(response.status, 403);
  }
  assert.deepEqual(writes(fake), []);
});

test("GET /departments lists only active departments, id and name", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/profile/departments");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 2);
  assert.deepEqual(body.departments.map((row) => row.name), ["ฝ่ายบุคคล", "ฝ่ายขาย"]);
  for (const row of body.departments) assert.deepEqual(Object.keys(row).sort(), ["id", "name"]);
});

test("GET /name-prefixes lists only active lookup values", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/profile/name-prefixes");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 3);
  assert.deepEqual([...body.prefixes].sort(), ["นาง", "นางสาว", "นาย"].sort());
  assert.equal(body.prefixes.includes("Mr."), false);
});

test("an employee with no position reports null and reads no position row", async (t) => {
  const fake = await createBackend({ employeeOverrides: { position_id: null } });
  t.after(() => fake.restore());

  const body = await (await call("/api/profile/me")).json();
  assert.equal(body.profile.positionName, null);
  assert.equal(fake.calls.some((entry) => entry.table === "positions"), false);
});

test("anonymous callers are refused", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  assert.equal((await call("/api/profile/me", null)).status, 401);
  assert.equal((await call("/api/profile/departments", null)).status, 401);
});
