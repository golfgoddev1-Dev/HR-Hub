// The employee's own approval contacts. The employee id comes from the session
// only, grants must be active, and the response never carries employee code,
// email or national ID (the database is a fake fetch).
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const EMP_TOKEN = "e".repeat(43);
const HR_TOKEN = "h".repeat(43);

const EMP_ID = "11111111-1111-4111-8111-111111111111";
const HR_ID = "99999999-9999-4999-8999-999999999999";
const AP1_ID = "22222222-2222-4222-8222-222222222222";
const AP2_ID = "33333333-3333-4333-8333-333333333333";
const INACTIVE_AP_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_AP_ID = "66666666-6666-4666-8666-666666666666";
const SHIFT1_ID = "77777777-7777-4777-8777-777777777777";
const SHIFT2_ID = "88888888-8888-4888-8888-888888888888";

const DEPT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEPT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const POSITION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "offset", "or", "on_conflict"].includes(key)) continue;
    if (value.startsWith("eq.")) {
      if (String(row[key] ?? "") !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("in.(")) {
      const list = value.slice(4, -1).split(",");
      if (!list.includes(String(row[key] ?? ""))) return false;
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

  const person = (id, fullName, departmentId, overrides = {}) => ({
    id,
    employee_code: `CODE-${id.slice(0, 4)}`,
    name_prefix: "นาย",
    full_name: fullName,
    email: `${id.slice(0, 4)}@example.com`,
    phone: null,
    department_id: departmentId,
    position_id: POSITION_ID,
    is_active: true,
    ...overrides,
  });

  const state = {
    auth_sessions: [
      await session(EMP_TOKEN, EMP_ID, "employee"),
      await session(HR_TOKEN, HR_ID, "hr"),
    ],
    employees: [
      person(EMP_ID, "สมชาย ใจดี", DEPT_A, { phone: "0812345678" }),
      person(HR_ID, "หัวหน้า ฝ่ายบุคคล", DEPT_B, { phone: "0899999999" }),
      person(AP1_ID, "ประเสริฐ อนุมัติ", DEPT_A, { phone: "0822222222" }),
      person(AP2_ID, "มาลี ตรวจสอบ", DEPT_B),
      person(INACTIVE_AP_ID, "สมหมาย ปิดใช้งาน", DEPT_A),
      person(OTHER_ID, "พนักงาน คนอื่น", DEPT_B),
      person(OTHER_AP_ID, "ผู้อนุมัติ คนอื่น", DEPT_B),
      person(SHIFT1_ID, "วิชัย กะเช้า", DEPT_A),
      person(SHIFT2_ID, "อรทัย กะดึก", DEPT_A),
    ],
    employee_credentials: [],
    employee_approvers: [
      // AP1 is granted both by department and by name: still one card.
      { employee_id: EMP_ID, approver_id: AP1_ID, priority: 1, is_active: true },
      { employee_id: EMP_ID, approver_id: AP2_ID, priority: 2, is_active: true },
      { employee_id: EMP_ID, approver_id: INACTIVE_AP_ID, priority: 3, is_active: false },
      { employee_id: OTHER_ID, approver_id: OTHER_AP_ID, priority: 1, is_active: true },
    ],
    department_approvers: [
      { id: "grant-1", department_id: DEPT_A, employee_id: AP1_ID, priority: 1, is_active: true },
      { id: "grant-2", department_id: DEPT_A, employee_id: INACTIVE_AP_ID, priority: 2, is_active: false },
      { id: "grant-3", department_id: DEPT_B, employee_id: OTHER_AP_ID, priority: 1, is_active: true },
    ],
    department_shift_leads: [
      { id: "lead-1", department_id: DEPT_A, employee_id: SHIFT1_ID, shift_label: "กะเช้า" },
      { id: "lead-2", department_id: DEPT_A, employee_id: SHIFT2_ID, shift_label: "กะดึก" },
      { id: "lead-3", department_id: DEPT_B, employee_id: OTHER_ID, shift_label: "กะเช้า" },
    ],
    departments: [
      { id: DEPT_A, name: "ฝ่ายบุคคล" },
      { id: DEPT_B, name: "ฝ่ายขาย" },
    ],
    positions: [{ id: POSITION_ID, name: "เจ้าหน้าที่" }],
    hr_admins: [{ employee_id: HR_ID }],
    meeting_admins: [],
    system_admins: [],
    audit_logs: [],
  };

  const calls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop();
    const params = parsed.searchParams;
    calls.push({ url, method, table });

    if (method === "GET") {
      return jsonResponse((state[table] ?? []).filter((row) => matches(params, row)));
    }
    return new Response(null, { status: 204 });
  };

  return {
    state,
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function call(path, token = EMP_TOKEN) {
  const init = token ? { headers: { Cookie: `hr_session=${token}` } } : {};
  return app.request(`https://fake.local${path}`, init, ENV);
}

test("returns only the session employee's approvers and shift leads", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/profile/my-approvers?employeeId=" + OTHER_ID);
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.ok, true);
  assert.deepEqual(
    body.approvers.map((person) => `${person.firstName} ${person.lastName}`),
    ["ประเสริฐ อนุมัติ", "มาลี ตรวจสอบ"]
  );
  assert.deepEqual(
    body.shiftLeads.map((person) => `${person.firstName} ${person.lastName}`),
    ["วิชัย กะเช้า", "อรทัย กะดึก"]
  );

  // Inactive grants and another employee's approver are absent.
  const text = JSON.stringify(body);
  assert.equal(text.includes("ปิดใช้งาน"), false);
  assert.equal(text.includes("คนอื่น"), false);
});

test("returns exactly the contact fields, with a null phone and no identifiers", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const body = await (await call("/api/profile/my-approvers")).json();
  const all = [...body.approvers, ...body.shiftLeads];

  for (const person of all) {
    assert.deepEqual(Object.keys(person).sort(), [
      "departmentName",
      "firstName",
      "lastName",
      "phone",
      "positionName",
      "roleLabel",
    ]);
  }

  const ap2 = body.approvers.find((person) => person.firstName === "มาลี");
  assert.equal(ap2.phone, null);
  assert.equal(ap2.departmentName, "ฝ่ายขาย");
  assert.equal(ap2.positionName, "เจ้าหน้าที่");
  assert.equal(ap2.roleLabel, "ผู้อนุมัติ");
  assert.equal(body.shiftLeads[0].roleLabel, "หัวหน้ากะ");

  const text = JSON.stringify(body);
  for (const forbidden of ["employeeCode", "email", "nationalId", "@example.com", "CODE-"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test("an HR session sees only its own contacts, never the employee's", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await call("/api/profile/my-approvers", HR_TOKEN);
  assert.equal(response.status, 200);
  const body = await response.json();

  // HR sees its own department's approver and shift lead only; none of the
  // employee's approvers or department leads appear.
  assert.deepEqual(
    body.approvers.map((person) => `${person.firstName} ${person.lastName}`),
    ["ผู้อนุมัติ คนอื่น"]
  );
  assert.deepEqual(
    body.shiftLeads.map((person) => `${person.firstName} ${person.lastName}`),
    ["พนักงาน คนอื่น"]
  );
});
