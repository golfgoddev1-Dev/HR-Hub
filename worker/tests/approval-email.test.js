// The approval email and its queue. Pure functions plus an injected sender, so
// no network call is made and no raw token is written anywhere.
import test from "node:test";
import assert from "node:assert/strict";

import {
  APPROVAL_EMAIL_BUTTON_HINT,
  APPROVAL_EMAIL_BUTTON_LABEL,
  APPROVAL_EMAIL_REASON_PREVIEW_LENGTH,
  APPROVAL_EMAIL_SUBJECT,
  APPROVAL_EMAIL_TRUNCATED_NOTICE,
  buildApprovalEmailMessage,
  buildApprovalEmailText,
  previewReason,
} from "../src/email/approval-email.js";
import {
  buildApprovalEmailJob,
  deliverApprovalEmail,
  dispatchApprovalEmails,
  emailRetryDecision,
  resetApprovalEmailState,
} from "../src/email/approval-queue.js";

const RAW = "T".repeat(43);
const LINK = `https://hr.example.test/approve/${RAW}`;
const EMPLOYEE_NAME = "สมชาย ใจดี";

const BASE = {
  employeeName: EMPLOYEE_NAME,
  employeeCode: "EMP-001",
  leaveTypeName: "ลากิจ",
  otherTypeDetail: null,
  startDate: "2026-11-10",
  endDate: "2026-11-11",
  days: 2,
  reason: "ไปธุระที่ต่างจังหวัด",
  link: LINK,
};

function job(overrides = {}) {
  return buildApprovalEmailJob({
    tokenId: "token-1",
    to: "approver@example.test",
    ...BASE,
    ...overrides,
  });
}

// --- content ---------------------------------------------------------------

test("the subject is the fixed generic line and the body holds the details", () => {
  const message = buildApprovalEmailMessage(BASE);
  assert.deepEqual(Object.keys(message).sort(), ["subject", "text"]);
  assert.equal(message.subject, "HR Hub: มีใบลารออนุมัติ");
  assert.equal(APPROVAL_EMAIL_SUBJECT, "HR Hub: มีใบลารออนุมัติ");

  // The employee name is only in the body.
  assert.equal(message.subject.includes(EMPLOYEE_NAME), false);
  assert.equal(message.text.includes(EMPLOYEE_NAME), true);

  assert.equal(message.text.includes("EMP-001"), true);
  assert.equal(message.text.includes("ลากิจ"), true);
  assert.equal(message.text.includes("2026-11-10"), true);
  assert.equal(message.text.includes("2026-11-11"), true);
  assert.equal(message.text.includes("2 วัน"), true);
  assert.equal(message.text.includes(BASE.reason), true);
  assert.equal(message.text.includes(APPROVAL_EMAIL_BUTTON_LABEL), true);
  assert.equal(message.text.includes(APPROVAL_EMAIL_BUTTON_HINT), true);
});

test("the body is plain text with exactly one link and no HTML", () => {
  const message = buildApprovalEmailMessage(BASE);

  assert.equal(message.text.split(LINK).length - 1, 1);
  assert.equal((message.text.match(/https?:\/\//g) ?? []).length, 1);
  assert.equal(message.text.includes("<"), false);
  assert.equal(message.text.includes(">"), false);
  assert.equal(/<\/?(a|br|div|p|html|body|table)\b/i.test(message.text), false);
  assert.equal(buildApprovalEmailMessage({ ...BASE, link: null }), null);
  assert.equal(buildApprovalEmailMessage({ ...BASE, link: "javascript:alert(1)" }), null);
});

test("another-type detail is shown beside the leave type", () => {
  const text = buildApprovalEmailText({ ...BASE, leaveTypeName: "อื่นๆ", otherTypeDetail: "งานส่วนตัว" });
  assert.equal(text.includes("อื่นๆ (งานส่วนตัว)"), true);
});

test("a reason that would overflow is cut to 1500 characters plus the notice", () => {
  const reason = "ก".repeat(4000);
  const text = buildApprovalEmailText({ ...BASE, reason });

  assert.equal(APPROVAL_EMAIL_REASON_PREVIEW_LENGTH, 1500);
  assert.ok(text.length <= 4000);
  assert.equal(text.includes("ก".repeat(1500)), true);
  assert.equal(text.includes("ก".repeat(1501)), false);
  assert.equal(text.includes(APPROVAL_EMAIL_TRUNCATED_NOTICE), true);
  assert.equal(text.includes(LINK), true);
  assert.equal(text.split(LINK).length - 1, 1);
  assert.equal(previewReason(reason), "ก".repeat(1500));
});

test("a reason under the limit is sent whole, with no notice", () => {
  const reason = "ข".repeat(1000);
  const text = buildApprovalEmailText({ ...BASE, reason });
  assert.ok(text.length <= 4000);
  assert.equal(text.includes(reason), true);
  assert.equal(text.includes(APPROVAL_EMAIL_TRUNCATED_NOTICE), false);
});

// --- queue -----------------------------------------------------------------

test("the job carries only the token id, recipient, subject and text", () => {
  const built = job();
  assert.deepEqual(Object.keys(built).sort(), ["subject", "text", "to", "tokenId"]);
  assert.equal(built.tokenId, "token-1");
  assert.equal(built.subject, APPROVAL_EMAIL_SUBJECT);
  assert.equal(buildApprovalEmailJob({ tokenId: "", to: "a@b.test", ...BASE }), null);
  assert.equal(buildApprovalEmailJob({ tokenId: "t", to: "  ", ...BASE }), null);
});

test("one email per token: a second delivery is skipped", async () => {
  resetApprovalEmailState();
  const sends = [];
  const send = async () => {
    sends.push(1);
    return { ok: true };
  };

  const first = await deliverApprovalEmail({}, job(), { send });
  const second = await deliverApprovalEmail({}, job(), { send });

  assert.equal(first.ok, true);
  assert.equal(first.attempts, 1);
  assert.equal(second.ok, true);
  assert.equal(second.skipped, true);
  assert.equal(sends.length, 1);
});

test("network and upstream are retried with backoff", async () => {
  resetApprovalEmailState();
  const failures = ["network", "upstream"];
  const sends = [];
  const waits = [];
  const send = async () => {
    sends.push(1);
    const reason = failures.shift();
    return reason ? { ok: false, reason } : { ok: true };
  };

  const result = await deliverApprovalEmail({}, job(), {
    send,
    wait: async (ms) => waits.push(ms),
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(sends.length, 3);
  assert.deepEqual(waits, [2000, 5000]);
});

test("a thrown sender is treated as a network failure", async () => {
  resetApprovalEmailState();
  let calls = 0;
  const result = await deliverApprovalEmail({}, job(), {
    send: async () => {
      calls += 1;
      throw new Error("offline");
    },
    wait: async () => {},
    delays: [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "network");
  assert.equal(calls, 1);
});

test("config and invalid are never retried", async () => {
  for (const reason of ["config", "invalid"]) {
    resetApprovalEmailState();
    let calls = 0;
    let waited = 0;

    const result = await deliverApprovalEmail({}, job(), {
      send: async () => {
        calls += 1;
        return { ok: false, reason };
      },
      wait: async () => {
        waited += 1;
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(calls, 1, reason);
    assert.equal(waited, 0, reason);

    // A later dispatch must not turn a permanent failure into a duplicate.
    const again = await deliverApprovalEmail({}, job(), {
      send: async () => {
        calls += 1;
        return { ok: true };
      },
    });
    assert.equal(again.skipped, true);
    assert.equal(calls, 1, reason);
  }

  assert.equal(emailRetryDecision("network"), "retry");
  assert.equal(emailRetryDecision("upstream"), "retry");
  assert.equal(emailRetryDecision("config"), "drop");
  assert.equal(emailRetryDecision("invalid"), "drop");
});

test("dispatch runs through waitUntil, or inline with no context", async () => {
  resetApprovalEmailState();
  const sent = [];
  let pending = null;
  const ctx = {
    waitUntil(promise) {
      pending = promise;
    },
  };

  const handled = await dispatchApprovalEmails({}, ctx, [job()], {
    send: async () => {
      sent.push(1);
      return { ok: true };
    },
  });

  assert.equal(handled, true);
  assert.ok(pending instanceof Promise);
  await pending;
  assert.equal(sent.length, 1);

  resetApprovalEmailState();
  const inline = [];
  await dispatchApprovalEmails({}, null, [job()], {
    send: async () => {
      inline.push(1);
      return { ok: true };
    },
  });
  assert.equal(inline.length, 1);
  assert.equal(await dispatchApprovalEmails({}, null, []), false);
});
