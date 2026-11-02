import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const HR_TOKEN = "t".repeat(43);
const EMPLOYEE_TOKEN = "e".repeat(43);
const NOT_HR_TOKEN = "x".repeat(43);
const HR_ID = "44444444-4444-4444-8444-444444444444";
const NOT_HR_ID = "99999999-9999-4999-8999-999999999999";
const EMPLOYEE_ID = "55555555-5555-4555-8555-555555555555";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  NATIONAL_ID_PEPPER: "fake-national-pepper",
  NATIONAL_ID_ENC_KEY: "fake-encryption-key",
};

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

/** Reads the or=() search filter the route sends, as PostgREST would. */
function searchTerms(params) {
  const or = params.get("or");
  if (!or) return null;
  return or
    .replace(/^\(|\)$/g, "")
    .split(",")
    .map((clause) => {
      const [, , ...rest] = clause.split(".");
      return rest.join(".");
    });
}

function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "or"].includes(key)) continue;
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (String(row[key]) !== value.slice(3)) return false;
    }
  }
  return true;
}

function matchesSearch(params, row) {
  const terms = searchTerms(params);
  if (!terms) return true;
  const needle = terms[0].replace(/^%|%$/g, "").toLowerCase();
  const name = String(row.full_name ?? "").toLowerCase();
  const code = String(row.employee_code ?? "").toLowerCase();
  return name.includes(needle) || code.includes(needle);
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

/** 60 fake employees so the 50 row cap is observable. */
function buildEmployees() {
  const rows = [
    {
      id: "66666666-6666-4666-8666-666666666666",
      employee_code: "ABC-00101",
      name_prefix: "นาย",
      full_name: "สมชาย ทดสอบ",
      is_active: true,
      departments: { name: "ฝ่ายบุคคล" },
    },
    {
      id: "77777777-7777-4777-8777-777777777777",
      employee_code: "ABC-00102",
      name_prefix: "นาง",
      full_name: "สมหญิง ทดสอบ",
      is_active: false,
      departments: { name: "ฝ่ายขาย" },
    },
  ];
  for (let index = 0; index < 58; index += 1) {
    rows.push({
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      employee_code: `ZZZ-${String(index).padStart(5, "0")}`,
      name_prefix: null,
      full_name: `ทดสอบ พนักงาน ${index}`,
      is_active: true,
      departments: null,
    });
  }
  return rows;
}

/** The three session owners, so the session layer resolves a real employee. */
const SESSION_EMPLOYEES = [
  { id: HR_ID, employee_code: "HR001", name_prefix: null, full_name: "เจ้าหน้าที่ ระบบ", is_active: true, departments: null },
  { id: NOT_HR_ID, employee_code: "EMP-99999", name_prefix: null, full_name: "พนักงาน ระบบ", is_active: true, departments: null },
  { id: EMPLOYEE_ID, employee_code: "EMP-00001", name_prefix: null, full_name: "พนักงาน ระบบสอง", is_active: true, departments: null },
];

async function createFake(options = {}) {
  const now = new Date();
  const session = (token, employeeId, role, id) => ({
    id,
    token_hash: null,
    employee_id: employeeId,
    login_role: role,
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  });

  const hrSession = session(HR_TOKEN, HR_ID, "hr", "session-hr");
  hrSession.token_hash = await sha256Hex(HR_TOKEN);
  const employeeSession = session(EMPLOYEE_TOKEN, EMPLOYEE_ID, "employee", "session-emp");
  employeeSession.token_hash = await sha256Hex(EMPLOYEE_TOKEN);
  const notHrSession = session(NOT_HR_TOKEN, NOT_HR_ID, "hr", "session-not-hr");
  notHrSession.token_hash = await sha256Hex(NOT_HR_TOKEN);

  const state = {
    employees: [...(options.employees ?? buildEmployees()), ...SESSION_EMPLOYEES],
    hrAdmins: options.hrAdmins ?? [{ employee_id: HR_ID }],
  };

  const sessions = [hrSession, employeeSession, notHrSession];

  const fake = installFetch(({ url, method }) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    const table = parsed.pathname.split("/").pop();

    if (method === "GET") {
      if (table === "auth_sessions") {
        return jsonResponse(sessions.filter((row) => matches(params, row)));
      }
      if (table === "hr_admins") {
        return jsonResponse(state.hrAdmins.filter((row) => matches(params, row)));
      }
      if (table === "employees") {
        const limit = Number(params.get("limit"));
        const rows = state.employees
          .filter((row) => matches(params, row))
          .filter((row) => matchesSearch(params, row));
        return jsonResponse(Number.isFinite(limit) ? rows.slice(0, limit) : rows);
      }
      return jsonResponse([]);
    }

    if (method === "PATCH") return emptyResponse(204);
    return emptyResponse(201);
  });

  fake.state = state;
  return fake;
}

/** Calls that are the employee list itself, i.e. carry the or=() search. */
function listCalls(fake) {
  return fake.calls.filter((call) => {
    if (!call.url.includes("/rest/v1/employees")) return false;
    return new URL(call.url).searchParams.get("or") !== null;
  });
}

function makeEnv() {
  return {
    ...ENV,
    RL_CONTEXT_IP: makeLimiter(),
    RL_SUBMIT_IP: makeLimiter(),
    RL_SUBMIT_TOKEN: makeLimiter(),
  };
}

function request(input, init = {}, env = makeEnv()) {
  return app.request(input, init, env);
}

const LIST_URL = "https://fake.local/api/hr/employees";

test("HR searches employees by name without any national ID in the response", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request(`${LIST_URL}?q=${encodeURIComponent("สมชาย")}`, {
    headers: { Cookie: `hr_session=${HR_TOKEN}` },
  });
  const text = await response.text();
  const body = JSON.parse(text);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.count, 1);
  assert.equal(body.results[0].employeeCode, "ABC-00101");
  assert.equal(body.results[0].namePrefix, "นาย");
  assert.equal(body.results[0].fullName, "สมชาย ทดสอบ");
  assert.equal(body.results[0].departmentName, "ฝ่ายบุคคล");
  assert.equal(body.results[0].isActive, true);
  assert.match(body.results[0].id, /^[0-9a-f-]{36}$/);

  // No national ID, no credentials lookup at all.
  assert.equal(fake.calls.some((call) => call.url.includes("employee_credentials")), false);
  assert.equal(/national/i.test(text), false);
  assert.equal(/\d{13}/.test(text), false);
});

test("the search matches an employee code and reports the inactive status", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request(`${LIST_URL}?q=ABC-00102`, {
    headers: { Cookie: `hr_session=${HR_TOKEN}` },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 1);
  assert.equal(body.results[0].employeeCode, "ABC-00102");
  assert.equal(body.results[0].isActive, false);
});

test("a search shorter than two characters is refused before any employee read", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  for (const url of [LIST_URL, `${LIST_URL}?q=`, `${LIST_URL}?q=%20`, `${LIST_URL}?q=A`]) {
    const response = await request(url, { headers: { Cookie: `hr_session=${HR_TOKEN}` } });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
  }

  assert.equal(listCalls(fake).length, 0);
});

test("other roles and anonymous callers cannot list employees", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const asEmployee = await request(`${LIST_URL}?q=abc`, {
    headers: { Cookie: `hr_session=${EMPLOYEE_TOKEN}` },
  });
  assert.equal(asEmployee.status, 403);

  const anonymous = await request(`${LIST_URL}?q=abc`);
  assert.equal(anonymous.status, 401);

  assert.equal(listCalls(fake).length, 0);
});

test("an hr session that is no longer in hr_admins is refused", async (t) => {
  const fake = await createFake({ hrAdmins: [] });
  t.after(() => fake.restore());

  const response = await request(`${LIST_URL}?q=abc`, {
    headers: { Cookie: `hr_session=${HR_TOKEN}` },
  });
  assert.equal([401, 403].includes(response.status), true);
  assert.equal(listCalls(fake).length, 0);
});

test("the list is capped at 50 rows and asks the database for that limit", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request(`${LIST_URL}?q=${encodeURIComponent("ทดสอบ")}`, {
    headers: { Cookie: `hr_session=${HR_TOKEN}` },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.limit, 50);
  assert.equal(body.results.length, 50);

  const calls = listCalls(fake);
  assert.equal(calls.length, 1);
  const params = new URL(calls[0].url).searchParams;
  assert.equal(params.get("limit"), "50");
  assert.equal(params.get("order"), "employee_code.asc");
  assert.equal(params.get("select").includes("full_name"), true);
  assert.equal(params.get("select").includes("national"), false);
});
