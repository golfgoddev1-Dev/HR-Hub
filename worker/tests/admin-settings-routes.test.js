// GET /api/admin/settings — role gate, the leave row with who changed it, the
// holidays, the fixed security policy, and nothing beyond code and name.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";
import { bangkokToday } from "../src/register-window.js";
import { SECURITY_POLICY } from "../src/admin-settings.js";

const ADMIN_TOKEN = "a".repeat(43);
const HR_TOKEN = "h".repeat(43);
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const HR_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date();
const TODAY = bangkokToday(NOW);
const YEAR = TODAY.slice(0, 4);

function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit"].includes(key)) continue;
    const [op, ...rest] = value.split(".");
    const arg = rest.join(".");
    if (op === "eq" && String(row[key]) !== arg) return false;
    if (op === "gte" && !(String(row[key]) >= arg)) return false;
    if (op === "lte" && !(String(row[key]) <= arg)) return false;
    if (op === "gt" && !(Date.parse(row[key]) > Date.parse(arg))) return false;
    if (op === "is" && row[key] != null) return false;
    if (op === "in" && !arg.slice(1, -1).split(",").includes(String(row[key]))) return false;
  }
  return true;
}

async function createFake(extra) {
  const future = new Date(NOW.getTime() + 6 * 3600 * 1000).toISOString();
  const session = async (token, employeeId, role) => ({
    id: `s-${role}`,
    token_hash: await sha256Hex(token),
    employee_id: employeeId,
    login_role: role,
    revoked_at: null,
    last_active_at: NOW.toISOString(),
    expires_at: future,
  });
  const state = {
    employees: [
      { id: ADMIN_ID, employee_code: "ADM001", full_name: "ผู้ดูแล ระบบ", is_active: true, national_id: "1234567890123" },
      { id: HR_ID, employee_code: "HR001", full_name: "เจ้าหน้าที่ HR", is_active: true, national_id: "9999999999999" },
    ],
    hr_admins: [{ employee_id: HR_ID }],
    system_admins: [{ employee_id: ADMIN_ID }],
    auth_sessions: [
      await session(ADMIN_TOKEN, ADMIN_ID, "system_admin"),
      await session(HR_TOKEN, HR_ID, "hr"),
    ],
    leave_settings: [],
    holidays: [],
    ...extra,
  };
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const parsed = new URL(String(input));
    const table = parsed.pathname.split("/").pop();
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ table, method });
    if (method === "PATCH" || method === "POST") return new Response(null, { status: 204 });
    let rows = (state[table] ?? []).filter((row) => matches(parsed.searchParams, row));
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Content-Range": `0-0/${rows.length}` } });
    }
    if (parsed.searchParams.get("order") === "holiday_date.asc") {
      rows = [...rows].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
    }
    const limit = Number(parsed.searchParams.get("limit"));
    return new Response(JSON.stringify(limit > 0 ? rows.slice(0, limit) : rows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function get(token = ADMIN_TOKEN) {
  const env = { SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "key" };
  const headers = token ? { Cookie: `hr_session=${token}` } : {};
  return app.request("https://fake.local/api/admin/settings", { headers }, env);
}

test("settings answers 401 without a session and 403 for a non system_admin", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  assert.equal((await get("")).status, 401);
  assert.equal((await get(HR_TOKEN)).status, 403);
  assert.equal(fake.calls.filter((call) => call.table === "leave_settings").length, 0);
});

test("settings returns the leave row, who changed it, the holidays and the policy", async (t) => {
  const fake = await createFake({
    leave_settings: [
      {
        id: 1,
        certificate_retention_days: 120,
        leave_retention_enabled: true,
        leave_retention_days: 1095,
        updated_at: "2026-11-01T03:00:00Z",
        updated_by: HR_ID,
      },
    ],
    holidays: [
      { holiday_date: `${YEAR}-01-01`, name: "วันขึ้นปีใหม่" },
      { holiday_date: "2999-12-31", name: "วันหยุดไกล" },
      { holiday_date: "2999-12-30", name: "วันหยุดถัดไป" },
    ],
  });
  t.after(() => fake.restore());

  const response = await get();
  const text = await response.text();
  const body = JSON.parse(text);

  assert.equal(response.status, 200);
  assert.deepEqual(body.leave, {
    configured: true,
    certificateRetentionDays: 120,
    leaveRetentionEnabled: true,
    leaveRetentionDays: 1095,
    updatedAt: "2026-11-01T03:00:00Z",
    updatedBy: { employeeCode: "HR001", fullName: "เจ้าหน้าที่ HR" },
  });
  assert.equal(body.holidays.year, YEAR);
  assert.equal(body.holidays.count, 1);
  assert.deepEqual(body.holidays.next, { date: "2999-12-30", name: "วันหยุดถัดไป" });
  assert.deepEqual(body.security, { ...SECURITY_POLICY });
  assert.deepEqual(body.security, {
    sessionIdleMinutes: 15,
    maxFailedPins: 5,
    lockMinutes: 15,
    sessionRetentionDays: 30,
    auditRetentionDays: 365,
  });
  assert.ok(!text.includes("9999999999999"));
  assert.ok(!text.includes(HR_ID));
});

test("no settings row and no holidays fall back to the defaults", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const body = await (await get()).json();
  assert.equal(body.leave.configured, false);
  assert.equal(body.leave.certificateRetentionDays, 90);
  assert.equal(body.leave.leaveRetentionEnabled, false);
  assert.equal(body.leave.updatedBy, null);
  assert.deepEqual(body.holidays, { year: YEAR, count: 0, next: null });
});
