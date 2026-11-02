import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { hmacSha256Hex, sha256Hex } from "../src/crypto.js";
import { encryptNationalId } from "../src/import/national-id-crypto.js";

const TOKEN = "t".repeat(43);
const EMPLOYEE_TOKEN = "e".repeat(43);
const OTHER_TOKEN = "o".repeat(43);
const HR_ID = "44444444-4444-4444-8444-444444444444";
const EMPLOYEE_ID = "55555555-5555-4555-8555-555555555555";
const TARGET_ID = "66666666-6666-4666-8666-666666666666";
const LEGACY_ID = "77777777-7777-4777-8777-777777777777";
const UNKNOWN_ID = "88888888-8888-4888-8888-888888888888";

const PEPPER = "fake-national-pepper";
const ENC_KEY = "fake-encryption-key";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  NATIONAL_ID_PEPPER: PEPPER,
  NATIONAL_ID_ENC_KEY: ENC_KEY,
};

function withCheckDigit(first12) {
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(first12[index]) * (13 - index);
  }
  return `${first12}${(11 - (sum % 11)) % 10}`;
}

const TARGET_NATIONAL_ID = withCheckDigit("110170020011");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

function makeLimiter({ success = true } = {}) {
  return {
    idFromName(key) {
      return `id:${key}`;
    },
    get() {
      return {
        async fetch() {
          return Response.json({ success });
        },
      };
    },
  };
}

function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit"].includes(key)) continue;
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

async function createFake(options = {}) {
  const now = new Date();
  const encrypted = await encryptNationalId(ENC_KEY, TARGET_NATIONAL_ID);

  const state = {
    session: {
      id: "session-1",
      token_hash: await sha256Hex(TOKEN),
      employee_id: HR_ID,
      login_role: "hr",
      revoked_at: null,
      last_active_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
    },
    employeeSession: {
      id: "session-2",
      token_hash: await sha256Hex(EMPLOYEE_TOKEN),
      employee_id: EMPLOYEE_ID,
      login_role: "employee",
      revoked_at: null,
      last_active_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
    },
    otherSession: {
      id: "session-3",
      token_hash: await sha256Hex(OTHER_TOKEN),
      employee_id: EMPLOYEE_ID,
      login_role: "employee",
      revoked_at: null,
      last_active_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
    },
    employees: [
      { id: HR_ID, employee_code: "HR001", full_name: "เจ้าหน้าที่ ทดสอบ", is_active: true },
      { id: EMPLOYEE_ID, employee_code: "EMP-99999", full_name: "พนักงาน ทดสอบ", is_active: true },
      {
        id: TARGET_ID,
        employee_code: "ABC-00220",
        full_name: "นาย สมชาย ทดสอบ",
        name_prefix: "นาย",
        is_active: true,
        departments: { name: "ฝ่ายบุคคล" },
        positions: { name: "เจ้าหน้าที่" },
      },
      {
        id: LEGACY_ID,
        employee_code: "ABC-00221",
        full_name: "นาง สมหญิง ทดสอบ",
        name_prefix: "นาง",
        is_active: true,
        departments: { name: "ฝ่ายขาย" },
        positions: { name: "เจ้าหน้าที่" },
      },
    ],
    credentials: [
      {
        employee_id: TARGET_ID,
        national_id_hash: await hmacSha256Hex(PEPPER, TARGET_NATIONAL_ID),
        national_id_enc: encrypted,
      },
      {
        employee_id: LEGACY_ID,
        national_id_hash: "a".repeat(64),
        national_id_enc: "legacy-value-encrypted-with-an-old-key",
      },
    ],
    rpcCalls: [],
    failRpc: options.failRpc === true,
  };

  const sessions = [state.session, state.employeeSession, state.otherSession];

  const fake = installFetch(({ url, init, method }) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;

    if (parsed.pathname.startsWith("/rest/v1/rpc/")) {
      state.rpcCalls.push({
        name: parsed.pathname.split("/").pop(),
        body: init.body ? JSON.parse(init.body) : {},
      });
      if (state.failRpc) return jsonResponse({ code: "XX000" }, 500);
      return jsonResponse(1);
    }

    const table = parsed.pathname.split("/").pop();

    if (method === "GET") {
      if (table === "auth_sessions") return jsonResponse(sessions.filter((row) => matches(params, row)));
      if (table === "employees") return jsonResponse(state.employees.filter((row) => matches(params, row)));
      if (table === "employee_credentials") {
        return jsonResponse(state.credentials.filter((row) => matches(params, row)));
      }
      if (table === "hr_admins") {
        return jsonResponse([{ employee_id: HR_ID }].filter((row) => matches(params, row)));
      }
      return jsonResponse([]);
    }

    if (method === "PATCH") return emptyResponse(204);
    return emptyResponse(201);
  });

  fake.state = state;
  return fake;
}

function makeEnv(overrides = {}) {
  return {
    ...ENV,
    RL_CONTEXT_IP: makeLimiter(),
    RL_SUBMIT_IP: makeLimiter(),
    RL_SUBMIT_TOKEN: makeLimiter(),
    ...overrides,
  };
}

/** Calls the Hono app with the test bindings attached. */
const appRequest = (input, init, env) => app.request(input, init, env);
function request(input, init = {}, env = makeEnv()) {
  return appRequest(input, init, env);
}

test("HR sees only the last four digits by default", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request(`https://fake.local/api/hr/employees/${TARGET_ID}`, {
    headers: { Cookie: `hr_session=${TOKEN}` },
  });
  const text = await response.text();
  const body = JSON.parse(text);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.employee.employeeCode, "ABC-00220");
  assert.equal(body.employee.namePrefix, "นาย");
  assert.equal(body.employee.departmentName, "ฝ่ายบุคคล");
  assert.equal(body.employee.nationalIdAvailable, true);
  assert.match(body.employee.nationalIdMasked, /^•{9}\d{4}$/);
  assert.equal(text.includes(TARGET_NATIONAL_ID), false);
  assert.equal(/\d{13}/.test(text), false);
});

test("a legacy encrypted value is reported as unavailable, not decrypted", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request(`https://fake.local/api/hr/employees/${LEGACY_ID}`, {
    headers: { Cookie: `hr_session=${TOKEN}` },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.employee.nationalIdMasked, null);
  assert.equal(body.employee.nationalIdAvailable, false);
});

test("non-HR roles cannot read an employee or reveal an ID", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const readAsEmployee = await request(`https://fake.local/api/hr/employees/${TARGET_ID}`, {
    headers: { Cookie: `hr_session=${EMPLOYEE_TOKEN}` },
  });
  assert.equal(readAsEmployee.status, 403);

  const revealAsEmployee = await request(
    `https://fake.local/api/hr/employees/${TARGET_ID}/reveal-national-id`,
    { method: "POST", headers: { Cookie: `hr_session=${EMPLOYEE_TOKEN}` } }
  );
  assert.equal(revealAsEmployee.status, 403);
  assert.equal(fake.state.rpcCalls.length, 0);
});

test("anonymous requests are rejected and unknown ids answer 404", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const anonymous = await request(`https://fake.local/api/hr/employees/${TARGET_ID}`);
  assert.equal(anonymous.status, 401);

  const unknown = await request(`https://fake.local/api/hr/employees/${UNKNOWN_ID}`, {
    headers: { Cookie: `hr_session=${TOKEN}` },
  });
  assert.equal(unknown.status, 404);

  const malformed = await request("https://fake.local/api/hr/employees/not-a-uuid", {
    headers: { Cookie: `hr_session=${TOKEN}` },
  });
  assert.equal(malformed.status, 400);
});

test("reveal returns the full ID and counts one view for the day", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const first = await request(
    `https://fake.local/api/hr/employees/${TARGET_ID}/reveal-national-id`,
    { method: "POST", headers: { Cookie: `hr_session=${TOKEN}` } }
  );
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.ok, true);
  assert.equal(firstBody.nationalId, TARGET_NATIONAL_ID);

  assert.equal(fake.state.rpcCalls.length, 1);
  assert.equal(fake.state.rpcCalls[0].name, "increment_national_id_view");
  assert.equal(fake.state.rpcCalls[0].body.p_viewer, HR_ID);
  assert.match(fake.state.rpcCalls[0].body.p_day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal("national_id" in fake.state.rpcCalls[0].body, false);

  // A second reveal the same day adds to the same counter row, never a new key.
  const second = await request(
    `https://fake.local/api/hr/employees/${TARGET_ID}/reveal-national-id`,
    { method: "POST", headers: { Cookie: `hr_session=${TOKEN}` } }
  );
  assert.equal(second.status, 200);
  assert.equal(fake.state.rpcCalls.length, 2);
  assert.equal(
    fake.state.rpcCalls[0].body.p_day,
    fake.state.rpcCalls[1].body.p_day
  );
});

test("reveal of a legacy row answers 404 and writes no counter", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request(
    `https://fake.local/api/hr/employees/${LEGACY_ID}/reveal-national-id`,
    { method: "POST", headers: { Cookie: `hr_session=${TOKEN}` } }
  );
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.ok, false);
  assert.equal(fake.state.rpcCalls.length, 0);
});

test("a failing counter hides the ID and answers 500", async (t) => {
  const fake = await createFake({ failRpc: true });
  t.after(() => fake.restore());

  const response = await request(
    `https://fake.local/api/hr/employees/${TARGET_ID}/reveal-national-id`,
    { method: "POST", headers: { Cookie: `hr_session=${TOKEN}` } }
  );
  const text = await response.text();

  assert.equal(response.status, 500);
  assert.equal(text.includes(TARGET_NATIONAL_ID), false);
  assert.equal(/\d{13}/.test(text), false);
});

test("ID reveal is rate limited", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request(
    `https://fake.local/api/hr/employees/${TARGET_ID}/reveal-national-id`,
    { method: "POST", headers: { Cookie: `hr_session=${TOKEN}` } },
    makeEnv({ RL_CONTEXT_IP: makeLimiter({ success: false }) })
  );

  assert.equal(response.status, 429);
  assert.equal(fake.state.rpcCalls.length, 0);
});

test("encryption round-trips and rejects a wrong key or a tampered value", async () => {
  const { decryptNationalId } = await import("../src/import/national-id-crypto.js");
  const stored = await encryptNationalId(ENC_KEY, TARGET_NATIONAL_ID);
  assert.match(stored, /^v1\./);
  assert.equal(stored.includes(TARGET_NATIONAL_ID), false);
  assert.equal(await decryptNationalId(ENC_KEY, stored), TARGET_NATIONAL_ID);
  assert.equal(await decryptNationalId("another-key", stored), null);
  assert.equal(await decryptNationalId(ENC_KEY, "v1.not-base64"), null);
  assert.equal(await decryptNationalId(ENC_KEY, "legacy-plaintext"), null);
});
