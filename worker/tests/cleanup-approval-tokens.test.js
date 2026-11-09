// Approval-token cleanup: only a token that is used, invalidated or expired AND
// older than 30 days may be deleted. A pending token inside its 72-hour window is
// never touched. Batches stay at 200 and the shared row cap is respected; the log
// line carries the table, count, duration and cutoff only.

import test from "node:test";
import assert from "node:assert/strict";

import {
  APPROVAL_TOKENS_TABLE,
  APPROVAL_TOKEN_RETENTION_DAYS,
  CLEANUP_BATCH_SIZE,
  purgeOldApprovalTokens,
  retentionCutoff,
} from "../src/maintenance/cleanup.js";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const CUTOFF = retentionCutoff(NOW, APPROVAL_TOKEN_RETENTION_DAYS);

function matches(row, filters) {
  return filters.every(([column, op, value]) => {
    const actual = row[column];
    if (op === "eq") return actual === value;
    if (op === "lt") return actual !== null && actual !== undefined && actual < value;
    if (op === "is") return value === null ? actual == null : actual === value;
    if (op === "not.is") return value === null ? actual != null : actual !== value;
    if (op === "in") return Array.isArray(value) && value.includes(actual);
    throw new Error(`unsupported test filter: ${op}`);
  });
}

function createFakeDb(rows, { fail = false } = {}) {
  let state = rows.map((row) => ({ ...row }));
  const calls = [];

  return {
    calls,
    get rows() {
      return state;
    },
    async select(table, options = {}) {
      calls.push({ method: "select", table, options });
      assert.equal(table, APPROVAL_TOKENS_TABLE);
      if (fail) {
        throw Object.assign(new Error("token-hash-marker 203.0.113.9 สมชาย"), {
          name: "DbError",
          code: "XX000",
        });
      }

      let matched = state.filter((row) => matches(row, options.filters ?? []));
      if (typeof options.order === "string") {
        const [column, direction] = options.order.split(".");
        matched = [...matched].sort((left, right) => {
          const a = String(left[column] ?? "");
          const b = String(right[column] ?? "");
          return a.localeCompare(b) * (direction === "desc" ? -1 : 1);
        });
      }
      if (typeof options.limit === "number") matched = matched.slice(0, options.limit);
      return matched.map((row) => ({ id: row.id }));
    },
    async remove(table, filters = [], options = {}) {
      calls.push({ method: "remove", table, filters, options });
      const ids = filters.find(([column, op]) => column === "id" && op === "in")?.[2] ?? [];
      const removed = state.filter((row) => ids.includes(row.id));
      state = state.filter((row) => !ids.includes(row.id));
      return {
        data: options.returning ? removed.map((row) => ({ id: row.id })) : [],
        error: null,
      };
    },
  };
}

test("deletes only finished tokens older than 30 days", async () => {
  const db = createFakeDb([
    {
      id: "used-old",
      created_at: "2026-04-01T00:00:00.000Z",
      expires_at: "2026-04-04T00:00:00.000Z",
      used_at: "2026-04-02T00:00:00.000Z",
      invalidated_at: null,
    },
    {
      id: "invalidated-old",
      created_at: "2026-04-05T00:00:00.000Z",
      expires_at: "2026-04-08T00:00:00.000Z",
      used_at: null,
      invalidated_at: "2026-04-06T00:00:00.000Z",
    },
    {
      id: "expired-old",
      created_at: "2026-04-10T00:00:00.000Z",
      expires_at: "2026-04-11T00:00:00.000Z",
      used_at: null,
      invalidated_at: null,
    },
    {
      id: "pending-old-expired",
      created_at: "2026-03-01T00:00:00.000Z",
      expires_at: "2026-03-02T00:00:00.000Z",
      used_at: null,
      invalidated_at: null,
    },
    {
      id: "pending-in-window",
      created_at: "2026-05-31T00:00:00.000Z",
      expires_at: "2026-06-02T00:00:00.000Z",
      used_at: null,
      invalidated_at: null,
    },
    {
      id: "used-recent",
      created_at: "2026-05-31T00:00:00.000Z",
      expires_at: "2026-06-02T00:00:00.000Z",
      used_at: "2026-05-31T01:00:00.000Z",
      invalidated_at: null,
    },
  ]);

  const deleted = await purgeOldApprovalTokens(db, NOW);

  assert.equal(deleted, 4);
  assert.deepEqual(
    db.rows.map((row) => row.id).sort(),
    ["pending-in-window", "used-recent"]
  );

  // Every read is bounded by the created_at cutoff, so a fresh row can never be
  // selected by any of the three conditions.
  for (const call of db.calls.filter((entry) => entry.method === "select")) {
    const created = call.options.filters.find(([column]) => column === "created_at");
    assert.deepEqual(created, ["created_at", "lt", CUTOFF]);
  }
});

test("deletes in 200-row batches below the cap", async () => {
  const rows = Array.from({ length: CLEANUP_BATCH_SIZE + 50 }, (_, index) => ({
    id: `used-${index}`,
    created_at: "2026-04-01T00:00:00.000Z",
    expires_at: "2026-04-04T00:00:00.000Z",
    used_at: "2026-04-02T00:00:00.000Z",
    invalidated_at: null,
  }));
  const db = createFakeDb(rows);

  const deleted = await purgeOldApprovalTokens(db, NOW);

  assert.equal(deleted, rows.length);
  assert.equal(db.rows.length, 0);

  const limits = db.calls
    .filter((entry) => entry.method === "select")
    .map((entry) => entry.options.limit);
  // Two full-batch reads drain the 250 rows; the later conditions find none.
  assert.equal(limits[0], CLEANUP_BATCH_SIZE);
  assert.equal(limits[1], CLEANUP_BATCH_SIZE);
  assert.equal(limits.length >= 3, true);
  assert.equal(limits.every((limit) => limit <= CLEANUP_BATCH_SIZE), true);
});

test("stops at the shared row cap", async () => {
  const rows = Array.from({ length: 450 }, (_, index) => ({
    id: `used-${index}`,
    created_at: "2026-04-01T00:00:00.000Z",
    expires_at: "2026-04-04T00:00:00.000Z",
    used_at: "2026-04-02T00:00:00.000Z",
    invalidated_at: null,
  }));
  const db = createFakeDb(rows);

  const deleted = await purgeOldApprovalTokens(db, NOW, { maxRows: 200 });

  assert.equal(deleted, 200);
  assert.equal(db.rows.length, 250);
});

test("logs the table, count, duration and cutoff only", async () => {
  const db = createFakeDb([
    {
      id: "used-old",
      created_at: "2026-04-01T00:00:00.000Z",
      expires_at: "2026-04-04T00:00:00.000Z",
      used_at: "2026-04-02T00:00:00.000Z",
      invalidated_at: null,
    },
  ]);

  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args);
  try {
    await purgeOldApprovalTokens(db, NOW);
  } finally {
    console.log = original;
  }

  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], "[maintenance-cleanup]");
  const entry = logs[0][1];
  assert.deepEqual(Object.keys(entry).sort(), ["cutoff", "deleted", "durationMs", "table"]);
  assert.equal(entry.table, APPROVAL_TOKENS_TABLE);
  assert.equal(entry.deleted, 1);
  assert.equal(entry.cutoff, CUTOFF);
  assert.equal(JSON.stringify(entry).includes("used-old"), false);
});

test("a failing read logs the code only and never throws", async () => {
  const db = createFakeDb([], { fail: true });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const deleted = await purgeOldApprovalTokens(db, NOW);
    assert.equal(deleted, 0);
  } finally {
    console.error = original;
  }

  assert.equal(errors.length, 1);
  const text = JSON.stringify(errors);
  assert.equal(text.includes("token-hash-marker"), false);
  assert.equal(text.includes("203.0.113.9"), false);
  assert.equal(text.includes("สมชาย"), false);
  assert.equal(text.includes("XX000"), true);
});
