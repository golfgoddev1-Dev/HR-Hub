// The self-service profile routes, end to end against a fake PostgREST.
// - GET /me reads only the caller's row and never a national id;
// - PATCH /me refuses anything outside PROFILE_EDITABLE_FIELDS;
// - a department must be an existing ACTIVE id, so a name or free text is 400;
// - one audit row per save, detail null, no value from the profile in it.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const TOKEN = "t".repeat(43);
const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const DEPT_ACTIVE = "22222222-2222-4222-8222-222222222222";
const DEPT_OTHER = "33333333-3333-4333-8333-333333333333";
const DEPT_INACTIVE = "44444444-4444-4444-8444-444444444444";
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
  { id: DEPT_INACTIVE, name: "ฝ่ายเก่า", is_active: false },
];

const POSITIONS = [{ id: POSITION_ID, name: "เจ้าหน้าที่" }];

const NAME_PREFIXES = [
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
      continue;
    }
    if (value.startsWith("in.(")) {
      const list = value.slice(4, -1).split(",");
      if (!list.includes(actual)) return false;
    }
  }
  return true;
}

async function createBackend({ token = TOKEN, role = "employee", employeeOverrides = {} } = {}) {
  const now = new Date();
  const state = {
    auth_sessions: [
      {
        id: "session-1",
        token_hash: await sha256Hex(token),
        employee_id: EMPLOYEE_ID,
        login_role: role,
        revoked_at: null,
        last_active_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
      },
    ],
    employees: [{ ...EMPLOYEE, ...employeeOverrides }],
    employee_credentials: [],
    departments: DEPARTMENTS.map((row) => ({ ...row })),
    positions: POSITIONS.map((row) => ({ ...row })),
    name_prefixes: NAME_PREFIXES.map((row) => ({ ...row })),
    audit_logs: [],
    hr_admins: role === "hr" ? [{ employee_id: EMPLOYEE_ID }] : [],
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
    const body = typeof init.body === "string" ? init.body : null;
    calls.push({ url, method, table, body, init });

    if (method === "GET") {
      return jsonResponse((state[table] ?? []).filter((row) => matches(row, params)));
    }

    if (method === "PATCH") {
      const patch = body ? JSON.parse(body) : {};
      for (const row of state[table] ?? []) {
        if (matches(row, params)) Object.assign(row, patch);
      }
      if (params.get("select")) {
        return jsonResponse((state[table] ?? []).filter((row) => matches(row, params)));
      }
      return emptyResponse(204);
    }

    if (method === "POST") {
      const row = body ? JSON.parse(body) : {};
      state[table] = state[table] ?? [];
      state[table].push(Array.isArray(row) ? row[0] : row);
      return emptyResponse(201);
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

function call(path, token) {
  const init = token ? { headers: { Cookie: `hr_session=${token}` } } : {};
  return app.request(`https://fake.local${path}`, init, ENV);
}

function patch(body, token = TOKEN) {
  const init = {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: `hr_session=${token}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
  return app.request("https://fake.local/api/profile/me", init, ENV);
}

function writes(fake) {
  return fake.calls.filter((entry) => entry.method !== "GET" && entry.table !== "auth_sessions");
}

function auditRows(fake) {
  return fake.state.audit_logs ?? [];
}

test("GET /me returns the caller's own record and no national id", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/profile/me", TOKEN);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.profile.id, EMPLOYEE_ID);
  assert.equal(body.profile.employeeCode, "EMP-00001");
  assert.equal(body.profile.fullName, "สมชาย ทดสอบ");
  assert.equal(body.profile.email, null);
  assert.equal(body.profile.departmentId, DEPT_ACTIVE);
  assert.equal(body.profile.departmentName, "ฝ่ายบุคคล");
  assert.equal(body.profile.departmentActive, true);
  assert.equal(body.profile.positionName, "เจ้าหน้าที่");
  assert.equal("nationalId" in body.profile, false);

  const text = JSON.stringify(body);
  for (const forbidden of ["national", "1234567890123", "employee_credentials"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }

  // Only the session employee is ever read.
  const employeeReads = fake.calls.filter(
    (entry) => entry.method === "GET" && entry.table === "employees"
  );
  assert.ok(employeeReads.length > 0);
  for (const read of employeeReads) {
    assert.equal(new URL(read.url).searchParams.get("id"), `eq.${EMPLOYEE_ID}`);
  }
});

test("GET /departments lists only active departments, id and name", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/profile/departments", TOKEN);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 2);
  assert.deepEqual(
    body.departments.map((row) => row.name),
    ["ฝ่ายบุคคล", "ฝ่ายขาย"]
  );
  for (const row of body.departments) assert.deepEqual(Object.keys(row).sort(), ["id", "name"]);
});

test("a non-editable field is refused with 400 and changes nothing", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const bodies = [
    { national_id: "1234567890123" },
    { employee_code: "EMP-99999" },
    { position: "ผู้จัดการ" },
    { position_id: POSITION_ID },
    { role: "hr" },
    { is_active: false },
  ];

  for (const body of bodies) {
    const response = await patch(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.message, "มีฟิลด์ที่ไม่สามารถแก้ไขได้");
  }

  assert.deepEqual(writes(fake), []);
  assert.deepEqual(fake.state.employees[0], EMPLOYEE);
  assert.deepEqual(auditRows(fake), []);
});

test("a department id that does not exist is refused", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await patch({ department_id: "99999999-9999-4999-8999-999999999999" });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.errors.department_id, "ไม่พบแผนกที่เลือก");
  assert.deepEqual(writes(fake), []);
  assert.equal(fake.state.employees[0].department_id, DEPT_ACTIVE);
});

test("a department id that is inactive is refused", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await patch({ department_id: DEPT_INACTIVE });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.errors.department_id, "แผนกที่เลือกปิดใช้งาน กรุณาเลือกแผนกที่ใช้งานอยู่");
  assert.deepEqual(writes(fake), []);
});

test("a department name is free text and is refused", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  for (const value of ["ฝ่ายขาย", "ฝ่ายขาย ", 42, ""]) {
    const response = await patch({ department_id: value });
    assert.equal(response.status, 400, String(value));
    const body = await response.json();
    assert.equal(body.errors.department_id, "ไม่พบแผนกที่เลือก");
  }

  assert.deepEqual(writes(fake), []);
});

test("a valid active department updates only that column and audits the change", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await patch({ department_id: DEPT_OTHER });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.changed, true);
  assert.equal(body.profile.departmentId, DEPT_OTHER);
  assert.equal(body.profile.departmentName, "ฝ่ายขาย");

  const employeeWrites = fake.calls.filter(
    (entry) => entry.method === "PATCH" && entry.table === "employees"
  );
  assert.equal(employeeWrites.length, 1);
  assert.deepEqual(JSON.parse(employeeWrites[0].body), { department_id: DEPT_OTHER });

  const row = fake.state.employees[0];
  assert.equal(row.department_id, DEPT_OTHER);
  assert.equal(row.full_name, EMPLOYEE.full_name);
  assert.equal(row.email, EMPLOYEE.email);
  assert.equal(row.phone, EMPLOYEE.phone);

  const audit = auditRows(fake);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "profile_department_changed");
  assert.equal(audit[0].detail, null);
  assert.equal(audit[0].entity, "employee");
  assert.equal(audit[0].entity_id, EMPLOYEE_ID);
  assert.equal(audit[0].actor_id, EMPLOYEE_ID);
  const auditText = JSON.stringify(audit[0]);
  for (const forbidden of ["ฝ่าย", "สมชาย", DEPT_ACTIVE, DEPT_OTHER]) {
    assert.equal(auditText.includes(forbidden), false, forbidden);
  }
});

test("a valid email and phone update only those columns", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await patch({ email: "somchai@example.com", phone: "081-234-5678" });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.changed, true);
  assert.equal(body.profile.email, "somchai@example.com");
  assert.equal(body.profile.phone, "0812345678");

  const employeeWrites = fake.calls.filter(
    (entry) => entry.method === "PATCH" && entry.table === "employees"
  );
  assert.equal(employeeWrites.length, 1);
  assert.deepEqual(JSON.parse(employeeWrites[0].body), {
    email: "somchai@example.com",
    phone: "0812345678",
  });

  const row = fake.state.employees[0];
  assert.equal(row.full_name, EMPLOYEE.full_name);
  assert.equal(row.department_id, DEPT_ACTIVE);

  const audit = auditRows(fake);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "profile_updated");
  assert.equal(audit[0].detail, null);
  assert.equal(JSON.stringify(audit[0]).includes("somchai"), false);
});

test("an invalid email is refused with a Thai message", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await patch({ email: "somchai@" });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.errors.email, "อีเมลไม่ถูกต้อง");
  assert.deepEqual(writes(fake), []);
});

test("an invalid phone is refused", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  // Ten digits starting with 0 is the rule the task sets, so only length and the
  // leading zero are checked here; a number that fails either is refused.
  for (const phone of ["123456789", "081234567890", "abcdefghij", "6812345678"]) {
    const response = await patch({ phone });
    assert.equal(response.status, 400, phone);
    assert.equal((await response.json()).errors.phone.includes("เบอร์มือถือ"), true);
  }

  // A mobile that is already correct passes.
  const ok = await patch({ phone: "0812345678" });
  assert.equal(ok.status, 200);
});

test("an identical value writes nothing and audits nothing", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await patch({ full_name: "  สมชาย   ทดสอบ " });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.changed, false);
  assert.deepEqual(writes(fake), []);
  assert.deepEqual(auditRows(fake), []);
});

test("an empty body is refused", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await patch({});
  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, "ไม่มีข้อมูลที่จะบันทึก");
  assert.deepEqual(writes(fake), []);
});

test("another role and an anonymous caller are refused", async (t) => {
  const hr = await createBackend({ role: "hr" });
  t.after(() => hr.restore());

  const forbidden = await call("/api/profile/me", TOKEN);
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).ok, false);
  assert.equal((await patch({ full_name: "อีก ชื่อ" })).status, 403);
  assert.deepEqual(writes(hr), []);

  const anonymous = await call("/api/profile/me", null);
  assert.equal(anonymous.status, 401);
});

test("GET /name-prefixes lists only active lookup values", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/profile/name-prefixes", TOKEN);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 3);
  assert.deepEqual([...body.prefixes].sort(), ["นาง", "นางสาว", "นาย"].sort());
  assert.equal(body.prefixes.includes("Mr."), false);
});

test("a prefix outside the active lookup is refused and writes nothing", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const unknown = await patch({ name_prefix: "ดร." });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).errors.name_prefix, "ไม่พบคำนำหน้าที่เลือก");

  // A row that exists but is switched off is not selectable either.
  const inactive = await patch({ name_prefix: "Mr." });
  assert.equal(inactive.status, 400);
  assert.equal((await inactive.json()).errors.name_prefix, "ไม่พบคำนำหน้าที่เลือก");

  const empty = await patch({ name_prefix: "  " });
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).errors.name_prefix, "กรุณาเลือกคำนำหน้า");

  assert.deepEqual(writes(fake), []);
  assert.deepEqual(auditRows(fake), []);
});

test("a valid prefix updates only name_prefix and writes profile_updated", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await patch({ name_prefix: "นาง" });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.changed, true);
  assert.equal(body.profile.namePrefix, "นาง");

  const employeeWrites = fake.calls.filter(
    (entry) => entry.method === "PATCH" && entry.table === "employees"
  );
  assert.equal(employeeWrites.length, 1);
  assert.deepEqual(JSON.parse(employeeWrites[0].body), { name_prefix: "นาง" });

  const row = fake.state.employees[0];
  assert.equal(row.name_prefix, "นาง");
  assert.equal(row.full_name, EMPLOYEE.full_name);

  const audit = auditRows(fake);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "profile_updated");
  assert.equal(audit[0].detail, null);
  assert.equal(JSON.stringify(audit[0]).includes("นาง"), false);
});

test("an employee with no position reports null and reads no position row", async (t) => {
  const fake = await createBackend({ employeeOverrides: { position_id: null } });
  t.after(() => fake.restore());

  const response = await call("/api/profile/me", TOKEN);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.profile.positionName, null);
  assert.equal(fake.calls.some((entry) => entry.table === "positions"), false);
});
