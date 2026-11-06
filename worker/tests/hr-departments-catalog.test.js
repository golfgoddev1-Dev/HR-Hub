// The department picker on "ตั้งค่าผู้อนุมัติ" reads the HR directory catalog.
// It must offer only active departments to an HR caller, refuse everyone else,
// and keep the { id, name } shape the page binds to. The database is a fake
// fetch, so no row is read or written.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const HR_TOKEN = "h".repeat(43);
const EMPLOYEE_TOKEN = "e".repeat(43);

const HR_ID = "22222222-2222-4222-8222-222222222222";
const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const ACTIVE_DEPARTMENT_ID = "44444444-4444-4444-8444-444444444444";
const INACTIVE_DEPARTMENT_ID = "55555555-5555-4555-8555-555555555555";
const POSITION_ID = "66666666-6666-4666-8666-666666666666";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "offset", "or", "on_conflict"].includes(key)) continue;
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    const actual = row[key] === undefined || row[key] === null ? "" : String(row[key]);
    if (value.startsWith("eq.")) {
      if (actual !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("in.(")) {
      if (!value.slice(4, -1).split(",").includes(actual)) return false;
    }
  }
  return true;
}

async function createBackend() {
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
    auth_sessions: [
      await session(HR_TOKEN, HR_ID, "hr"),
      await session(EMPLOYEE_TOKEN, EMPLOYEE_ID, "employee"),
    ],
    employees: [
      {
        id: HR_ID,
        employee_code: "HR001",
        name_prefix: null,
        full_name: "เจ้าหน้าที่ ระบบ",
        department_id: null,
        position_id: null,
        is_active: true,
      },
      {
        id: EMPLOYEE_ID,
        employee_code: "EMP001",
        name_prefix: null,
        full_name: "พนักงาน ทดสอบ",
        department_id: ACTIVE_DEPARTMENT_ID,
        position_id: null,
        is_active: true,
      },
    ],
    hr_admins: [{ employee_id: HR_ID }],
    departments: [
      { id: ACTIVE_DEPARTMENT_ID, name: "ฝ่ายบุคคล", is_active: true },
      { id: INACTIVE_DEPARTMENT_ID, name: "ฝ่ายเก่า", is_active: false },
    ],
    positions: [{ id: POSITION_ID, name: "เจ้าหน้าที่" }],
    audit_logs: [],
  };

  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const table = url.pathname.split("/").pop();

    if (method === "GET") {
      const rows = (state[table] ?? []).filter((row) => matches(url.searchParams, row));
      return jsonResponse(rows);
    }
    return emptyResponse(method === "POST" ? 201 : 204);
  };

  return {
    state,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function call(path, token) {
  const init = token ? { headers: { Cookie: `hr_session=${token}` } } : {};
  return app.request(`https://fake.local${path}`, init, ENV);
}

test("an HR caller gets the active departments only", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/hr/directory/catalog", HR_TOKEN);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.departments, [{ id: ACTIVE_DEPARTMENT_ID, name: "ฝ่ายบุคคล" }]);
  // The inactive department is not offered as a choice.
  assert.equal(JSON.stringify(body).includes(INACTIVE_DEPARTMENT_ID), false);
  assert.equal(JSON.stringify(body).includes("ฝ่ายเก่า"), false);
});

test("a non-HR caller is refused with 403", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/hr/directory/catalog", EMPLOYEE_TOKEN);
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.ok, false);
  assert.equal(body.message, "ไม่มีสิทธิ์เข้าถึงส่วนนี้");
});

test("the department shape is the id and name the page binds to", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/hr/directory/catalog", HR_TOKEN);
  const body = await response.json();

  assert.equal(Array.isArray(body.departments), true);
  assert.equal(body.departments.length, 1);
  assert.deepEqual(Object.keys(body.departments[0]).sort(), ["id", "name"]);
  assert.equal(typeof body.departments[0].id, "string");
  assert.equal(typeof body.departments[0].name, "string");
});
