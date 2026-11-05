// Fast notification delivery. A leave submit or decision queues one row and
// hands a dispatch pass to the request's ExecutionContext, so the push leaves
// within seconds instead of waiting for the five-minute cron. The cron stays the
// retry net, and a queue failure never turns a saved leave into an error.
//
// The database and the push service are a fake fetch: nothing leaves the test.
import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";
import {
  dispatchQueuedNotifications,
  runNotificationQueue,
} from "../src/push/queue.js";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  VAPID_PUBLIC_KEY: "fake-public-key",
  VAPID_PRIVATE_KEY: "fake-private-key",
  VAPID_SUBJECT: "mailto:test@example.com",
};

const EMPLOYEE_TOKEN = "e".repeat(43);
const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const APPROVER_ID = "22222222-2222-4222-8222-222222222222";
const TYPE_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-05T10:00:00.000Z");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "offset", "or", "on_conflict", "like"].includes(key)) {
      continue;
    }
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (String(row[key] ?? "") !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("lte.")) {
      const left = Date.parse(String(row[key] ?? ""));
      const right = Date.parse(value.slice(4));
      if (!Number.isFinite(left) || !Number.isFinite(right) || !(left <= right)) return false;
      continue;
    }
    if (value.startsWith("in.(")) {
      const list = value.slice(4, -1).split(",").map((entry) => decodeURIComponent(entry));
      if (!list.includes(String(row[key] ?? ""))) return false;
      continue;
    }
  }
  return true;
}

/**
 * Fake PostgREST plus a push endpoint that always refuses. Tracks successful
 * pending -> sending claims so the double-send test can count them.
 */
async function createBackend({ failQueueInsert = false, queue = [], subscriptions = [] } = {}) {
  const now = new Date();
  const session = {
    id: "session-1",
    token_hash: await sha256Hex(EMPLOYEE_TOKEN),
    employee_id: EMPLOYEE_ID,
    login_role: "employee",
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  };

  const state = {
    auth_sessions: [session],
    employees: [
      { id: EMPLOYEE_ID, full_name: "พนักงาน ทดสอบ", department_id: null, is_active: true },
      {
        id: APPROVER_ID,
        employee_code: "APP001",
        full_name: "ผู้อนุมัติ",
        department_id: null,
        is_active: true,
      },
    ],
    employee_credentials: [],
    hr_admins: [],
    meeting_admins: [],
    system_admins: [],
    employee_approvers: [
      { employee_id: EMPLOYEE_ID, approver_id: APPROVER_ID, priority: 1, is_active: true },
    ],
    department_approvers: [],
    leave_types: [
      {
        id: TYPE_ID,
        name: "ลากิจ",
        requires_attachment: false,
        is_active: true,
        attachment_required_from_days: 3,
      },
    ],
    shift_options: [{ code: "DAY_FULL", label: "เต็มวัน", is_half: false }],
    holidays: [],
    leave_requests: [],
    notification_queue: queue,
    push_subscriptions: subscriptions,
    audit_logs: [],
  };

  const calls = [];
  let claims = 0;
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (!url.startsWith("https://fake-project.supabase.co")) {
      // The push service refuses every delivery; encryption may fail before this.
      return new Response(null, { status: 500 });
    }

    const method = (init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop();
    const params = parsed.searchParams;
    const prefer = String(init.headers?.Prefer ?? "");
    calls.push({ url, method, table });

    if (method === "GET") {
      return jsonResponse((state[table] ?? []).filter((row) => matches(params, row)));
    }

    if (method === "POST") {
      if (table === "notification_queue" && failQueueInsert) {
        return jsonResponse({ code: "23502" }, 400);
      }
      const body = init.body ? JSON.parse(init.body) : null;
      const rows = Array.isArray(body) ? body : [body];
      const stored = rows.map((row) => ({
        ...row,
        id: row.id ?? `${table}-${state[table].length}`,
      }));
      state[table] = state[table] ?? [];
      state[table].push(...stored);
      return prefer.includes("return=representation")
        ? jsonResponse(stored, 201)
        : new Response(null, { status: 201 });
    }

    if (method === "PATCH") {
      const patch = init.body ? JSON.parse(init.body) : {};
      const updated = (state[table] ?? []).filter((row) => matches(params, row));
      for (const row of updated) Object.assign(row, patch);
      if (table === "notification_queue" && patch.status === "sending" && updated.length > 0) {
        claims += 1;
      }
      return prefer.includes("return=representation")
        ? jsonResponse(updated)
        : new Response(null, { status: 204 });
    }

    return new Response(null, { status: 204 });
  };

  return {
    state,
    calls,
    claims: () => claims,
    restore() {
      globalThis.fetch = original;
    },
    silence() {
      const originalError = console.error;
      console.error = () => {};
      return () => {
        console.error = originalError;
      };
    },
  };
}

function submit(token, ctx) {
  return app.request(
    "https://fake.local/api/leave/requests",
    {
      method: "POST",
      headers: { Cookie: `hr_session=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        leaveTypeId: TYPE_ID,
        shiftCode: "DAY_FULL",
        startDate: "2026-11-10",
        endDate: "2026-11-10",
      }),
    },
    ENV,
    ctx
  );
}

function queueRow(overrides = {}) {
  return {
    id: "queue-1",
    employee_id: EMPLOYEE_ID,
    leave_request_id: null,
    kind: "leave_submitted",
    payload: { title: "มีใบลารออนุมัติ", body: "มีใบลาใหม่รอการอนุมัติ", url: "/leave/approvals" },
    status: "pending",
    attempts: 0,
    next_attempt_at: NOW.toISOString(),
    ...overrides,
  };
}

test("a leave submit queues the push with next_attempt_at and dispatches it", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const waits = [];
  const response = await submit(EMPLOYEE_TOKEN, {
    waitUntil(promise) {
      waits.push(promise);
    },
  });
  const body = await response.json();

  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(fake.state.notification_queue.length, 1);

  const queued = fake.state.notification_queue[0];
  assert.equal(queued.employee_id, APPROVER_ID);
  assert.equal(queued.status, "pending");
  assert.equal(queued.next_attempt_at, queued.created_at);
  assert.equal(typeof queued.next_attempt_at, "string");

  // The response was returned before dispatch ran; the pass is in waitUntil.
  assert.equal(waits.length, 1);
  await waits[0];

  const dispatchRead = fake.calls.find(
    (call) => call.table === "notification_queue" && call.method === "GET"
  );
  assert.match(dispatchRead.url, /id=in\.\(/);
});

test("a failed notification insert never fails the leave submit", async (t) => {
  const fake = await createBackend({ failQueueInsert: true });
  t.after(() => fake.restore());
  const restoreLog = fake.silence();
  t.after(restoreLog);

  const waits = [];
  const response = await submit(EMPLOYEE_TOKEN, { waitUntil: (p) => waits.push(p) });

  assert.equal(response.status, 201);
  assert.equal(fake.state.notification_queue.length, 0);
  assert.equal(fake.state.leave_requests.length, 1);
  assert.equal(waits.length, 0);
});

test("dispatch is handed to waitUntil and never awaited", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const waits = [];
  const returned = dispatchQueuedNotifications(
    ENV,
    { waitUntil: (promise) => waits.push(promise) },
    ["queue-missing"]
  );

  // A boolean, not a promise: the request had nothing to await.
  assert.equal(returned, true);
  assert.equal(waits.length, 1);
  await waits[0];
});

test("a row already claimed is not sent twice", async (t) => {
  const fake = await createBackend({ queue: [queueRow()] });
  t.after(() => fake.restore());

  const [first, second] = await Promise.all([
    runNotificationQueue(ENV, NOW),
    runNotificationQueue(ENV, NOW),
  ]);

  assert.equal(first.selected + second.selected, 1);
  assert.equal(fake.claims(), 1);
  assert.equal(fake.state.notification_queue[0].status, "cancelled");
});

test("a failed send keeps the row pending with backoff and is retried", async (t) => {
  const fake = await createBackend({
    queue: [queueRow()],
    subscriptions: [
      {
        id: "sub-1",
        employee_id: EMPLOYEE_ID,
        endpoint: "https://push.invalid/one",
        p256dh: "AAAA",
        auth: "BBBB",
        is_active: true,
      },
    ],
  });
  t.after(() => fake.restore());
  const restoreLog = fake.silence();
  t.after(restoreLog);

  const summary = await runNotificationQueue(ENV, NOW);
  assert.equal(summary.selected, 1);
  assert.equal(summary.failed, 0);

  const saved = fake.state.notification_queue[0];
  assert.equal(saved.status, "pending");
  assert.equal(saved.attempts, 1);
  assert.equal(
    saved.next_attempt_at,
    new Date(NOW.getTime() + 60 * 1000).toISOString()
  );
  assert.equal(typeof saved.last_error, "string");

  // The cron is the safety net: one minute later the row is due again.
  const later = await runNotificationQueue(ENV, new Date(NOW.getTime() + 2 * 60 * 1000));
  assert.equal(later.selected, 1);
  assert.equal(fake.state.notification_queue[0].attempts, 2);
});
