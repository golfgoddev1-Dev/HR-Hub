// The decision hook: approve queues one email per active shift lead plus the
// employee report; reject queues only the leads, with the rejection reason. The
// table's unique key makes a repeat hook a no-op, and a queue failure is
// swallowed so the decision response can never change.

import test from "node:test";
import assert from "node:assert/strict";

import {
  notifyLeaveDecision,
  notifyLeaveDecisionSafely,
} from "../src/decision-notify.js";
import { DECISION_EMAIL_SUBJECTS } from "../src/email/decision-email.js";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const REQUESTER_ID = "22222222-2222-4222-8222-222222222222";
const APPROVER_ID = "33333333-3333-4333-8333-333333333333";
const LEAD1_ID = "44444444-4444-4444-8444-444444444444";
const LEAD2_ID = "55555555-5555-4555-8555-555555555555";
const LEAD3_ID = "66666666-6666-4666-8666-666666666666";
const LEAD4_ID = "77777777-7777-4777-8777-777777777777";
const DEPT_ID = "88888888-8888-4888-8888-888888888888";
const TYPE_ID = "99999999-9999-4999-8999-999999999999";

const REASON = "ไปธุระที่ต่างจังหวัด";
const NOTE = "ช่วงนี้คนขาด";
const REQUESTER_NAME = "สมชาย ใจดี";
const APPROVER_NAME = "ผู้อนุมัติ ทดสอบ";
const LEAD_EMAIL = "lead@example.test";

const ENV = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycb-test/exec",
  MAIL_RELAY_SECRET: "s".repeat(32),
  APP_PUBLIC_URL: "https://hr.example.test",
};

function matches(row, filters = []) {
  return filters.every(([column, op, value]) => {
    const actual = row[column];
    if (op === "eq") return actual === value;
    if (op === "in") return Array.isArray(value) && value.includes(actual);
    if (op === "is") return value === null ? actual == null : actual === value;
    if (op === "not.is") return value === null ? actual != null : actual !== value;
    return true;
  });
}

function createState(decision = "approved") {
  return {
    failJobs: false,
    employees: [
      {
        id: REQUESTER_ID,
        employee_code: "EMP-001",
        name_prefix: "นาย",
        full_name: REQUESTER_NAME,
        email: "requester@example.test",
        department_id: DEPT_ID,
        is_active: true,
      },
      {
        id: APPROVER_ID,
        employee_code: "EMP-002",
        name_prefix: "นาง",
        full_name: APPROVER_NAME,
        email: "approver@example.test",
        department_id: DEPT_ID,
        is_active: true,
      },
      {
        id: LEAD1_ID,
        employee_code: "EMP-010",
        name_prefix: "นาย",
        full_name: "หัวหน้า กะ A",
        email: LEAD_EMAIL,
        department_id: DEPT_ID,
        is_active: true,
      },
      {
        id: LEAD2_ID,
        employee_code: "EMP-011",
        name_prefix: "นาง",
        full_name: "หัวหน้า กะ B",
        email: "lead2@example.test",
        department_id: DEPT_ID,
        is_active: true,
      },
      {
        id: LEAD3_ID,
        employee_code: "EMP-012",
        name_prefix: "นาย",
        full_name: "หัวหน้า ปิดใช้งาน",
        email: "lead3@example.test",
        department_id: DEPT_ID,
        is_active: false,
      },
      {
        id: LEAD4_ID,
        employee_code: "EMP-013",
        name_prefix: "นาย",
        full_name: "หัวหน้า ไม่มีอีเมล",
        email: "",
        department_id: DEPT_ID,
        is_active: true,
      },
    ],
    departments: [{ id: DEPT_ID, name: "ฝ่ายบุคคล" }],
    leave_types: [{ id: TYPE_ID, name: "ลากิจ" }],
    department_shift_leads: [
      { id: "sl-1", department_id: DEPT_ID, employee_id: LEAD1_ID, shift_label: "กะ A" },
      { id: "sl-2", department_id: DEPT_ID, employee_id: LEAD2_ID, shift_label: "กะ B" },
      { id: "sl-3", department_id: DEPT_ID, employee_id: LEAD3_ID, shift_label: "กะ C" },
      { id: "sl-4", department_id: DEPT_ID, employee_id: LEAD4_ID, shift_label: "กะ D" },
    ],
    leave_requests: [
      {
        id: REQUEST_ID,
        request_code: "LV-20261109-001",
        employee_id: REQUESTER_ID,
        approver_id: APPROVER_ID,
        leave_type_id: TYPE_ID,
        other_type_detail: null,
        start_date: "2026-11-10",
        end_date: "2026-11-11",
        days: 2,
        return_date: "2026-11-12",
        return_time: "08:00",
        status: decision,
        ot_option: "ไม่ OT",
        shift_option_code: "DAY_FULL",
        reason: REASON,
        has_medical_certificate: true,
        decision_note: decision === "rejected" ? NOTE : null,
        decided_at: "2026-11-09T03:00:00.000Z",
      },
    ],
    decision_email_jobs: [],
  };
}

function createDb(state) {
  let sequence = 0;

  return {
    async select(table, { columns = "*", filters = [], single = false, order, limit } = {}) {
      let rows = (state[table] ?? []).filter((row) => matches(row, filters));
      if (typeof order === "string") {
        const [column, direction] = order.split(".");
        rows = [...rows].sort(
          (left, right) =>
            String(left[column] ?? "").localeCompare(String(right[column] ?? "")) *
            (direction === "desc" ? -1 : 1)
        );
      }
      if (typeof limit === "number") rows = rows.slice(0, limit);

      const data = rows.map((row) => {
        if (columns === "*") return { ...row };
        const picked = {};
        for (const key of columns.split(",").map((value) => value.trim())) picked[key] = row[key];
        return picked;
      });
      return single ? data[0] ?? null : data;
    },

    async insertMany(table, list, { returning = false, ignoreDuplicates = false } = {}) {
      if (table === "decision_email_jobs" && state.failJobs) {
        throw Object.assign(new Error("queue down"), { code: "XX000" });
      }

      const inserted = [];
      for (const row of list) {
        if (
          ignoreDuplicates &&
          state[table].some(
            (item) =>
              item.leave_request_id === row.leave_request_id &&
              item.recipient_employee_id === row.recipient_employee_id &&
              item.kind === row.kind &&
              item.decision === row.decision
          )
        ) {
          continue;
        }
        sequence += 1;
        const saved = { id: `job-${sequence}`, ...row };
        state[table].push(saved);
        inserted.push(saved);
      }
      return { data: returning ? inserted : [], error: null };
    },

    async update(table, patch, filters = [], { returning = false } = {}) {
      const matched = state[table].filter((row) => matches(row, filters));
      for (const row of matched) Object.assign(row, patch);
      return { data: returning ? matched.map((row) => ({ id: row.id })) : [], error: null };
    },
  };
}

function installRelay(t) {
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return sent;
}

test("approve queues two active shift leads and one employee report", async (t) => {
  const state = createState("approved");
  const db = createDb(state);
  const sent = installRelay(t);

  const result = await notifyLeaveDecision(ENV, db, null, {
    leaveRequestId: REQUEST_ID,
    decision: "approved",
  });

  assert.equal(result.ok, true);
  assert.equal(result.queued, 3);
  assert.equal(sent.length, 3);
  assert.equal(
    state.decision_email_jobs.filter((row) => row.status === "sent").length,
    3
  );

  const subjects = sent.map((message) => message.subject);
  assert.equal(
    subjects.filter((subject) => subject === DECISION_EMAIL_SUBJECTS.shift_lead_approved)
      .length,
    2
  );
  assert.equal(
    subjects.filter((subject) => subject === DECISION_EMAIL_SUBJECTS.employee_approved)
      .length,
    1
  );

  const employeeMessage = sent.find(
    (message) => message.subject === DECISION_EMAIL_SUBJECTS.employee_approved
  );
  assert.equal(employeeMessage.to, "requester@example.test");
  assert.equal(employeeMessage.text.includes(APPROVER_NAME), true);
  assert.equal(employeeMessage.text.includes("https://hr.example.test/login"), true);

  for (const message of sent) {
    assert.equal(message.text.includes("/approve/"), false);
    assert.equal((message.text.match(/https?:\/\//g) ?? []).length, 1);
  }

  // No inactive lead and no lead without an address is emailed.
  const recipients = sent.map((message) => message.to).sort();
  assert.deepEqual(recipients, ["lead2@example.test", LEAD_EMAIL, "requester@example.test"]);

  // The employee report is the only one naming the approver.
  for (const message of sent) {
    if (message.subject === DECISION_EMAIL_SUBJECTS.shift_lead_approved) {
      assert.equal(message.text.includes(APPROVER_NAME), false);
    }
  }
});

test("reject queues the shift leads with the reason and no employee email", async (t) => {
  const state = createState("rejected");
  const db = createDb(state);
  const sent = installRelay(t);

  const result = await notifyLeaveDecision(ENV, db, null, {
    leaveRequestId: REQUEST_ID,
    decision: "rejected",
  });

  assert.equal(result.ok, true);
  assert.equal(result.queued, 2);
  assert.equal(sent.length, 2);
  assert.equal(
    sent.some(
      (message) => message.subject === DECISION_EMAIL_SUBJECTS.employee_approved
    ),
    false
  );
  assert.equal(
    state.decision_email_jobs.some((row) => row.kind === "employee_approved"),
    false
  );
  for (const message of sent) {
    assert.equal(message.subject, DECISION_EMAIL_SUBJECTS.shift_lead_rejected);
    assert.equal(message.text.includes(`เหตุผลที่ไม่อนุมัติ: ${NOTE}`), true);
  }
});

test("a repeated hook inserts nothing and sends nothing", async (t) => {
  const state = createState("approved");
  const db = createDb(state);
  const sent = installRelay(t);

  const first = await notifyLeaveDecision(ENV, db, null, {
    leaveRequestId: REQUEST_ID,
    decision: "approved",
  });
  const second = await notifyLeaveDecision(ENV, db, null, {
    leaveRequestId: REQUEST_ID,
    decision: "approved",
  });

  assert.equal(first.queued, 3);
  assert.equal(second.queued, 0);
  assert.equal(second.duplicate, true);
  assert.equal(sent.length, 3);
  assert.equal(state.decision_email_jobs.length, 3);
});

test("a queue failure never throws and logs no personal data", async (t) => {
  const state = createState("approved");
  state.failJobs = true;
  const db = createDb(state);
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args);
  t.after(() => {
    console.error = original;
  });

  const result = await notifyLeaveDecisionSafely(ENV, db, null, {
    leaveRequestId: REQUEST_ID,
    decision: "approved",
  });

  assert.equal(result.ok, false);
  const text = JSON.stringify(logs);
  for (const forbidden of [
    REQUESTER_NAME,
    APPROVER_NAME,
    "requester@example.test",
    LEAD_EMAIL,
    REASON,
    NOTE,
    "https://hr.example.test",
  ]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test("a decision that is not the stored status queues nothing", async (t) => {
  const state = createState("rejected");
  const db = createDb(state);
  const sent = installRelay(t);

  const result = await notifyLeaveDecision(ENV, db, null, {
    leaveRequestId: REQUEST_ID,
    decision: "approved",
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "not_decided");
  assert.equal(sent.length, 0);
});
