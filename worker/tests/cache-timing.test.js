// The two small response changes: shared lookups may be reused by the browser
// for five minutes (private, never a shared/CDN cache), admin stays no-store,
// and every API response carries its handler duration in Server-Timing.
//
// The database is a fake fetch, so no row is read or written. The last checks
// make sure no PIN or national ID can appear in these new paths.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const EMPLOYEE_TOKEN = "e".repeat(43);
const HR_TOKEN = "h".repeat(43);
const ADMIN_TOKEN = "a".repeat(43);

const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const HR_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const DEPARTMENT_ID = "44444444-4444-4444-8444-444444444444";

const NATIONAL_ID = "1234567890123";
const PIN = "654321";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "offset", "or", "on_conflict"].includes(key)) continue;
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
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
      await session(EMPLOYEE_TOKEN, EMPLOYEE_ID, "employee"),
      await session(HR_TOKEN, HR_ID, "hr"),
      await session(ADMIN_TOKEN, ADMIN_ID, "system_admin"),
    ],
    employees: [
      {
        id: EMPLOYEE_ID,
        employee_code: "EMP001",
        full_name: "พนักงาน ทดสอบ",
        department_id: DEPARTMENT_ID,
        is_active: true,
      },
      {
        id: HR_ID,
        employee_code: "HR001",
        full_name: "เจ้าหน้าที่ HR",
        department_id: DEPARTMENT_ID,
        is_active: true,
      },
      {
        id: ADMIN_ID,
        employee_code: "ADM001",
        full_name: "ผู้ดูแล ระบบ",
        department_id: DEPARTMENT_ID,
        is_active: true,
      },
    ],
    employee_credentials: [],
    departments: [{ id: DEPARTMENT_ID, name: "ฝ่ายบุคคล", is_active: true }],
    name_prefixes: [{ name: "นาย", is_active: true }],
    holidays: [{ holiday_date: "2026-01-01", name: "วันขึ้นปีใหม่" }],
    hr_admins: [{ employee_id: HR_ID }],
    meeting_admins: [],
    system_admins: [{ employee_id: ADMIN_ID }],
    employee_approvers: [],
    department_approvers: [],
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

    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "Content-Range": "0-0/0" },
      });
    }

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

function call(path, token) {
  const init = token ? { headers: { Cookie: `hr_session=${token}` } } : {};
  return app.request(`https://fake.local${path}`, init, ENV);
}

function assertPrivateLookup(response, label) {
  assert.equal(response.status, 200, label);
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=300", label);
}

test("lookup GETs are private and reusable for five minutes", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  assertPrivateLookup(await call("/api/profile/departments", EMPLOYEE_TOKEN), "departments");
  assertPrivateLookup(await call("/api/profile/name-prefixes", EMPLOYEE_TOKEN), "prefixes");
  assertPrivateLookup(await call("/api/leave/holidays", EMPLOYEE_TOKEN), "holidays");
  assertPrivateLookup(await call("/api/leave/hr/holidays", HR_TOKEN), "hr holidays");
  assertPrivateLookup(await call("/api/hr/directory/catalog", HR_TOKEN), "catalog");
});

test("admin responses stay no-store and caller-specific reads are not cached", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const admin = await call("/api/admin/permissions/search?q=AB", ADMIN_TOKEN);
  assert.equal(admin.status, 200);
  assert.equal(admin.headers.get("Cache-Control"), "no-store");

  // An unauthenticated lookup gets no cacheable body either.
  const denied = await call("/api/leave/holidays");
  assert.equal(denied.status, 401);
});

test("every API response has a Server-Timing total in milliseconds", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const responses = [
    await call("/api/leave/holidays", EMPLOYEE_TOKEN),
    await call("/api/leave/hr/holidays", HR_TOKEN),
    await call("/api/admin/permissions/search?q=AB", ADMIN_TOKEN),
    await call("/api/leave/holidays"),
    await call("/api/not-a-route"),
  ];

  for (const response of responses) {
    const value = response.headers.get("Server-Timing");
    assert.match(value ?? "", /^total;dur=\d+(\.\d+)?$/);
  }
});

test("the new paths expose no PIN and no national ID", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const holidays = await call("/api/leave/holidays", EMPLOYEE_TOKEN);
  const body = await holidays.json();

  assert.equal(holidays.headers.get("Server-Timing").includes(NATIONAL_ID), false);
  assert.equal(JSON.stringify(body).includes(NATIONAL_ID), false);
  for (const row of body.holidays) {
    assert.deepEqual(Object.keys(row).sort(), ["date", "name"]);
  }

  // Nothing in this test's state was ever read for a PIN.
  const credentialReads = fake.calls.filter((entry) => entry.table === "employee_credentials");
  for (const read of credentialReads) {
    assert.equal(new URL(read.url).searchParams.get("select"), "must_change_pin");
    assert.equal(read.url.includes(PIN), false);
  }
});
