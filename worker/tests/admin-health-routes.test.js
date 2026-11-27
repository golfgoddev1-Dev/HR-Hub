// GET /api/admin/health — role gate, counts per queue, and what never leaves.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";
import { OVERDUE_MINUTES, healthCutoffs, queueFilters } from "../src/admin-health.js";

const ADMIN_TOKEN = "a".repeat(43);
const HR_TOKEN = "h".repeat(43);
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const HR_ID = "33333333-3333-4333-8333-333333333333";

const NOW = new Date();
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();

function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit"].includes(key)) continue;
    const time = (v) => Date.parse(v);
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
    } else if (value.startsWith("gt.")) {
      if (!(time(row[key]) > time(value.slice(3)))) return false;
    } else if (value.startsWith("gte.")) {
      if (!(time(row[key]) >= time(value.slice(4)))) return false;
    } else if (value.startsWith("lt.")) {
      if (!(time(row[key]) < time(value.slice(3)))) return false;
    } else if (value.startsWith("eq.")) {
      if (String(row[key]) !== value.slice(3)) return false;
    } else {
      return false;
    }
  }
  return true;
}

async function createFake(queues) {
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
      { id: ADMIN_ID, employee_code: "ADM001", full_name: "ผู้ดูแล ระบบ", is_active: true },
      { id: HR_ID, employee_code: "HR001", full_name: "เจ้าหน้าที่ HR", is_active: true },
    ],
    hr_admins: [{ employee_id: HR_ID }],
    system_admins: [{ employee_id: ADMIN_ID }],
    auth_sessions: [
      await session(ADMIN_TOKEN, ADMIN_ID, "system_admin"),
      await session(HR_TOKEN, HR_ID, "hr"),
    ],
    ...queues,
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
      return new Response(null, {
        status: 200,
        headers: { "Content-Range": `0-0/${rows.length}` },
      });
    }
    if (parsed.searchParams.get("order") === "sent_at.desc") {
      rows = [...rows].sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at));
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
  return app.request("https://fake.local/api/admin/health", { headers }, env);
}

test("health answers 401 without a session and 403 for a non system_admin", async (t) => {
  const fake = await createFake({ notification_queue: [], decision_email_jobs: [] });
  t.after(() => fake.restore());

  assert.equal((await get("")).status, 401);
  assert.equal((await get(HR_TOKEN)).status, 403);
  assert.equal(fake.calls.filter((call) => call.table === "notification_queue").length, 0);
});

test("health counts each queue and returns no row content", async (t) => {
  const fake = await createFake({
    notification_queue: [
      { id: "1", status: "pending", created_at: ago(1), sent_at: null, last_error: "secret-error", payload: { body: "secret-body" } },
      { id: "2", status: "pending", created_at: ago(OVERDUE_MINUTES + 5), sent_at: null },
      { id: "3", status: "sending", created_at: ago(2), sent_at: null },
      { id: "4", status: "failed", created_at: ago(60), sent_at: null },
      { id: "5", status: "failed", created_at: ago(60 * 30), sent_at: null },
      { id: "6", status: "sent", created_at: ago(90), sent_at: ago(80) },
      { id: "7", status: "sent", created_at: ago(40), sent_at: ago(30) },
    ],
    decision_email_jobs: [
      { id: "a", status: "sent", created_at: ago(10), sent_at: ago(9) },
    ],
  });
  t.after(() => fake.restore());

  const response = await get();
  const text = await response.text();
  const body = JSON.parse(text);

  assert.equal(response.status, 200);
  assert.deepEqual(body.queues.push, {
    pending: 2,
    sending: 1,
    overdue: 1,
    failed24h: 1,
    lastSentAt: body.queues.push.lastSentAt,
  });
  assert.equal(Date.parse(body.queues.push.lastSentAt), Date.parse(ago(30)));
  assert.deepEqual(body.queues.email, {
    pending: 0,
    sending: 0,
    overdue: 0,
    failed24h: 0,
    lastSentAt: body.queues.email.lastSentAt,
  });
  assert.ok(Number.isFinite(Date.parse(body.checkedAt)));
  assert.ok(!text.includes("secret-error"));
  assert.ok(!text.includes("secret-body"));
});

test("an empty queue reports zeros and no last send", async (t) => {
  const fake = await createFake({ notification_queue: [], decision_email_jobs: [] });
  t.after(() => fake.restore());

  const body = await (await get()).json();
  assert.deepEqual(body.queues.push, { pending: 0, sending: 0, overdue: 0, failed24h: 0, lastSentAt: null });
  assert.equal(body.queues.email.lastSentAt, null);
});

test("cutoffs are ten minutes and twenty-four hours back", () => {
  const now = new Date("2026-11-27T05:00:00Z");
  const cutoffs = healthCutoffs(now);
  assert.equal(cutoffs.overdueBefore, "2026-11-27T04:50:00.000Z");
  assert.equal(cutoffs.failedSince, "2026-11-26T05:00:00.000Z");
  assert.deepEqual(queueFilters(cutoffs).overdue[1], ["created_at", "lt", cutoffs.overdueBefore]);
});
