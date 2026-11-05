// /api/admin/permissions — search one employee and set the four flags.
//
// Every database call is a fake fetch, so no real row is written. The checks
// cover the role gate, the search validation and escaping, the strict body, the
// three 409 business rules, the audit row per changed flag (and the fact that it
// carries no flag value or personal data), and which table each flag writes.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const ADMIN_TOKEN = "a".repeat(43);
const HR_TOKEN = "h".repeat(43);
const MEETING_TOKEN = "m".repeat(43);
const EMPLOYEE_TOKEN = "e".repeat(43);

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const HR_ID = "33333333-3333-4333-8333-333333333333";
const MEETING_ID = "44444444-4444-4444-8444-444444444444";
const EMP_ID = "55555555-5555-4555-8555-555555555555";
const AX_ID = "66666666-6666-4666-8666-666666666666";
const INACTIVE_ID = "77777777-7777-4777-8777-777777777777";
const DEPARTMENT_ID = "88888888-8888-4888-8888-888888888888";

const NATIONAL_ID = "1234567890123";

const SEARCH_TOO_SHORT = "กรุณาพิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา";
const SELF_MESSAGE = "ไม่สามารถถอดสิทธิ์ผู้ดูแลระบบของตนเองได้";
const LAST_ADMIN_MESSAGE = "ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อยหนึ่งคน";
const INACTIVE_MESSAGE = "พนักงานที่ปิดใช้งานอยู่ไม่สามารถเพิ่มสิทธิ์ได้";

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
    if (["select", "order", "limit", "offset", "or", "on_conflict"].includes(key)) continue;
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
    return false;
  }
  return true;
}

function decodeLeaf(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ilike with the Worker's escaped pattern: \% and \_ are literal, % is any. */
function ilikeMatches(pattern, value) {
  let regex = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") {
      regex += escapeRegex(pattern[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (char === "%" || char === "*") {
      regex += ".*";
      continue;
    }
    if (char === "_") {
      regex += ".";
      continue;
    }
    regex += escapeRegex(char);
  }
  return new RegExp(`^${regex}$`, "iu").test(String(value ?? ""));
}

/** The or=(full_name.ilike...,employee_code.ilike...) filter of a search. */
function matchesOr(params, row) {
  const raw = params.get("or");
  if (!raw) return true;

  const inner = raw.replace(/^\(/, "").replace(/\)$/, "");
  return inner.split(",").some((clause) => {
    const first = clause.indexOf(".");
    const second = clause.indexOf(".", first + 1);
    const column = clause.slice(0, first);
    const pattern = decodeLeaf(clause.slice(second + 1));
    return ilikeMatches(pattern, row[column]);
  });
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

  const department = [{ name: "ส่วนกลาง" }];

  const state = {
    employees: [
      {
        id: ADMIN_ID,
        employee_code: "ADM001",
        full_name: "ผู้ดูแล ระบบ",
        department_id: DEPARTMENT_ID,
        is_active: true,
        departments: department,
      },
      {
        id: OTHER_ADMIN_ID,
        employee_code: "ADM002",
        full_name: "ผู้ดูแล สอง",
        department_id: DEPARTMENT_ID,
        is_active: true,
        departments: department,
      },
      {
        id: HR_ID,
        employee_code: "HR001",
        full_name: "เจ้าหน้าที่ HR",
        department_id: DEPARTMENT_ID,
        is_active: true,
        departments: department,
      },
      {
        id: MEETING_ID,
        employee_code: "MT001",
        full_name: "ผู้ดูแลประชุม",
        department_id: DEPARTMENT_ID,
        is_active: true,
        departments: department,
      },
      {
        id: EMP_ID,
        employee_code: "AB001",
        full_name: "A_B Tester",
        department_id: DEPARTMENT_ID,
        is_active: true,
        departments: department,
      },
      {
        id: AX_ID,
        employee_code: "AX002",
        full_name: "AXB Tester",
        department_id: DEPARTMENT_ID,
        is_active: true,
        departments: department,
      },
      {
        id: INACTIVE_ID,
        employee_code: "IN001",
        full_name: "ปิดใช้งาน ทดสอบ",
        department_id: DEPARTMENT_ID,
        is_active: false,
        departments: department,
      },
    ],
    employee_credentials: [
      { employee_id: EMP_ID, national_id_hash: "hash-only", national_id_enc: "enc-only" },
    ],
    hr_admins: [{ employee_id: HR_ID }],
    meeting_admins: [{ employee_id: MEETING_ID }],
    system_admins: [{ employee_id: ADMIN_ID }],
    employee_approvers: [],
    department_approvers: [],
    audit_logs: [],
    auth_sessions: [
      await session(ADMIN_TOKEN, ADMIN_ID, "system_admin"),
      await session(HR_TOKEN, HR_ID, "hr"),
      await session(MEETING_TOKEN, MEETING_ID, "meeting_controller"),
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
    const prefer = String(init.headers?.Prefer ?? "");
    calls.push({ url, method, table, params: params.toString(), body });

    if (method === "GET") {
      const rows = (state[table] ?? []).filter(
        (row) => matches(params, row) && matchesOr(params, row)
      );
      const limit = Number(params.get("limit"));
      const sliced = Number.isFinite(limit) && limit > 0 ? rows.slice(0, limit) : rows;
      return jsonResponse(sliced);
    }

    if (method === "PATCH") {
      const patch = body ?? {};
      const updated = [];
      for (const row of state[table] ?? []) {
        if (!matches(params, row)) continue;
        Object.assign(row, patch);
        updated.push({ ...row });
      }
      writes.push({ method, table, body: patch, filters: params.toString(), count: updated.length });
      return prefer.includes("return=representation")
        ? jsonResponse(updated)
        : new Response(null, { status: 204 });
    }

    if (method === "DELETE") {
      const kept = [];
      const removed = [];
      for (const row of state[table] ?? []) {
        if (matches(params, row)) removed.push(row);
        else kept.push(row);
      }
      state[table] = kept;
      writes.push({ method, table, body: null, filters: params.toString(), count: removed.length });
      return new Response(null, { status: 204 });
    }

    writes.push({ method, table, body });
    const rows = Array.isArray(body) ? body : [body];
    state[table] = [...(state[table] ?? []), ...rows];
    return jsonResponse(rows, 201);
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

function makeEnv() {
  return {
    SUPABASE_URL: "https://fake-project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  };
}

function request(path, { method = "GET", cookie = `hr_session=${ADMIN_TOKEN}`, body } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return app.request(`https://fake.local${path}`, init, makeEnv());
}

/** Writes other than the session last_active_at touch every request makes. */
function dataWrites(fake) {
  return fake.writes.filter((write) => write.table !== "auth_sessions");
}

function auditRows(fake) {
  return fake.writes.filter((write) => write.table === "audit_logs" && write.method === "POST");
}

const EMPLOYEE_FLAGS_BODY = {
  hrAdmin: false,
  meetingAdmin: false,
  systemAdmin: false,
  leaveApprover: false,
};

test("permission search answers 403 for every role except system_admin", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  for (const token of [HR_TOKEN, MEETING_TOKEN, EMPLOYEE_TOKEN]) {
    const response = await request("/api/admin/permissions/search?q=ทดสอบ", {
      cookie: `hr_session=${token}`,
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.ok, false);
    assert.equal(body.message, "ไม่มีสิทธิ์เข้าถึงส่วนนี้");
  }

  const anonymous = await request("/api/admin/permissions/search?q=ทดสอบ", { cookie: "" });
  assert.equal(anonymous.status, 401);

  assert.equal(dataWrites(fake).length, 0);
});

test("permission search rejects a query shorter than two characters", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const blank = await request("/api/admin/permissions/search", { body: undefined });
  assert.equal(blank.status, 400);
  assert.equal((await blank.json()).message, SEARCH_TOO_SHORT);

  const padded = await request("/api/admin/permissions/search?q=%20a%20");
  assert.equal(padded.status, 400);
  assert.equal((await padded.json()).message, SEARCH_TOO_SHORT);

  assert.equal(dataWrites(fake).length, 0);
});

test("permission search escapes wildcards and PostgREST filter characters", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  // A typed underscore is a literal underscore, not a single-character wildcard:
  // "A_B Tester" matches and "AXB Tester" does not.
  const literal = await request("/api/admin/permissions/search?q=a_b");
  const body = await literal.json();

  assert.equal(literal.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.results.map((row) => row.employeeCode), ["AB001"]);

  const underscoreCall = fake.calls.filter((call) => call.table === "employees").at(-1);
  assert.match(underscoreCall.url, /%5C_/);

  // Percent, comma, parenthesis and dot all reach the API as data.
  const tricky = await request(
    `/api/admin/permissions/search?q=${encodeURIComponent("%_(),.")}`
  );
  assert.equal(tricky.status, 200);

  const trickyCall = fake.calls.filter((call) => call.table === "employees").at(-1);
  assert.match(trickyCall.url, /%5C%25/);
  assert.match(trickyCall.url, /%5C_/);
  assert.match(trickyCall.url, /%28/);
  assert.match(trickyCall.url, /%29/);
  assert.match(trickyCall.url, /%2C/);
  assert.match(trickyCall.url, /%2E/);
});

test("permission search returns the four flags and no sensitive column", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request("/api/admin/permissions/search?q=ทดสอบ");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(body.limit, 20);
  assert.equal(body.count, body.results.length);
  assert.equal(body.results.length, 1);

  const inactive = body.results[0];
  assert.equal(inactive.id, INACTIVE_ID);
  assert.equal(inactive.isActive, false);
  assert.equal(inactive.departmentName, "ส่วนกลาง");
  assert.deepEqual(Object.keys(inactive).sort(), [
    "departmentName",
    "employeeCode",
    "flags",
    "fullName",
    "id",
    "isActive",
  ]);

  for (const row of body.results) {
    assert.deepEqual(Object.keys(row.flags).sort(), [
      "hrAdmin",
      "leaveApprover",
      "meetingAdmin",
      "systemAdmin",
    ]);
    for (const value of Object.values(row.flags)) assert.equal(typeof value, "boolean");
  }

  assert.equal(JSON.stringify(body).includes(NATIONAL_ID), false);
  assert.equal(JSON.stringify(body).includes("national_id"), false);
  // requireRole reads employee_credentials.must_change_pin through its PIN
  // gate; no call here may ask for a national ID column.
  assert.equal(fake.calls.some((call) => /national_id/i.test(call.url)), false);
});

test("a malformed or unknown employee id is refused", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const malformed = await request("/api/admin/permissions/not-a-uuid");
  assert.equal(malformed.status, 400);

  const unknown = await request("/api/admin/permissions/99999999-9999-4999-8999-999999999999");
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).message, "ไม่พบพนักงาน");
});

test("the PUT body must be exactly the four booleans", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const path = `/api/admin/permissions/${EMP_ID}`;

  const missing = await request(path, { method: "PUT", body: { hrAdmin: true } });
  assert.equal(missing.status, 400);

  const extra = await request(path, {
    method: "PUT",
    body: { ...EMPLOYEE_FLAGS_BODY, nickname: "x" },
  });
  assert.equal(extra.status, 400);

  const notBoolean = await request(path, {
    method: "PUT",
    body: { ...EMPLOYEE_FLAGS_BODY, hrAdmin: "true" },
  });
  assert.equal(notBoolean.status, 400);

  const otherType = await request(path, { method: "PUT", body: JSON.stringify(["x"]) });
  assert.equal(otherType.status, 400);

  // A JSON body without the JSON content type is not read at all.
  const wrongType = await app.request(
    `https://fake.local${path}`,
    {
      method: "PUT",
      headers: { Cookie: `hr_session=${ADMIN_TOKEN}` },
      body: JSON.stringify(EMPLOYEE_FLAGS_BODY),
    },
    makeEnv()
  );
  assert.equal(wrongType.status, 400);

  assert.equal(dataWrites(fake).length, 0);
});

test("the caller cannot remove their own system admin flag", async (t) => {
  const fake = await createFake({
    system_admins: [{ employee_id: ADMIN_ID }, { employee_id: OTHER_ADMIN_ID }],
  });
  t.after(() => fake.restore());

  const response = await request(`/api/admin/permissions/${ADMIN_ID}`, {
    method: "PUT",
    body: EMPLOYEE_FLAGS_BODY,
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.message, SELF_MESSAGE);
  assert.equal(dataWrites(fake).length, 0);
});

test("the last active system admin cannot be removed", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request(`/api/admin/permissions/${ADMIN_ID}`, {
    method: "PUT",
    body: EMPLOYEE_FLAGS_BODY,
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.message, LAST_ADMIN_MESSAGE);
  assert.equal(dataWrites(fake).length, 0);
});

test("an inactive employee cannot be granted any flag", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request(`/api/admin/permissions/${INACTIVE_ID}`, {
    method: "PUT",
    body: { ...EMPLOYEE_FLAGS_BODY, hrAdmin: true },
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.message, INACTIVE_MESSAGE);
  assert.equal(dataWrites(fake).length, 0);
});

test("one audit row per changed flag, carrying no flag value and no personal data", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request(`/api/admin/permissions/${EMP_ID}`, {
    method: "PUT",
    body: { ...EMPLOYEE_FLAGS_BODY, hrAdmin: true, leaveApprover: true },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.changed, true);
  assert.equal(body.employee.flags.hrAdmin, true);
  assert.equal(body.employee.flags.leaveApprover, true);

  const audits = auditRows(fake);
  assert.equal(audits.length, 2);
  assert.deepEqual(
    audits.map((row) => row.body.action),
    ["permission_granted", "permission_granted"]
  );
  assert.deepEqual(
    audits.map((row) => JSON.parse(row.body.detail).permission),
    ["hr_admin", "leave_approver"]
  );
  for (const row of audits) {
    assert.equal(row.body.entity, "permission");
    assert.equal(row.body.entity_id, EMP_ID);
    assert.equal(row.body.actor_id, ADMIN_ID);
    assert.deepEqual(Object.keys(JSON.parse(row.body.detail)).sort(), [
      "employeeId",
      "permission",
    ]);
    assert.equal(JSON.stringify(row.body).includes(NATIONAL_ID), false);
    assert.equal(JSON.stringify(row.body).includes("pin"), false);
  }
});

test("a grant and a revoke write the table each feature already uses", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const path = `/api/admin/permissions/${EMP_ID}`;

  const granted = await request(path, {
    method: "PUT",
    body: { ...EMPLOYEE_FLAGS_BODY, hrAdmin: true, leaveApprover: true },
  });
  assert.equal(granted.status, 200);

  const hrInsert = fake.writes.find(
    (write) => write.table === "hr_admins" && write.method === "POST"
  );
  assert.deepEqual(hrInsert.body, { employee_id: EMP_ID });

  const approverInsert = fake.writes.find(
    (write) => write.table === "department_approvers" && write.method === "POST"
  );
  assert.deepEqual(approverInsert.body, {
    department_id: DEPARTMENT_ID,
    employee_id: EMP_ID,
    priority: 100,
    is_active: true,
  });

  const revoked = await request(path, { method: "PUT", body: EMPLOYEE_FLAGS_BODY });
  assert.equal(revoked.status, 200);
  assert.equal((await revoked.json()).changed, true);

  const hrDelete = fake.writes.find(
    (write) => write.table === "hr_admins" && write.method === "DELETE"
  );
  assert.ok(hrDelete, "the hr_admins row is removed");
  assert.match(hrDelete.filters, new RegExp(`employee_id=eq\\.${EMP_ID}`));

  const personalPatch = fake.writes.find(
    (write) =>
      write.table === "employee_approvers" &&
      write.method === "PATCH" &&
      write.body.is_active === false
  );
  assert.ok(personalPatch, "personal approver rows are deactivated, never deleted");
  assert.match(personalPatch.filters, /approver_id=eq\./);

  const departmentPatch = fake.writes.find(
    (write) =>
      write.table === "department_approvers" &&
      write.method === "PATCH" &&
      write.body.is_active === false
  );
  assert.ok(departmentPatch, "department approver rows are deactivated, never deleted");
  assert.match(departmentPatch.filters, /is_active=eq\.true/);

  assert.equal(auditRows(fake).length, 4);
  assert.deepEqual(
    auditRows(fake).map((row) => row.body.action),
    [
      "permission_granted",
      "permission_granted",
      "permission_revoked",
      "permission_revoked",
    ]
  );
});

test("an unchanged save writes nothing", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request(`/api/admin/permissions/${EMP_ID}`, {
    method: "PUT",
    body: EMPLOYEE_FLAGS_BODY,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.changed, false);
  assert.equal(dataWrites(fake).length, 0);
});

test("system admin grants and revokes use system_admins, not another table", async (t) => {
  const fake = await createFake({
    system_admins: [{ employee_id: ADMIN_ID }, { employee_id: OTHER_ADMIN_ID }],
  });
  t.after(() => fake.restore());

  // OTHER_ADMIN_ID already holds the flag, so this asks for no change there.
  const noop = await request(`/api/admin/permissions/${OTHER_ADMIN_ID}`, {
    method: "PUT",
    body: { ...EMPLOYEE_FLAGS_BODY, systemAdmin: true },
  });
  assert.equal(noop.status, 200);
  assert.equal((await noop.json()).changed, false);

  // Revoking somebody else's flag is allowed while another admin remains.
  const revoked = await request(`/api/admin/permissions/${OTHER_ADMIN_ID}`, {
    method: "PUT",
    body: EMPLOYEE_FLAGS_BODY,
  });
  assert.equal(revoked.status, 200);

  const deleteRow = fake.writes.find(
    (write) => write.table === "system_admins" && write.method === "DELETE"
  );
  assert.ok(deleteRow);
  assert.match(deleteRow.filters, new RegExp(`employee_id=eq\\.${OTHER_ADMIN_ID}`));
});
