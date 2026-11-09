// HR shift-lead routes. The database is a fake fetch: nothing leaves the
// process. The list is replaced as a whole, so a request can never create a
// third lead, and the audit row carries a count only.

import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const HR_ID = "33333333-3333-4333-8333-333333333333";
const LEAD1_ID = "44444444-4444-4444-8444-444444444444";
const LEAD2_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_ID = "66666666-6666-4666-8666-666666666666";
const NOEMAIL_ID = "77777777-7777-4777-8777-777777777777";
const DEPT_ID = "88888888-8888-4888-8888-888888888888";
const OTHER_DEPT_ID = "99999999-9999-4999-8999-999999999999";

const HR_TOKEN = "h".repeat(43);
const EMPLOYEE_TOKEN = "e".repeat(43);

const LEAD_NAME = "สมชาย ใจดี";
const LEAD_EMAIL = "lead1@example.test";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

async function session(token, employeeId, role) {
  const now = new Date();
  return {
    id: `session-${role}`,
    token_hash: await sha256Hex(token),
    employee_id: employeeId,
    login_role: role,
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  };
}

async function buildState() {
  return {
    auth_sessions: [
      await session(HR_TOKEN, HR_ID, "hr"),
      await session(EMPLOYEE_TOKEN, LEAD1_ID, "employee"),
    ],
    employees: [
      {
        id: HR_ID,
        employee_code: "HR-001",
        name_prefix: "นาง",
        full_name: "เจ้าหน้าที่ HR",
        email: "hr@example.test",
        department_id: DEPT_ID,
        is_active: true,
      },
      {
        id: LEAD1_ID,
        employee_code: "EMP-001",
        name_prefix: "นาย",
        full_name: LEAD_NAME,
        email: LEAD_EMAIL,
        department_id: DEPT_ID,
        is_active: true,
      },
      {
        id: LEAD2_ID,
        employee_code: "EMP-002",
        name_prefix: "นาง",
        full_name: "หัวหน้า สอง",
        email: "lead2@example.test",
        department_id: DEPT_ID,
        is_active: true,
      },
      {
        id: OTHER_ID,
        employee_code: "EMP-003",
        name_prefix: "นาย",
        full_name: "คนละแผนก",
        email: "other@example.test",
        department_id: OTHER_DEPT_ID,
        is_active: true,
      },
      {
        id: NOEMAIL_ID,
        employee_code: "EMP-004",
        name_prefix: "นาย",
        full_name: "ไม่มีอีเมล",
        email: "",
        department_id: DEPT_ID,
        is_active: true,
      },
    ],
    hr_admins: [{ employee_id: HR_ID }],
    departments: [
      { id: DEPT_ID, name: "ฝ่ายบุคคล" },
      { id: OTHER_DEPT_ID, name: "ฝ่ายอื่น" },
    ],
    department_shift_leads: [
      {
        id: "shift-1",
        department_id: DEPT_ID,
        employee_id: LEAD1_ID,
        shift_label: "กะ A",
        created_at: "2026-11-01T00:00:00.000Z",
      },
    ],
    audit_logs: [],
  };
}

function matches(row, params) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;

    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value === "not.is.null") {
      if (row[key] === null || row[key] === undefined) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (String(row[key] ?? "") !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("in.(")) {
      const list = value.slice(4, -1).split(",");
      if (!list.includes(String(row[key] ?? ""))) return false;
      continue;
    }
    if (value.startsWith("lt.")) {
      if (!(String(row[key] ?? "") < value.slice(3))) return false;
      continue;
    }
  }
  return true;
}

function installFetch(state) {
  const original = globalThis.fetch;
  let sequence = 0;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop();
    const params = parsed.searchParams;
    const prefer = String(init.headers?.Prefer ?? "");

    if (method === "GET") {
      const rows = (state[table] ?? []).filter((row) => matches(row, params));
      return jsonResponse(rows);
    }

    if (method === "POST") {
      if (state.failInsert === table) {
        return jsonResponse({ code: "XX000", message: "secret failure" }, 500);
      }
      const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
      const rows = Array.isArray(body) ? body : [body];
      const inserted = rows.map((row) => {
        sequence += 1;
        const saved = { id: `${table}-${sequence}`, ...row };
        state[table] = state[table] ?? [];
        state[table].push(saved);
        return saved;
      });
      if (!prefer.includes("return=representation")) return emptyResponse(201);
      return jsonResponse(Array.isArray(body) ? inserted : inserted[0]);
    }

    if (method === "DELETE") {
      const rows = (state[table] ?? []).filter((row) => matches(row, params));
      state[table] = (state[table] ?? []).filter((row) => !rows.includes(row));
      if (!prefer.includes("return=representation")) return emptyResponse(204);
      return jsonResponse(rows.map((row) => ({ id: row.id })));
    }

    if (method === "PATCH") {
      const patch = typeof init.body === "string" ? JSON.parse(init.body) : {};
      const rows = (state[table] ?? []).filter((row) => matches(row, params));
      for (const row of rows) Object.assign(row, patch);
      if (!prefer.includes("return=representation")) return emptyResponse(204);
      return jsonResponse(rows.map((row) => ({ id: row.id })));
    }

    return emptyResponse(405);
  };

  return {
    restore() {
      globalThis.fetch = original;
    },
  };
}

async function setup(t) {
  const state = await buildState();
  const fake = installFetch(state);
  t.after(() => fake.restore());
  return { state, env: { ...ENV } };
}

function call(env, path, { token = null, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.Cookie = `hr_session=${token}`;
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return app.request(`https://fake.local${path}`, init, env);
}

const PATH = `/api/hr/departments/${DEPT_ID}/shift-leads`;

function put(env, leads, token = HR_TOKEN) {
  return call(env, PATH, { token, method: "PUT", body: { leads } });
}

test("GET returns the department's leads with name, code, label and email flag", async (t) => {
  const { env } = await setup(t);
  const response = await call(env, PATH, { token: HR_TOKEN });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.count, 1);
  assert.equal(body.max, 2);
  assert.equal(body.leads[0].employeeName, `นาย ${LEAD_NAME}`);
  assert.equal(body.leads[0].employeeCode, "EMP-001");
  assert.equal(body.leads[0].shiftLabel, "กะ A");
  assert.equal(body.leads[0].hasEmail, true);
  assert.equal(JSON.stringify(body).includes(LEAD_EMAIL), false);
});

test("PUT replaces the list with two leads and audits an id count only", async (t) => {
  const { state, env } = await setup(t);

  const response = await put(env, [
    { employeeId: LEAD1_ID, shiftLabel: "กะ A" },
    { employeeId: LEAD2_ID, shiftLabel: "กะ B" },
  ]);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  assert.deepEqual(
    body.leads.map((lead) => lead.shiftLabel),
    ["กะ A", "กะ B"]
  );
  assert.equal(state.department_shift_leads.length, 2);

  const audit = state.audit_logs.at(-1);
  assert.equal(audit.action, "hr_shift_leads_updated");
  assert.equal(audit.entity, "department");
  assert.equal(audit.entity_id, DEPT_ID);
  assert.deepEqual(JSON.parse(audit.detail), { departmentId: DEPT_ID, count: 2 });

  const auditText = JSON.stringify(audit);
  for (const forbidden of [LEAD_NAME, "หัวหน้า สอง", LEAD_EMAIL, "กะ A", "กะ B"]) {
    assert.equal(auditText.includes(forbidden), false, forbidden);
  }
});

test("PUT accepts an empty list and clears the department", async (t) => {
  const { state, env } = await setup(t);

  const response = await put(env, []);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 0);
  assert.equal(state.department_shift_leads.length, 0);
});

test("PUT refuses a third lead, a duplicate person and a duplicate label", async (t) => {
  const { env } = await setup(t);

  const third = await put(env, [
    { employeeId: LEAD1_ID, shiftLabel: "กะ A" },
    { employeeId: LEAD2_ID, shiftLabel: "กะ B" },
    { employeeId: HR_ID, shiftLabel: "กะ C" },
  ]);
  assert.equal(third.status, 400);
  assert.equal((await third.json()).code, "too_many");

  const samePerson = await put(env, [
    { employeeId: LEAD1_ID, shiftLabel: "กะ A" },
    { employeeId: LEAD1_ID, shiftLabel: "กะ B" },
  ]);
  assert.equal(samePerson.status, 400);
  assert.equal((await samePerson.json()).code, "duplicate_employee");

  const sameLabel = await put(env, [
    { employeeId: LEAD1_ID, shiftLabel: "กะ A" },
    { employeeId: LEAD2_ID, shiftLabel: "กะ a" },
  ]);
  assert.equal(sameLabel.status, 400);
  assert.equal((await sameLabel.json()).code, "duplicate_label");
});

test("PUT enforces the 30-character label after trimming", async (t) => {
  const { env } = await setup(t);

  const long = await put(env, [{ employeeId: LEAD1_ID, shiftLabel: "ก".repeat(31) }]);
  assert.equal(long.status, 400);
  assert.equal((await long.json()).code, "label_too_long");

  const blank = await put(env, [{ employeeId: LEAD1_ID, shiftLabel: "   " }]);
  assert.equal(blank.status, 400);
  assert.equal((await blank.json()).code, "label_required");

  const trimmed = await put(env, [{ employeeId: LEAD1_ID, shiftLabel: "  กะ A  " }]);
  assert.equal(trimmed.status, 200);
  assert.equal((await trimmed.json()).leads[0].shiftLabel, "กะ A");
});

test("PUT refuses an employee from another department or without an email", async (t) => {
  const { env } = await setup(t);

  const other = await put(env, [{ employeeId: OTHER_ID, shiftLabel: "กะ A" }]);
  assert.equal(other.status, 400);
  assert.equal((await other.json()).code, "employee_not_in_department");

  const noEmail = await put(env, [{ employeeId: NOEMAIL_ID, shiftLabel: "กะ A" }]);
  assert.equal(noEmail.status, 400);
  const body = await noEmail.json();
  assert.equal(body.code, "employee_no_email");
  assert.equal(body.message.includes("อีเมล"), true);
});

test("PUT refuses an employee that does not exist and a department that does not", async (t) => {
  const { env } = await setup(t);

  const missingPerson = await put(env, [
    { employeeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", shiftLabel: "กะ A" },
  ]);
  assert.equal(missingPerson.status, 400);
  assert.equal((await missingPerson.json()).code, "employee_not_found");

  const missingDepartment = await call(
    env,
    "/api/hr/departments/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/shift-leads",
    { token: HR_TOKEN }
  );
  assert.equal(missingDepartment.status, 404);
  assert.equal((await missingDepartment.json()).code, "department_not_found");
});

test("the routes need HR, not just a session", async (t) => {
  const { env } = await setup(t);

  const anonymous = await call(env, PATH);
  assert.equal(anonymous.status, 401);

  const employee = await call(env, PATH, { token: EMPLOYEE_TOKEN });
  assert.equal(employee.status, 403);

  const employeePut = await put(env, [], EMPLOYEE_TOKEN);
  assert.equal(employeePut.status, 403);
});

test("a failed write logs only the fixed code, never a name, email or label", async (t) => {
  const { state, env } = await setup(t);
  state.failInsert = "department_shift_leads";

  const captured = [];
  const original = console.error;
  console.error = (...args) => captured.push(args);
  t.after(() => {
    console.error = original;
  });

  const response = await put(env, [
    { employeeId: LEAD1_ID, shiftLabel: "กะ A" },
    { employeeId: LEAD2_ID, shiftLabel: "กะ B" },
  ]);
  assert.equal(response.status, 500);

  const text = JSON.stringify(captured);
  for (const forbidden of [LEAD_NAME, LEAD_EMAIL, "กะ A", "กะ B"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  assert.equal(text.includes("secret failure"), false);
});
