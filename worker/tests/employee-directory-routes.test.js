import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const HR_TOKEN = "h".repeat(43);
const CONTROLLER_TOKEN = "c".repeat(43);
const EMPLOYEE_TOKEN = "e".repeat(43);
const LONELY_CONTROLLER_TOKEN = "l".repeat(43);

const HR_ID = "44444444-4444-4444-8444-444444444444";
const CONTROLLER_ID = "55555555-5555-4555-8555-555555555555";
const EMPLOYEE_ID = "66666666-6666-4666-8666-666666666666";
const LONELY_ID = "77777777-7777-4777-8777-777777777777";
const TARGET_ID = "88888888-8888-4888-8888-888888888888";
const MISSING_ID = "99999999-9999-4999-8999-999999999999";

const DEPT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEPT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const POS_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const POS_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const HR_BASE = "https://fake.local/api/hr/directory";
const CONTROLLER_BASE = "https://fake.local/api/meeting/directory";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

function makeLimiter() {
  return {
    idFromName(key) {
      return `id:${key}`;
    },
    get() {
      return {
        async fetch() {
          return Response.json({ success: true });
        },
      };
    },
  };
}

function installFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input), init, method: init.method ?? "GET" };
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

/** Column filter matcher for the simple eq/neq/is/in filters db.js sends. */
function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "or", "on_conflict"].includes(key)) continue;
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (String(row[key]) !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("neq.")) {
      if (String(row[key]) === value.slice(4)) return false;
      continue;
    }
  }
  return true;
}

/** Reads the or=() search filter and matches it like PostgREST's ilike. */
function matchesSearch(params, row) {
  const or = params.get("or");
  if (!or) return true;
  const clauses = or.replace(/^\(|\)$/g, "").split(",");
  return clauses.some((clause) => {
    const parts = clause.split(".");
    const column = parts[0];
    // URLSearchParams has already decoded the value once.
    const needle = parts.slice(2).join(".").replace(/^%|%$/g, "").toLowerCase();
    return String(row[column] ?? "").toLowerCase().includes(needle);
  });
}

async function createFake(options = {}) {
  const now = new Date();
  const sessionRow = async (token, employeeId, role, id) => ({
    id,
    token_hash: await sha256Hex(token),
    employee_id: employeeId,
    login_role: role,
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  });

  const sessions = {
    [await sha256Hex(HR_TOKEN)]: { role: "hr", employeeId: HR_ID },
    [await sha256Hex(CONTROLLER_TOKEN)]: { role: "meeting_controller", employeeId: CONTROLLER_ID },
    [await sha256Hex(EMPLOYEE_TOKEN)]: { role: "employee", employeeId: EMPLOYEE_ID },
    [await sha256Hex(LONELY_CONTROLLER_TOKEN)]: {
      role: "meeting_controller",
      employeeId: LONELY_ID,
    },
  };

  const state = {
    sessions: [
      await sessionRow(HR_TOKEN, HR_ID, "hr", "session-hr"),
      await sessionRow(CONTROLLER_TOKEN, CONTROLLER_ID, "meeting_controller", "session-mc"),
      await sessionRow(EMPLOYEE_TOKEN, EMPLOYEE_ID, "employee", "session-emp"),
      await sessionRow(LONELY_CONTROLLER_TOKEN, LONELY_ID, "meeting_controller", "session-lonely"),
    ],
    employees: options.employees ?? [
      { id: HR_ID, employee_code: "HR001", full_name: "เจ้าหน้าที่ ระบบ", is_active: true },
      { id: CONTROLLER_ID, employee_code: "MC001", full_name: "หัวหน้า คุมประชุม", is_active: true },
      { id: EMPLOYEE_ID, employee_code: "EMP-00001", full_name: "พนักงาน ทั่วไป", is_active: true },
      { id: LONELY_ID, employee_code: "MC-99999", full_name: "หัวหน้า ไม่มีสิทธิ์", is_active: true },
      {
        id: TARGET_ID,
        employee_code: "ABC-00101",
        name_prefix: "นาย",
        full_name: "สมชาย ทดสอบ",
        is_active: true,
        department_id: DEPT_A,
        position_id: POS_A,
      },
    ],
    departments: [
      { id: DEPT_A, name: "ฝ่ายบุคคล" },
      { id: DEPT_B, name: "ฝ่ายขาย" },
    ],
    positions: [
      { id: POS_A, name: "เจ้าหน้าที่" },
      { id: POS_B, name: "หัวหน้างาน" },
    ],
    adminRows: {
      hr: [{ employee_id: HR_ID }],
      meeting_controller: options.controllerActive === false ? [] : [{ employee_id: CONTROLLER_ID }],
      employee: [],
    },
    audit: [],
    lonelyMeetingReads: 0,
  };

  state.lastSession = null;

  const withEmbeds = (row) => {
    const department = state.departments.find((item) => item.id === row.department_id) ?? null;
    const position = state.positions.find((item) => item.id === row.position_id) ?? null;
    return {
      ...row,
      departments: department ? { name: department.name } : null,
      positions: position ? { name: position.name } : null,
    };
  };

  const fake = installFetch(({ url, init, method }) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    const table = parsed.pathname.split("/").pop();
    const isRoleTable = ["hr_admins", "meeting_admins", "system_admins"].includes(table);

    if (method === "GET") {
      if (table === "auth_sessions") {
        const hash = params.get("token_hash");
        const tokenHash = hash ? decodeURIComponent(hash.replace(/^eq\./, "")) : null;
        const session = sessions[tokenHash] ?? null;
        state.lastSession = session;
        const rows = state.sessions.filter((row) => matches(params, row));
        return jsonResponse(rows);
      }

      if (isRoleTable) {
        const session = state.lastSession;
        const roleTable = {
          hr: "hr_admins",
          meeting_controller: "meeting_admins",
          employee: null,
        }[session?.role ?? ""];
        if (roleTable !== table) return jsonResponse([]);

        // readSession reads the table once to validate the session, then the
        // route re-reads it. The lonely controller is served only in the
        // session wave, so the session stays valid while the route check fails.
        if (session?.employeeId === LONELY_ID && table === "meeting_admins") {
          state.lonelyMeetingReads += 1;
          return jsonResponse(state.lonelyMeetingReads % 2 === 1 ? [{ employee_id: LONELY_ID }] : []);
        }

        const rows = state.adminRows[session.role] ?? [];
        return jsonResponse(rows.filter((row) => matches(params, row)));
      }

      if (table === "employees") {
        const limit = Number(params.get("limit"));
        const rows = state.employees
          .filter((row) => matches(params, row))
          .filter((row) => matchesSearch(params, row))
          .map(withEmbeds);
        return jsonResponse(Number.isFinite(limit) ? rows.slice(0, limit) : rows);
      }

      if (table === "departments") {
        return jsonResponse(state.departments.filter((row) => matches(params, row)));
      }

      if (table === "positions") {
        return jsonResponse(state.positions.filter((row) => matches(params, row)));
      }

      if (table === "leave_requests") return jsonResponse([]);

      return jsonResponse([]);
    }

    if (method === "PATCH") {
      const list = table === "departments" ? state.departments : table === "positions" ? state.positions : state.employees;
      const patch = init.body ? JSON.parse(init.body) : {};
      const touched = [];
      for (const row of list) {
        if (!matches(params, row)) continue;
        Object.assign(row, patch);
        touched.push(row);
      }
      const prefer = String(init.headers?.Prefer ?? "");
      if (prefer.includes("return=representation")) return jsonResponse(touched);
      return emptyResponse(204);
    }

    if (method === "POST" && table === "audit_logs") {
      const body = init.body ? JSON.parse(init.body) : null;
      const rows = Array.isArray(body) ? body : [body];
      state.audit.push(...rows);
      return emptyResponse(201);
    }

    return emptyResponse(201);
  });

  fake.state = state;
  return fake;
}

function makeEnv() {
  return {
    ...ENV,
    RL_CONTEXT_IP: makeLimiter(),
    RL_SUBMIT_IP: makeLimiter(),
    RL_SUBMIT_TOKEN: makeLimiter(),
  };
}

function request(input, init = {}) {
  return app.request(input, init, makeEnv());
}

function cookie(token) {
  return { Cookie: `hr_session=${token}` };
}

function patchJson(url, body, token) {
  return request(url, {
    method: "PATCH",
    headers: { ...cookie(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function searchUrl(base, term) {
  return `${base}/employees?q=${encodeURIComponent(term)}`;
}

// --- search ----------------------------------------------------------------

test("HR searches an employee and sees department and position, with no ID card data", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request(searchUrl(HR_BASE, "สมชาย"), { headers: cookie(HR_TOKEN) });
  const text = await response.text();
  const body = JSON.parse(text);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.limit, 50);
  assert.equal(body.count, 1);
  assert.equal(body.results[0].employeeCode, "ABC-00101");
  assert.equal(body.results[0].departmentName, "ฝ่ายบุคคล");
  assert.equal(body.results[0].positionName, "เจ้าหน้าที่");
  assert.equal(/national/i.test(text), false);
  assert.equal(/\d{13}/.test(text), false);
  assert.equal(fake.calls.some((call) => call.url.includes("employee_credentials")), false);
});

test("the meeting controller reaches the same search through its own prefix", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request(searchUrl(CONTROLLER_BASE, "ABC-00101"), {
    headers: cookie(CONTROLLER_TOKEN),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 1);
  assert.equal(body.results[0].fullName, "สมชาย ทดสอบ");
});

test("a search shorter than two characters is refused before any employee read", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  for (const url of [`${HR_BASE}/employees`, `${HR_BASE}/employees?q=A`, `${HR_BASE}/employees?q=%20`]) {
    const response = await request(url, { headers: cookie(HR_TOKEN) });
    assert.equal(response.status, 400);
  }

  const employeeCalls = fake.calls.filter(
    (call) => call.url.includes("/rest/v1/employees") && new URL(call.url).searchParams.get("or")
  );
  assert.equal(employeeCalls.length, 0);
});

test("other roles, anonymous callers and revoked admins are refused", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const asEmployee = await request(searchUrl(HR_BASE, "สมชาย"), {
    headers: cookie(EMPLOYEE_TOKEN),
  });
  assert.equal(asEmployee.status, 403);

  const anonymous = await request(searchUrl(HR_BASE, "สมชาย"));
  assert.equal(anonymous.status, 401);

  // A valid meeting_controller session is still the wrong role for the HR prefix.
  const controllerOnHr = await request(searchUrl(HR_BASE, "สมชาย"), {
    headers: cookie(CONTROLLER_TOKEN),
  });
  assert.equal(controllerOnHr.status, 403);

  // Same role on the right prefix, but no longer in meeting_admins.
  const removedAdmin = await request(searchUrl(CONTROLLER_BASE, "สมชาย"), {
    headers: cookie(LONELY_CONTROLLER_TOKEN),
  });
  assert.equal(removedAdmin.status, 403);

  const hrOnController = await request(searchUrl(CONTROLLER_BASE, "สมชาย"), {
    headers: cookie(HR_TOKEN),
  });
  assert.equal(hrOnController.status, 403);
});

test("the catalog lists departments and positions for both roles", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  for (const [base, token] of [
    [HR_BASE, HR_TOKEN],
    [CONTROLLER_BASE, CONTROLLER_TOKEN],
  ]) {
    const response = await request(`${base}/catalog`, { headers: cookie(token) });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.departments.length, 2);
    assert.equal(body.positions.length, 2);
    assert.equal(body.departments[0].name, "ฝ่ายบุคคล");
  }
});

// --- employee update -------------------------------------------------------

test("changing an employee writes department_id and position_id only, with names in the audit", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await patchJson(
    `${HR_BASE}/employees/${TARGET_ID}`,
    { departmentId: DEPT_B, positionId: POS_B },
    HR_TOKEN
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.changed, true);
  assert.equal(body.employee.departmentName, "ฝ่ายขาย");
  assert.equal(body.employee.positionName, "หัวหน้างาน");

  const patches = fake.calls.filter((call) => call.method === "PATCH" && call.url.includes("/rest/v1/employees"));
  assert.equal(patches.length, 1);
  assert.deepEqual(JSON.parse(patches[0].init.body), {
    department_id: DEPT_B,
    position_id: POS_B,
  });

  assert.equal(fake.state.audit.length, 2);
  const departmentAudit = fake.state.audit.find((row) => row.action === "employee_department_changed");
  const positionAudit = fake.state.audit.find((row) => row.action === "employee_position_changed");
  assert.equal(departmentAudit.actor_id, HR_ID);
  assert.equal(departmentAudit.entity, "employee");
  assert.equal(departmentAudit.entity_id, TARGET_ID);
  assert.deepEqual(JSON.parse(departmentAudit.detail), {
    before: { departmentName: "ฝ่ายบุคคล" },
    after: { departmentName: "ฝ่ายขาย" },
  });
  assert.deepEqual(JSON.parse(positionAudit.detail), {
    before: { positionName: "เจ้าหน้าที่" },
    after: { positionName: "หัวหน้างาน" },
  });

  const auditText = JSON.stringify(fake.state.audit);
  assert.equal(/national/i.test(auditText), false);
  assert.equal(/\d{13}/.test(auditText), false);
  assert.equal(auditText.includes(DEPT_B), false);
});

test("an empty position is accepted and stored as null", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await patchJson(
    `${CONTROLLER_BASE}/employees/${TARGET_ID}`,
    { departmentId: DEPT_A, positionId: null },
    CONTROLLER_TOKEN
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.changed, true);
  assert.equal(body.employee.positionId, null);

  const patches = fake.calls.filter((call) => call.method === "PATCH" && call.url.includes("/rest/v1/employees"));
  assert.deepEqual(JSON.parse(patches[0].init.body), { position_id: null });
  assert.equal(fake.state.audit.length, 1);
  assert.equal(fake.state.audit[0].action, "employee_position_changed");
  assert.equal(JSON.parse(fake.state.audit[0].detail).after.positionName, null);
});

test("repeating the same employee change writes nothing a second time", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const payload = { departmentId: DEPT_B, positionId: POS_A };
  const first = await patchJson(`${HR_BASE}/employees/${TARGET_ID}`, payload, HR_TOKEN);
  assert.equal(first.status, 200);
  const auditAfterFirst = fake.state.audit.length;
  assert.equal(auditAfterFirst, 1);

  const second = await patchJson(`${HR_BASE}/employees/${TARGET_ID}`, payload, HR_TOKEN);
  const body = await second.json();
  assert.equal(second.status, 200);
  assert.equal(body.changed, false);
  assert.equal(fake.state.audit.length, auditAfterFirst);
  assert.equal(
    fake.calls.filter((call) => call.method === "PATCH" && call.url.includes("/rest/v1/employees")).length,
    1
  );
});

test("an unknown employee, an unknown department and a malformed body are refused", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const missing = await patchJson(
    `${HR_BASE}/employees/${MISSING_ID}`,
    { departmentId: DEPT_A, positionId: null },
    HR_TOKEN
  );
  assert.equal(missing.status, 404);

  const badDepartment = await patchJson(
    `${HR_BASE}/employees/${TARGET_ID}`,
    { departmentId: MISSING_ID, positionId: null },
    HR_TOKEN
  );
  assert.equal(badDepartment.status, 400);

  const extraKey = await patchJson(
    `${HR_BASE}/employees/${TARGET_ID}`,
    { departmentId: DEPT_A, positionId: null, pin: "123456" },
    HR_TOKEN
  );
  assert.equal(extraKey.status, 400);

  const badUuid = await patchJson(
    `${HR_BASE}/employees/not-a-uuid`,
    { departmentId: DEPT_A, positionId: null },
    HR_TOKEN
  );
  assert.equal(badUuid.status, 400);

  assert.equal(fake.state.audit.length, 0);
  assert.equal(
    fake.calls.filter((call) => call.method === "PATCH" && call.url.includes("/rest/v1/employees")).length,
    0
  );
});

// --- renames ---------------------------------------------------------------

test("renaming a department keeps the id, trims the name and records one audit row", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await patchJson(
    `${HR_BASE}/departments/${DEPT_A}`,
    { name: "  ฝ่ายทรัพยากรบุคคล  " },
    HR_TOKEN
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.item.id, DEPT_A);
  assert.equal(body.item.name, "ฝ่ายทรัพยากรบุคคล");

  const patches = fake.calls.filter((call) => call.method === "PATCH" && call.url.includes("/rest/v1/departments"));
  assert.equal(patches.length, 1);
  assert.deepEqual(JSON.parse(patches[0].init.body), { name: "ฝ่ายทรัพยากรบุคคล" });

  assert.equal(fake.state.audit.length, 1);
  assert.equal(fake.state.audit[0].action, "department_renamed");
  assert.equal(fake.state.audit[0].entity, "department");
  assert.equal(fake.state.audit[0].entity_id, DEPT_A);
  assert.deepEqual(JSON.parse(fake.state.audit[0].detail), {
    before: { name: "ฝ่ายบุคคล" },
    after: { name: "ฝ่ายทรัพยากรบุคคล" },
  });
});

test("a duplicate department or position name is refused with a readable message", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const department = await patchJson(`${HR_BASE}/departments/${DEPT_A}`, { name: "ฝ่ายขาย" }, HR_TOKEN);
  const departmentBody = await department.json();
  assert.equal(department.status, 409);
  assert.equal(departmentBody.message, "ชื่อนี้มีอยู่แล้ว กรุณาใช้ชื่ออื่น");

  const position = await patchJson(
    `${CONTROLLER_BASE}/positions/${POS_A}`,
    { name: "หัวหน้างาน" },
    CONTROLLER_TOKEN
  );
  assert.equal(position.status, 409);

  assert.equal(fake.state.audit.length, 0);
  assert.equal(
    fake.calls.filter((call) => call.method === "PATCH" && /\/rest\/v1\/(departments|positions)/.test(call.url)).length,
    0
  );
});

test("an empty, over-long or unchanged name is handled before any write", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const empty = await patchJson(`${HR_BASE}/departments/${DEPT_A}`, { name: "   " }, HR_TOKEN);
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).message, "กรุณากรอกชื่อใหม่");

  const tooLong = await patchJson(
    `${HR_BASE}/positions/${POS_A}`,
    { name: "ก".repeat(101) },
    HR_TOKEN
  );
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).message, "ชื่อยาวเกิน 100 ตัวอักษร");

  const unchanged = await patchJson(`${HR_BASE}/departments/${DEPT_A}`, { name: "ฝ่ายบุคคล" }, HR_TOKEN);
  const unchangedBody = await unchanged.json();
  assert.equal(unchanged.status, 200);
  assert.equal(unchangedBody.changed, false);

  const missing = await patchJson(`${HR_BASE}/departments/${MISSING_ID}`, { name: "ใหม่" }, HR_TOKEN);
  assert.equal(missing.status, 404);

  assert.equal(fake.state.audit.length, 0);
  assert.equal(
    fake.calls.filter((call) => call.method === "PATCH" && /\/rest\/v1\/(departments|positions)/.test(call.url)).length,
    0
  );
});

test("a position rename by the meeting controller is audited with names only", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await patchJson(
    `${CONTROLLER_BASE}/positions/${POS_B}`,
    { name: "หัวหน้าทีม" },
    CONTROLLER_TOKEN
  );

  assert.equal(response.status, 200);
  assert.equal(fake.state.audit.length, 1);
  assert.equal(fake.state.audit[0].action, "position_renamed");
  assert.equal(fake.state.audit[0].actor_id, CONTROLLER_ID);
  assert.equal(fake.state.audit[0].entity, "position");
  assert.deepEqual(JSON.parse(fake.state.audit[0].detail), {
    before: { name: "หัวหน้างาน" },
    after: { name: "หัวหน้าทีม" },
  });

  const auditText = JSON.stringify(fake.state.audit);
  assert.equal(/\d{13}/.test(auditText), false);
  assert.equal(/national/i.test(auditText), false);
});

test("renames are refused for callers without the right role", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const asEmployee = await patchJson(
    `${HR_BASE}/departments/${DEPT_A}`,
    { name: "ชื่อใหม่" },
    EMPLOYEE_TOKEN
  );
  assert.equal(asEmployee.status, 403);

  const anonymous = await request(`${HR_BASE}/departments/${DEPT_A}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "ชื่อใหม่" }),
  });
  assert.equal(anonymous.status, 401);

  assert.equal(fake.state.audit.length, 0);
  assert.equal(fake.state.departments[0].name, "ฝ่ายบุคคล");
});
