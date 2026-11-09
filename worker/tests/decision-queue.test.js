// The decision-email queue: the table's unique key is the idempotency key, a
// duplicate enqueue inserts nothing, and a claim is what allows exactly one send.
// Retry rules match Phase 2a: network/upstream retry, config/invalid do not.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DECISION_EMAIL_JOBS_TABLE,
  dispatchDecisionEmails,
  deliverDecisionEmail,
  enqueueDecisionEmails,
} from "../src/email/decision-queue.js";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const LEAD_ID = "22222222-2222-4222-8222-222222222222";

function job(overrides = {}) {
  return {
    leaveRequestId: REQUEST_ID,
    recipientEmployeeId: LEAD_ID,
    kind: "shift_lead_approved",
    decision: "approved",
    ...overrides,
  };
}

function message(overrides = {}) {
  return {
    to: "lead@example.test",
    subject: "HR Hub: แจ้งทราบการลาที่ได้รับการอนุมัติ",
    text: "body",
    ...overrides,
  };
}

/**
 * Minimal queue table with the unique key applied. insertMany skips an existing
 * key, like PostgREST resolution=ignore-duplicates, and returns only new rows.
 */
function createQueueDb(initial = []) {
  const rows = initial.map((row) => ({ ...row }));
  let sequence = rows.length;
  const calls = [];

  return {
    rows,
    calls,
    async insertMany(table, list, options = {}) {
      calls.push({ method: "insertMany", table, options });
      assert.equal(table, DECISION_EMAIL_JOBS_TABLE);
      const inserted = [];
      for (const row of list) {
        const exists = rows.some(
          (item) =>
            item.leave_request_id === row.leave_request_id &&
            item.recipient_employee_id === row.recipient_employee_id &&
            item.kind === row.kind &&
            item.decision === row.decision
        );
        if (exists && options.ignoreDuplicates === true) continue;
        sequence += 1;
        const saved = { id: `job-${sequence}`, ...row };
        rows.push(saved);
        inserted.push(saved);
      }
      return { data: inserted, error: null };
    },
    async update(table, patch, filters = [], options = {}) {
      calls.push({ method: "update", table, patch, filters, options });
      const matched = rows.filter((row) =>
        filters.every(([column, op, value]) => {
          if (op === "eq") return row[column] === value;
          if (op === "is") return value === null ? row[column] == null : row[column] === value;
          return true;
        })
      );
      for (const row of matched) Object.assign(row, patch);
      return {
        data: options.returning ? matched.map((row) => ({ id: row.id })) : [],
        error: null,
      };
    },
  };
}

test("enqueuing the same key twice inserts and sends once", async () => {
  const db = createQueueDb();

  const first = await enqueueDecisionEmails(db, [job()]);
  const second = await enqueueDecisionEmails(db, [job()]);

  assert.equal(first.ok, true);
  assert.equal(first.data.length, 1);
  assert.equal(second.ok, true);
  assert.equal(second.data.length, 0);
  assert.equal(db.rows.length, 1);

  const sent = [];
  const sender = async (env, payload) => {
    sent.push(payload);
    return { ok: true };
  };

  const entries = first.data.map((row) => ({ row, message: message() }));
  await dispatchDecisionEmails({}, null, db, entries, { send: sender, wait: async () => {} });
  await dispatchDecisionEmails({}, null, db, second.data.map((row) => ({ row, message: message() })), {
    send: sender,
    wait: async () => {},
  });

  assert.equal(sent.length, 1);
  assert.equal(db.rows[0].status, "sent");
});

test("network and upstream are retried with the documented backoff", async () => {
  for (const reason of ["network", "upstream"]) {
    const attempts = [];
    const waits = [];
    const send = async () => {
      attempts.push(reason);
      return attempts.length === 1 ? { ok: false, reason } : { ok: true };
    };

    const result = await deliverDecisionEmail({}, message(), {
      send,
      wait: async (ms) => waits.push(ms),
      delays: [2000, 5000],
    });

    assert.equal(result.ok, true, reason);
    assert.equal(result.attempts, 2);
    assert.deepEqual(waits, [2000]);
  }
});

test("config and invalid are never retried", async () => {
  for (const reason of ["config", "invalid"]) {
    let calls = 0;
    const result = await deliverDecisionEmail({}, message(), {
      send: async () => {
        calls += 1;
        return { ok: false, reason };
      },
      wait: async () => {},
      delays: [2000, 5000],
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.attempts, 1);
    assert.equal(calls, 1);
  }
});

test("a retryable failure that exhausts its attempts is final and marked failed", async () => {
  const db = createQueueDb();
  const first = await enqueueDecisionEmails(db, [job()]);
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args);
  try {
    let calls = 0;
    await dispatchDecisionEmails({}, null, db, first.data.map((row) => ({ row, message: message() })), {
      send: async () => {
        calls += 1;
        return { ok: false, reason: "upstream" };
      },
      wait: async () => {},
      delays: [],
    });

    assert.equal(calls, 1);
    assert.equal(db.rows[0].status, "failed");
    assert.equal(db.rows[0].attempts, 1);
  } finally {
    console.error = original;
  }

  const text = JSON.stringify(logs);
  assert.equal(text.includes("lead@example.test"), false);
  assert.equal(text.includes("body"), false);
});

test("a claimed row is never sent by a second dispatch", async () => {
  const db = createQueueDb();
  const inserted = await enqueueDecisionEmails(db, [job()]);
  const row = inserted.data[0];
  const sent = [];

  // Simulate a row already claimed by another dispatch.
  await db.update(DECISION_EMAIL_JOBS_TABLE, { status: "sending" }, [["id", "eq", row.id]]);

  await dispatchDecisionEmails({}, null, db, [{ row, message: message() }], {
    send: async () => {
      sent.push(1);
      return { ok: true };
    },
    wait: async () => {},
  });

  assert.equal(sent.length, 0);
});
