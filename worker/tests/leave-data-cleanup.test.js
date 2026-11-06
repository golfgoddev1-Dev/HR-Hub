// The two growing-table retention jobs: the notification queue final states and
// the opt-in leave window. Pending/sending queue rows and pending leave rows are
// never deleted, a child is removed before its parent, and dryRun deletes
// nothing.
import test from "node:test";
import assert from "node:assert/strict";

import {
  CLEANUP_MAX_ROWS,
  NOTIFICATION_QUEUE_RETENTION_DAYS,
  parseLeaveRetentionDays,
  purgeOldLeaveData,
  purgeOldNotificationQueue,
  retentionDateCutoff,
} from "../src/maintenance/cleanup.js";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const QUEUE_CUTOFF = new Date(
  NOW.getTime() - NOTIFICATION_QUEUE_RETENTION_DAYS * 86400000
).toISOString();
const LEAVE_CUTOFF = retentionDateCutoff(NOW, 30);

function compare(actual, value, op) {
  if (op === "eq") return actual === value;
  if (op === "lt") return actual !== null && actual !== undefined && actual < value;
  if (op === "lte") return actual !== null && actual !== undefined && actual <= value;
  if (op === "gte") return actual !== null && actual !== undefined && actual >= value;
  return false;
}

function matches(row, filters) {
  return filters.every(([column, op, value]) => {
    const actual = row[column];
    if (op === "in") return Array.isArray(value) && value.includes(actual);
    if (op === "is") return value === null ? actual === null || actual === undefined : actual === value;
    if (op === "not.is") {
      return value === null ? actual !== null && actual !== undefined : actual !== value;
    }
    return compare(actual, value, op);
  });
}

function createFakeDb({ leaveRows = [], notificationRows = [] } = {}) {
  const state = {
    leave_requests: [...leaveRows],
    notification_queue: [...notificationRows],
  };
  const calls = [];

  return {
    calls,
    state,
    async select(table, options = {}) {
      calls.push({ method: "select", table, options });
      let rows = (state[table] ?? []).filter((row) => matches(row, options.filters ?? []));
      const order = options.order;
      if (order) {
        const [column, direction] = order.split(".");
        rows = [...rows].sort((left, right) => {
          const compared = String(left[column] ?? "").localeCompare(String(right[column] ?? ""));
          return direction === "desc" ? -compared : compared;
        });
      }
      if (typeof options.limit === "number") rows = rows.slice(0, options.limit);
      return rows;
    },
    async remove(table, filters = [], options = {}) {
      calls.push({ method: "remove", table, filters, options });
      const ids = filters.find(([column, op]) => column === "id" && op === "in")?.[2] ?? [];
      const removed = (state[table] ?? []).filter((row) => ids.includes(row.id));
      state[table] = (state[table] ?? []).filter((row) => !ids.includes(row.id));
      return {
        data: options.returning ? removed.map((row) => ({ id: row.id })) : [],
        error: null,
      };
    },
  };
}

function notification(id, status, createdAt, leaveRequestId = null) {
  return { id, status, created_at: createdAt, leave_request_id: leaveRequestId };
}

function leave(id, status, endDate, overrides = {}) {
  return {
    id,
    status,
    end_date: endDate,
    medical_certificate_url: null,
    ...overrides,
  };
}

test("notification cleanup deletes only old final rows", async (t) => {
  const logs = [];
  t.mock.method(console, "log", (...args) => logs.push(args));

  const fake = createFakeDb({
    notificationRows: [
      notification("sent-old", "sent", "2026-04-01T00:00:00.000Z"),
      notification("sent-new", "sent", "2026-05-20T00:00:00.000Z"),
      notification("failed-old", "failed", "2026-04-02T00:00:00.000Z"),
      notification("cancelled-old", "cancelled", "2026-04-03T00:00:00.000Z"),
      notification("pending-old", "pending", "2026-01-01T00:00:00.000Z"),
      notification("sending-old", "sending", "2026-01-01T00:00:00.000Z"),
    ],
  });

  const deleted = await purgeOldNotificationQueue(fake, NOW);

  assert.equal(deleted, 3);
  assert.deepEqual(
    fake.state.notification_queue.map((row) => row.id).sort(),
    ["pending-old", "sending-old", "sent-new"]
  );

  const select = fake.calls.find((call) => call.method === "select");
  assert.deepEqual(select.options.filters, [
    ["status", "in", ["sent", "failed", "cancelled"]],
    ["created_at", "lt", QUEUE_CUTOFF],
  ]);
  assert.equal(select.options.order, "created_at.asc");

  const entry = logs.find((args) => args[1]?.table === "notification_queue");
  assert.ok(entry);
  assert.deepEqual(Object.keys(entry[1]).sort(), ["cutoff", "deleted", "durationMs", "table"]);
  assert.equal(entry[1].deleted, 3);
  assert.equal(entry[1].cutoff, QUEUE_CUTOFF);
});

test("leave retention stays disabled for an unusable value", async (t) => {
  const logs = [];
  t.mock.method(console, "log", (...args) => logs.push(args));

  for (const value of [undefined, null, "", 0, -1, "abc", 2.5]) {
    const fake = createFakeDb({
      leaveRows: [leave("old", "approved", "2026-01-01")],
    });
    const summary = await purgeOldLeaveData(fake, NOW, { retentionDays: value });

    assert.equal(summary.disabled, true, String(value));
    assert.equal(summary.leaveRequests, 0);
    assert.equal(fake.calls.length, 0, String(value));
    assert.equal(parseLeaveRetentionDays(value), null, String(value));
  }

  assert.equal(parseLeaveRetentionDays("30"), 30);
  assert.equal(parseLeaveRetentionDays(90), 90);
  assert.equal(
    logs.some((args) => args[1]?.disabled === "leave retention disabled"),
    true
  );
});

test("leave cleanup deletes only final requests older than the cutoff", async (t) => {
  t.mock.method(console, "log", () => {});

  const fake = createFakeDb({
    leaveRows: [
      leave("approved-old", "approved", "2026-04-01"),
      leave("rejected-old", "rejected", "2026-04-02"),
      leave("cancelled-old", "cancelled", "2026-04-03"),
      leave("blocked", "approved", "2026-04-04"),
      leave("boundary", "approved", LEAVE_CUTOFF),
      leave("recent", "approved", "2026-05-20"),
      leave("pending-old", "pending", "2026-01-01"),
    ],
    notificationRows: [
      notification("n-old", "sent", "2026-04-10T00:00:00.000Z", "approved-old"),
      notification("n-rejected", "failed", "2026-04-10T00:00:00.000Z", "rejected-old"),
      notification("n-cancelled", "cancelled", "2026-04-10T00:00:00.000Z", "cancelled-old"),
      notification("n-active", "pending", "2026-01-01T00:00:00.000Z", "blocked"),
    ],
  });

  const summary = await purgeOldLeaveData(fake, NOW, { retentionDays: 30 });

  assert.equal(summary.disabled, false);
  assert.equal(summary.cutoff, LEAVE_CUTOFF);
  assert.equal(summary.leaveRequests, 3);
  assert.equal(summary.notifications, 3);
  assert.equal(summary.skipped, 1);
  assert.deepEqual(
    fake.state.leave_requests.map((row) => row.id).sort(),
    ["blocked", "boundary", "pending-old", "recent"]
  );
  assert.deepEqual(fake.state.notification_queue.map((row) => row.id), ["n-active"]);

  // Children are removed before the parent, always.
  const firstRemove = fake.calls.findIndex((call) => call.method === "remove");
  const lastNotificationRemove = fake.calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => call.method === "remove" && call.table === "notification_queue")
    .at(-1).index;
  const firstLeaveRemove = fake.calls.findIndex(
    (call) => call.method === "remove" && call.table === "leave_requests"
  );
  assert.equal(firstRemove, lastNotificationRemove);
  assert.ok(lastNotificationRemove < firstLeaveRemove);
});

test("a row exactly on the cutoff date is kept", async (t) => {
  t.mock.method(console, "log", () => {});
  const fake = createFakeDb({
    leaveRows: [leave("boundary", "approved", LEAVE_CUTOFF)],
  });

  const summary = await purgeOldLeaveData(fake, NOW, { retentionDays: 30 });

  assert.equal(summary.leaveRequests, 0);
  assert.equal(fake.state.leave_requests.length, 1);
  assert.equal(LEAVE_CUTOFF, "2026-05-02");
});

test("the per-run cap stops a large backlog", async (t) => {
  t.mock.method(console, "log", () => {});
  const rows = Array.from({ length: CLEANUP_MAX_ROWS + 1 }, (_, index) =>
    leave(`row-${index}`, "approved", "2026-01-01")
  );
  const fake = createFakeDb({ leaveRows: rows });

  const summary = await purgeOldLeaveData(fake, NOW, { retentionDays: 30 });

  assert.equal(summary.leaveRequests, CLEANUP_MAX_ROWS);
  assert.equal(fake.state.leave_requests.length, 1);
});

test("dryRun reports the counts and deletes nothing", async (t) => {
  t.mock.method(console, "log", () => {});
  const fake = createFakeDb({
    leaveRows: [
      leave("one", "approved", "2026-04-01"),
      leave("two", "rejected", "2026-04-02"),
    ],
    notificationRows: [
      notification("n-one", "sent", "2026-04-10T00:00:00.000Z", "one"),
      notification("n-active", "sending", "2026-04-10T00:00:00.000Z", "two"),
    ],
  });

  const summary = await purgeOldLeaveData(fake, NOW, { retentionDays: 30, dryRun: true });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.leaveRequests, 1);
  assert.equal(summary.notifications, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(fake.state.leave_requests.length, 2);
  assert.equal(fake.state.notification_queue.length, 2);
  assert.equal(fake.calls.some((call) => call.method === "remove"), false);
});

test("logs carry no reason or name, only table, count, duration and cutoff", async (t) => {
  const logs = [];
  t.mock.method(console, "log", (...args) => logs.push(args));

  const fake = createFakeDb({
    leaveRows: [
      leave("old", "approved", "2026-04-01", {
        reason: "ลับเฉพาะบุคคล",
        employee_name: "Somchai Secret",
      }),
    ],
  });

  await purgeOldLeaveData(fake, NOW, { retentionDays: 30 });

  const entry = logs.find((args) => args[1]?.table === "leave_requests");
  assert.deepEqual(Object.keys(entry[1]).sort(), ["cutoff", "deleted", "durationMs", "table"]);
  const logged = JSON.stringify(logs);
  assert.equal(logged.includes("ลับเฉพาะบุคคล"), false);
  assert.equal(logged.includes("Somchai"), false);
});
