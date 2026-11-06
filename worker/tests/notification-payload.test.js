// Notification payloads contain only fixed, privacy-safe text and one
// allowlisted route key. No database field becomes a URL or a visible detail.
import test from "node:test";
import assert from "node:assert/strict";

import {
  NOTIFICATION_KINDS,
  NOTIFICATION_ROUTES,
  buildNotificationPayload,
  buildSignedOutPendingPayload,
} from "../src/push/payload.js";

const REQUEST_KINDS = [
  NOTIFICATION_KINDS.SUBMITTED,
  NOTIFICATION_KINDS.DECIDED,
  NOTIFICATION_KINDS.BACKDATED,
];
const ALLOWED_ROUTES = new Set(Object.values(NOTIFICATION_ROUTES));

const FORBIDDEN = {
  employeeName: "สมชาย ใจดี",
  employeeCode: "EMP-999",
  department: "การเงิน",
  leaveType: "ลากิจ",
  date: "2026-11-10",
  reason: "ธุระส่วนตัว",
  nationalId: "1234567890123",
};

test("request notices use only the fixed strings and an allowlisted route", () => {
  for (const kind of REQUEST_KINDS) {
    const payload = buildNotificationPayload(kind);
    assert.equal(payload.title, "ระบบใบลา");
    assert.equal(
      payload.body,
      kind === NOTIFICATION_KINDS.SUBMITTED
        ? "มีรายการรออนุมัติใหม่ 1 รายการ"
        : "มีการอัปเดตใบลาของคุณ"
    );
    assert.equal(
      payload.route,
      kind === NOTIFICATION_KINDS.SUBMITTED
        ? NOTIFICATION_ROUTES.APPROVALS
        : NOTIFICATION_ROUTES.LEAVE
    );
    assert.equal(ALLOWED_ROUTES.has(payload.route), true);
    assert.deepEqual(Object.keys(payload).sort(), ["body", "kind", "route", "tag", "title"]);
  }
});

test("the signed-out notice carries only the recipient's own count", () => {
  const payload = buildSignedOutPendingPayload(3);
  assert.equal(payload.title, "ระบบใบลา");
  assert.equal(payload.body, "คุณมีรายการรออนุมัติ 3 รายการ");
  assert.equal(payload.route, NOTIFICATION_ROUTES.APPROVALS);
  assert.equal(ALLOWED_ROUTES.has(payload.route), true);
});

test("no payload leaks a name, code, department, leave type, date, reason or national ID", () => {
  const payloads = [
    ...REQUEST_KINDS.map((kind) => buildNotificationPayload(kind, FORBIDDEN)),
    buildSignedOutPendingPayload(2),
  ];

  for (const payload of payloads) {
    const text = JSON.stringify(payload);
    for (const [field, value] of Object.entries(FORBIDDEN)) {
      assert.equal(text.includes(value), false, `${field} value leaked`);
    }
    for (const field of Object.keys(FORBIDDEN)) {
      assert.equal(Object.hasOwn(payload, field), false, `${field} key leaked`);
    }
    assert.equal(/\d{4}-\d{2}-\d{2}/.test(text), false);
  }
});

test("unknown kinds produce no payload", () => {
  assert.equal(buildNotificationPayload("leave_reminder"), null);
  assert.equal(buildNotificationPayload(undefined), null);
});
