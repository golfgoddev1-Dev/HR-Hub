// The approver's pending total travels with the notification as one integer
// field, so the service worker can set the app icon badge while the app is
// closed. The count is the recipient's own queue, the same one the approvals
// count endpoint answers, and it is the only new field: no name, code, leave
// type, date, reason or request id may appear.
import test from "node:test";
import assert from "node:assert/strict";

import {
  NOTIFICATION_KINDS,
  NOTIFICATION_ROUTES,
  buildNotificationPayload,
  buildSignedOutPendingPayload,
} from "../src/push/payload.js";
import { enqueueNotification } from "../src/push/queue.js";

const APPROVER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-06T03:00:00.000Z");
const BASE_KEYS = ["body", "kind", "route", "tag", "title"];

/**
 * A queue database with just what enqueueNotification reads: the two approver
 * lists (isActiveApprover), the recipient's own pending count, and the insert.
 */
function queueDb({ approver, pending }) {
  const rows = [];
  const countCalls = [];
  return {
    rows,
    countCalls,
    async select() {
      return approver ? { id: "approver-row" } : null;
    },
    async count(table, { filters }) {
      countCalls.push({ table, filters });
      return pending;
    },
    async insert(table, row) {
      rows.push({ table, row });
      return { data: { id: "queue-1" } };
    },
  };
}

async function submittedPayload(options) {
  const db = queueDb(options);
  const result = await enqueueNotification(db, {
    employeeId: APPROVER_ID,
    kind: NOTIFICATION_KINDS.SUBMITTED,
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(db.rows.length, 1);
  return { payload: db.rows[0].row.payload, db };
}

test("the new-request payload for an approver carries that approver's own pending total", async () => {
  const { payload, db } = await submittedPayload({ approver: true, pending: 3 });

  assert.equal(payload.count, 3);
  // The fixed fields are unchanged; count is the only addition.
  assert.deepEqual(Object.keys(payload).sort(), [...BASE_KEYS, "count"].sort());
  assert.equal(payload.title, "ระบบใบลา");
  assert.equal(payload.body, "มีรายการรออนุมัติใหม่ 1 รายการ");
  assert.equal(payload.route, NOTIFICATION_ROUTES.APPROVALS);
  assert.equal(payload.tag, "leave-submitted");
  assert.equal(payload.kind, NOTIFICATION_KINDS.SUBMITTED);

  // The count is this recipient's pending queue, not another employee's.
  assert.equal(db.countCalls.length, 1);
  assert.equal(db.countCalls[0].table, "leave_requests");
  assert.deepEqual(db.countCalls[0].filters, [
    ["approver_id", "eq", APPROVER_ID],
    ["status", "eq", "pending"],
  ]);
});

test("a non-approver payload has no count field", async () => {
  const { payload, db } = await submittedPayload({ approver: false, pending: 0 });

  assert.equal(Object.hasOwn(payload, "count"), false);
  assert.deepEqual(Object.keys(payload).sort(), BASE_KEYS);
  assert.equal(db.countCalls.length, 0);
});

test("the signed-out count notice carries the recipient's pending total", () => {
  const payload = buildSignedOutPendingPayload(4);

  assert.equal(payload.count, 4);
  assert.equal(payload.body, "คุณมีรายการรออนุมัติ 4 รายการ");
  assert.equal(payload.route, NOTIFICATION_ROUTES.APPROVALS);
  assert.equal(payload.kind, NOTIFICATION_KINDS.PENDING_SIGNED_OUT);
  assert.deepEqual(Object.keys(payload).sort(), [...BASE_KEYS, "count"].sort());
});

test("no payload carries a name, code, leave type, date, reason or request id", async () => {
  const { payload } = await submittedPayload({ approver: true, pending: 2 });
  const payloads = [payload, buildSignedOutPendingPayload(2)];

  for (const item of payloads) {
    const text = JSON.stringify(item);
    for (const value of [
      "สมชาย ใจดี",
      "EMP-999",
      "การเงิน",
      "ลากิจ",
      "2026-11-10",
      "ธุระส่วนตัว",
      "1234567890123",
      "LV-2026110",
    ]) {
      assert.equal(text.includes(value), false, value);
    }
    for (const key of [
      "employeeName",
      "employeeCode",
      "department",
      "leaveType",
      "date",
      "reason",
      "requestId",
      "id",
    ]) {
      assert.equal(Object.hasOwn(item, key), false, key);
    }
    assert.equal(/\d{4}-\d{2}-\d{2}/.test(text), false);
  }
});
