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
import worker from "../src/index.js";
import {
  dispatchQueuedNotifications,
  NOTIFICATION_CRON,
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
    if (value.startsWith("neq.")) {
      if (String(row[key] ?? "") === value.slice(4)) return false;
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
async function createBackend({ failQueueInsert = false, queue = [], subscriptions = [], leaveRequests = [] } = {}) {
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
    leave_requests: leaveRequests,
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
      const found = (state[table] ?? []).filter((row) => matches(params, row));
      const limit = Number(params.get("limit"));
      return jsonResponse(Number.isInteger(limit) && limit > 0 ? found.slice(0, limit) : found);
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
  // The in-request pass may already have claimed the row, and a claim restamps
  // next_attempt_at with the claim time. The final status is asserted after
  // waitUntil below.
  assert.equal(typeof queued.next_attempt_at, "string");

  // The response was returned before dispatch ran; the pass is in waitUntil.
  assert.equal(waits.length, 1);
  await waits[0];

  // The pass selected the row by id and finished it before the cron was due.
  assert.equal(queued.status, "cancelled");
  assert.equal(queued.last_error, "no_subscription");
  assert.equal(queued.attempts, 0);

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

// The submit harness lives here, so the date-overlap rule is checked here too.
function existingLeave(status) {
  return {
    id: `leave-${status}`,
    request_code: "LV-20261101-001",
    employee_id: EMPLOYEE_ID,
    start_date: "2026-11-09",
    end_date: "2026-11-11",
    status,
  };
}

for (const status of ["pending", "approved"]) {
  test(`a submit on days already covered by a ${status} leave is refused with 409`, async (t) => {
    const fake = await createBackend({ leaveRequests: [existingLeave(status)] });
    t.after(() => fake.restore());

    const response = await submit(EMPLOYEE_TOKEN, { waitUntil() {} });
    const body = await response.json();

    assert.equal(response.status, 409, JSON.stringify(body));
    assert.equal(body.conflictRequestCode, "LV-20261101-001");
    assert.equal(body.conflictStatus, status);
    // Nothing was saved and nobody was notified.
    assert.equal(fake.state.leave_requests.length, 1);
    assert.equal(fake.state.notification_queue.length, 0);
    const overlapRead = fake.calls.find(
      (call) => call.table === "leave_requests" && call.method === "GET" && call.url.includes("start_date=lte.")
    );
    assert.match(overlapRead.url, /employee_id=eq\./);
    assert.match(overlapRead.url, /end_date=gte\.2026-11-10/);
    assert.ok(overlapRead.url.includes("status=in.(pending,approved)"));
  });
}

test("a rejected or cancelled leave on the same days does not block a new submit", async (t) => {
  const fake = await createBackend({ leaveRequests: [existingLeave("rejected"), existingLeave("cancelled")] });
  t.after(() => fake.restore());

  const response = await submit(EMPLOYEE_TOKEN, { waitUntil() {} });
  assert.equal(response.status, 201);
  assert.equal(fake.state.leave_requests.length, 3);
});

test("a second identical submit is refused instead of saved twice", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const first = await submit(EMPLOYEE_TOKEN, { waitUntil() {} });
  const second = await submit(EMPLOYEE_TOKEN, { waitUntil() {} });

  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
  assert.equal(fake.state.leave_requests.length, 1);
  // The refusal names the first request, so it is a real overlap and not the
  // guard tripping over its own row.
  assert.equal((await second.json()).conflictRequestCode, fake.state.leave_requests[0].request_code);
});

test("the post-insert overlap guard excludes the row it just inserted", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await submit(EMPLOYEE_TOKEN, { waitUntil() {} });
  assert.equal(response.status, 201);
  assert.equal(fake.state.leave_requests.length, 1);

  const insertedId = fake.state.leave_requests[0].id;
  const guardReads = fake.calls.filter(
    (call) =>
      call.table === "leave_requests" && call.method === "GET" && call.url.includes("id=neq.")
  );
  assert.equal(guardReads.length, 1);
  assert.ok(guardReads[0].url.includes(`id=neq.${insertedId}`));
  // The guard found no other row, so it deleted nothing.
  assert.equal(fake.calls.some((call) => call.table === "leave_requests" && call.method === "DELETE"), false);
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

  // Async for the no-context fallback, but with a context it only schedules.
  assert.equal(typeof returned.then, "function");
  assert.equal(waits.length, 1);
  await returned;
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

test("without an ExecutionContext the dispatch still runs inside the request", async (t) => {
  const fake = await createBackend();
  t.after(() => fake.restore());

  const response = await submit(EMPLOYEE_TOKEN);
  assert.equal(response.status, 201);

  // The fallback awaited the pass (bounded to three seconds), so the row is
  // already finished when the response arrives.
  const row = fake.state.notification_queue[0];
  assert.equal(row.status, "cancelled");
  assert.equal(row.last_error, "no_subscription");
  assert.equal(row.attempts, 0);
});

test("a dispatch failure never fails the leave submit", async (t) => {
  const fake = await createBackend({
    subscriptions: [
      {
        id: "sub-1",
        employee_id: APPROVER_ID,
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

  const waits = [];
  const response = await submit(EMPLOYEE_TOKEN, { waitUntil: (p) => waits.push(p) });

  assert.equal(response.status, 201);
  await waits[0];
  const row = fake.state.notification_queue[0];
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);
});

test("a row with no active subscription is cancelled and not retried", async (t) => {
  const fake = await createBackend({ queue: [queueRow()] });
  t.after(() => fake.restore());

  const first = await runNotificationQueue(ENV, NOW);
  assert.equal(first.cancelled, 1);

  const row = fake.state.notification_queue[0];
  assert.equal(row.status, "cancelled");
  assert.equal(row.last_error, "no_subscription");
  assert.equal(row.attempts, 0);

  const later = await runNotificationQueue(ENV, new Date(NOW.getTime() + 10 * 60 * 1000));
  assert.equal(later.selected, 0);
});

test("the every-minute trigger runs push always, auto-absent only with the exact switch", async (t) => {
  for (const [label, value, expectedWaits] of [
    ["unset", undefined, 1],
    ["false", "false", 1],
    ["true", "true", 2],
  ]) {
    const fake = await createBackend({ queue: [queueRow()] });
    const waits = [];
    try {
      const env = value === undefined ? { ...ENV } : { ...ENV, AUTO_ABSENT_ENABLED: value };
      worker.scheduled(
        { cron: NOTIFICATION_CRON, scheduledTime: NOW.toISOString() },
        env,
        { waitUntil: (promise) => waits.push(promise) }
      );

      assert.equal(waits.length, expectedWaits, label);
      await Promise.all(waits);
      // Push finishes the queued row even while auto-absent is off.
      assert.equal(fake.state.notification_queue[0].status, "cancelled", label);
    } finally {
      fake.restore();
    }
  }
});

test("other cron expressions run neither job", async (t) => {
  const fake = await createBackend({ queue: [queueRow()] });
  try {
    for (const cron of ["*/5 * * * *", "5 5 * * *"]) {
      const waits = [];
      worker.scheduled(
        { cron, scheduledTime: NOW.toISOString() },
        { ...ENV, AUTO_ABSENT_ENABLED: "true" },
        { waitUntil: (promise) => waits.push(promise) }
      );
      assert.equal(waits.length, 0, cron);
    }
    assert.equal(fake.state.notification_queue[0].status, "pending");
  } finally {
    fake.restore();
  }
});

test("a run stops starting rows once the subrequest budget is spent", async (t) => {
  const queue = Array.from({ length: 30 }, (_, index) => queueRow({ id: `queue-${index}` }));
  const fake = await createBackend({
    queue,
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
  t.after(fake.silence());

  const summary = await runNotificationQueue(ENV, NOW);

  assert.ok(summary.selected > 0 && summary.selected < 30);
  assert.ok(fake.calls.length <= 50);
  assert.ok(fake.state.notification_queue.some((row) => row.status === "pending"));
});

test("a run takes at most two rows and leaves the rest pending for the next minute", async (t) => {
  const queue = Array.from({ length: 5 }, (_, index) => queueRow({ id: `queue-${index}` }));
  const fake = await createBackend({
    queue,
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
  t.after(fake.silence());

  // The fake refuses every send, so a tried row goes back to pending with
  // attempts = 1; the three rows a run never took keep attempts = 0.
  const first = await runNotificationQueue(ENV, NOW);
  assert.equal(first.selected, 2);
  assert.equal(fake.claims(), 2);
  assert.equal(fake.state.notification_queue.filter((row) => row.attempts === 0).length, 3);

  const second = await runNotificationQueue(ENV, new Date(NOW.getTime() + 60 * 1000));
  assert.ok(second.selected <= 2);
});

test("a row cut off mid-send is not sent again inside the stale window, then once after it", async (t) => {
  const claimedAt = new Date(NOW.getTime() - 60 * 1000);
  const fake = await createBackend({
    queue: [queueRow({ id: "cut-off", status: "sending", next_attempt_at: claimedAt.toISOString() })],
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
  t.after(fake.silence());

  // One minute after the claim: still inside the window, so nothing is sent.
  const within = await runNotificationQueue(ENV, NOW);
  assert.equal(within.recovered, 0);
  assert.equal(within.selected, 0);
  assert.equal(fake.state.notification_queue[0].status, "sending");

  // Past the window the row returns to pending and is sent exactly once.
  const after = await runNotificationQueue(ENV, new Date(claimedAt.getTime() + 11 * 60 * 1000));
  assert.equal(after.recovered, 1);
  assert.equal(after.selected, 1);

  const again = await runNotificationQueue(ENV, new Date(claimedAt.getTime() + 11 * 60 * 1000));
  assert.equal(again.selected, 0);
});
