// GET /api/admin/audit — role gate, filters, paging and what a row may reveal.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";
import { AUDIT_PAGE_SIZE, parseAuditQuery } from "../src/admin-audit.js";

const ADMIN_TOKEN = "a".repeat(43);
const HR_TOKEN = "h".repeat(43);
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const HR_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_ID = "55555555-5555-4555-8555-555555555555";
const LEAVE_ID = "99999999-9999-4999-8999-999999999999";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit"].includes(key)) continue;
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
    } else if (value.startsWith("gt.")) {
      if (!(Date.parse(row[key]) > Date.parse(value.slice(3)))) return false;
    } else if (value.startsWith("eq.")) {
      if (String(row[key]) !== value.slice(3)) return false;
    } else if (value.startsWith("in.(")) {
      if (!value.slice(4, -1).split(",").includes(String(row[key]))) return false;
    } else if (value.startsWith("lt.")) {
      const left = Number.isFinite(Number(row[key])) ? Number(row[key]) : Date.parse(row[key]);
      const bound = value.slice(3);
      const right = Number.isFinite(Number(bound)) ? Number(bound) : Date.parse(bound);
      if (!(left < right)) return false;
    } else if (value.startsWith("gte.")) {
      if (!(Date.parse(row[key]) >= Date.parse(value.slice(4)))) return false;
    } else {
      return false;
    }
  }
  return true;
}

async function createFake(auditRows) {
  const now = new Date();
  const future = new Date(now.getTime() + 6 * 3600 * 1000).toISOString();
  const session = async (token, employeeId, role) => ({
    id: `s-${role}`,
    token_hash: await sha256Hex(token),
    employee_id: employeeId,
    login_role: role,
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: future,
  });
  const state = {
    employees: [
      { id: ADMIN_ID, employee_code: "ADM001", full_name: "ผู้ดูแล ระบบ", is_active: true, national_id: "1234567890123" },
      { id: HR_ID, employee_code: "HR001", full_name: "เจ้าหน้าที่ HR", is_active: true },
      { id: TARGET_ID, employee_code: "AB001", full_name: "พนักงาน ทดสอบ", is_active: true },
    ],
    hr_admins: [{ employee_id: HR_ID }],
    system_admins: [{ employee_id: ADMIN_ID }],
    audit_logs: auditRows,
    auth_sessions: [
      await session(ADMIN_TOKEN, ADMIN_ID, "system_admin"),
      await session(HR_TOKEN, HR_ID, "hr"),
    ],
  };
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const parsed = new URL(String(input));
    const table = parsed.pathname.split("/").pop();
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ table, method, query: parsed.search });
    if (method !== "GET") return new Response(null, { status: 204 });
    let rows = (state[table] ?? []).filter((row) => matches(parsed.searchParams, row));
    if (parsed.searchParams.get("order") === "id.desc") rows = [...rows].sort((a, b) => b.id - a.id);
    const limit = Number(parsed.searchParams.get("limit"));
    return jsonResponse(limit > 0 ? rows.slice(0, limit) : rows);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function get(path, token = ADMIN_TOKEN) {
  const env = { SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "key" };
  const headers = token ? { Cookie: `hr_session=${token}` } : {};
  return app.request(`https://fake.local${path}`, { headers }, env);
}

function row(id, overrides = {}) {
  return {
    id,
    actor_id: ADMIN_ID,
    action: "leave_approved",
    entity: "leave_request",
    entity_id: LEAVE_ID,
    detail: { note: "secret-detail", nationalId: "1234567890123" },
    created_at: `2026-11-${String(10 + (id % 10)).padStart(2, "0")}T03:00:00Z`,
    ...overrides,
  };
}

test("audit answers 401 without a session and 403 for a non system_admin", async (t) => {
  const fake = await createFake([row(1)]);
  t.after(() => fake.restore());

  assert.equal((await get("/api/admin/audit", "")).status, 401);
  assert.equal((await get("/api/admin/audit", HR_TOKEN)).status, 403);
  assert.equal(fake.calls.filter((call) => call.table === "audit_logs").length, 0);
});

test("audit returns newest first with names, and never the detail column", async (t) => {
  const fake = await createFake([
    row(1),
    row(2, { action: "permission_granted", entity: "permission", entity_id: TARGET_ID, detail: JSON.stringify({ permission: "hr_admin", employeeId: TARGET_ID }) }),
    row(3, { actor_id: null }),
  ]);
  t.after(() => fake.restore());

  const response = await get("/api/admin/audit");
  const text = await response.text();
  const body = JSON.parse(text);

  assert.equal(response.status, 200);
  assert.deepEqual(body.items.map((item) => item.id), ["3", "2", "1"]);
  assert.equal(body.nextBefore, null);
  assert.equal(body.items[0].actor, null);
  assert.deepEqual(body.items[1].target, { employeeCode: "AB001", fullName: "พนักงาน ทดสอบ" });
  assert.equal(body.items[1].permission, "hr_admin");
  assert.equal(body.items[2].target, null);
  assert.equal(body.items[2].permission, null);
  assert.ok(!text.includes("secret-detail"));
  assert.ok(!text.includes("1234567890123"));
  assert.ok(!Object.keys(body.items[0]).includes("detail"));
});

test("audit pages with nextBefore and filters by action and Bangkok date", async (t) => {
  const rows = Array.from({ length: AUDIT_PAGE_SIZE + 5 }, (_, index) => row(index + 1));
  const fake = await createFake(rows);
  t.after(() => fake.restore());

  const first = await (await get("/api/admin/audit")).json();
  assert.equal(first.items.length, AUDIT_PAGE_SIZE);
  assert.equal(first.nextBefore, String(first.items.at(-1).id));

  const second = await (await get(`/api/admin/audit?before=${first.nextBefore}`)).json();
  assert.equal(second.items.length, 5);
  assert.equal(second.nextBefore, null);

  const none = await (await get("/api/admin/audit?action=permission_revoked")).json();
  assert.equal(none.items.length, 0);

  await get("/api/admin/audit?from=2026-11-01&to=2026-11-30");
  const query = decodeURIComponent(fake.calls.filter((call) => call.table === "audit_logs").at(-1).query);
  assert.match(query, /created_at=gte\.2026-11-01T00:00:00\+07:00/);
  assert.match(query, /created_at=lt\.2026-12-01T00:00:00\+07:00/);
});

test("audit refuses a malformed filter instead of ignoring it", async (t) => {
  const fake = await createFake([row(1)]);
  t.after(() => fake.restore());

  for (const query of ["action=Bad-Action", "from=2026-02-31", "to=yesterday", "before=0", "before=1;drop", "from=2026-12-01&to=2026-11-01"]) {
    const response = await get(`/api/admin/audit?${query}`);
    assert.equal(response.status, 400, query);
  }
  assert.equal(fake.calls.filter((call) => call.table === "audit_logs").length, 0);
});

test("parseAuditQuery returns no filters for an empty query", () => {
  assert.deepEqual(parseAuditQuery(new URLSearchParams("")), []);
});

test("audit names the employee a session sign-out or an unlock was done to", async (t) => {
  const fake = await createFake([
    row(1, { action: "session_revoked", entity: "employee", entity_id: TARGET_ID, detail: { loginRole: "employee" } }),
    row(2, { action: "account_unlocked", entity: "employee", entity_id: TARGET_ID, detail: {} }),
    row(3, { action: "employee_profile_updated", entity: "employee", entity_id: TARGET_ID }),
  ]);
  t.after(() => fake.restore());

  const body = await (await get("/api/admin/audit")).json();
  const byAction = Object.fromEntries(body.items.map((item) => [item.action, item]));
  assert.equal(byAction.session_revoked.target.employeeCode, "AB001");
  assert.equal(byAction.account_unlocked.target.employeeCode, "AB001");
  assert.equal(byAction.employee_profile_updated.target, null);
});
