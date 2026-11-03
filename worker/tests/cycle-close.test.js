import test from "node:test";
import assert from "node:assert/strict";

import {
  absentRows,
  closeAuditDetail,
  closeCycle,
  isCloseCycleBody,
  isCutoffPassed,
  missingEmployeeIds,
} from "../src/cycle-close.js";

// Tuesday 10 November 2026, 10:00 Asia/Bangkok.
const NOW = new Date("2026-11-10T03:00:00.000Z");
const TODAY = "2026-11-10";

const ROSTER = [
  { employeeId: "emp-a", departmentId: "dept-1", positionId: "pos-1" },
  { employeeId: "emp-b", departmentId: "dept-1", positionId: "pos-2" },
  { employeeId: "emp-c", departmentId: "dept-2", positionId: null },
];

const SESSION = {
  id: "session-1",
  session_date: "2026-11-03",
  meeting_type_id: "type-sup",
  cutoff_time: "12:00",
};

/** Wires closeCycle to in-memory loaders and records every write. */
function harness({ sessions = [SESSION], roster = ROSTER, existing = [], failWith = null } = {}) {
  const inserts = [];
  const audits = [];
  const calls = { sessions: 0, roster: 0, attendance: 0 };

  async function run(body, now = NOW) {
    return closeCycle({
      body,
      now,
      actorId: "actor-1",
      loadSessions: async (args) => {
        calls.sessions += 1;
        if (failWith) throw failWith;
        return typeof sessions === "function" ? sessions(args) : sessions;
      },
      loadRoster: async () => {
        calls.roster += 1;
        return roster;
      },
      loadAttendance: async () => {
        calls.attendance += 1;
        return existing;
      },
      insertAbsent: async (rows) => {
        inserts.push(rows);
        return rows.length;
      },
      writeAudit: async (args) => {
        audits.push(args);
      },
    });
  }

  return { run, inserts, audits, calls };
}

const VALID_BODY = { code: "sup", cycle: "2026-11-03" };

test("close-cycle: the cutoff is compared in Asia/Bangkok", () => {
  assert.equal(isCutoffPassed({ now: NOW, sessionDate: TODAY, cutoffTime: "12:00" }), false);
  assert.equal(isCutoffPassed({ now: NOW, sessionDate: TODAY, cutoffTime: "10:00" }), true);
  assert.equal(isCutoffPassed({ now: NOW, sessionDate: TODAY, cutoffTime: "10:01" }), false);
  assert.equal(isCutoffPassed({ now: NOW, sessionDate: "2026-11-09", cutoffTime: "23:59" }), true);
  assert.equal(isCutoffPassed({ now: NOW, sessionDate: "2026-11-11", cutoffTime: "00:01" }), false);
  // 2026-11-10T17:30Z is already 00:30 on 11 November in Bangkok.
  const lateUtc = new Date("2026-11-10T17:30:00.000Z");
  assert.equal(isCutoffPassed({ now: lateUtc, sessionDate: TODAY, cutoffTime: "23:00" }), true);
  assert.equal(isCutoffPassed({ now: NOW, sessionDate: TODAY, cutoffTime: null }), null);
  assert.equal(isCutoffPassed({ now: NOW, sessionDate: "10/11/2026", cutoffTime: "12:00" }), null);
});

test("close-cycle: missing members keep roster order and skip existing rows", () => {
  assert.deepEqual(missingEmployeeIds(["a", "b", "c"], ["b"]), ["a", "c"]);
  assert.deepEqual(missingEmployeeIds(["a", "", null, "a", "b"], []), ["a", "b"]);
});

test("close-cycle: the strict body is exactly { code, cycle }", () => {
  assert.equal(isCloseCycleBody({ code: "sup", cycle: "2026-11-03" }), true);
  assert.equal(isCloseCycleBody({ code: "monthly", cycle: "2026-11" }), true);
  assert.equal(isCloseCycleBody({ code: "sup", cycle: "2026-11-03", extra: 1 }), false);
  assert.equal(isCloseCycleBody({ code: "sup" }), false);
  assert.equal(isCloseCycleBody({ code: "hr", cycle: "2026-11-03" }), false);
  // The /registrants cycle form allows a month key for either code; a sup month
  // key simply finds no session and answers 404.
  assert.equal(isCloseCycleBody({ code: "sup", cycle: "2026-11" }), true);
  assert.equal(isCloseCycleBody(null), false);
});

test("close-cycle: absent rows carry no reason, no shift and the click time", () => {
  const rows = absentRows(["emp-a", "emp-c"], {
    sessionId: "session-1",
    registeredAt: NOW.toISOString(),
    memberById: new Map(ROSTER.map((member) => [member.employeeId, member])),
  });
  assert.deepEqual(rows, [
    {
      session_id: "session-1",
      employee_id: "emp-a",
      status_code: "not_attended",
      reason: null,
      shift: null,
      department_id: "dept-1",
      position_id: "pos-1",
      registered_at: "2026-11-10T03:00:00.000Z",
    },
    {
      session_id: "session-1",
      employee_id: "emp-c",
      status_code: "not_attended",
      reason: null,
      shift: null,
      department_id: "dept-2",
      position_id: null,
      registered_at: "2026-11-10T03:00:00.000Z",
    },
  ]);
});

test("close-cycle: the audit detail is a count only", () => {
  assert.equal(closeAuditDetail(3), '{"inserted":3}');
  assert.equal(closeAuditDetail(undefined), '{"inserted":0}');
});

test("close-cycle: inserts only the roster members with no row, then audits once", async () => {
  const store = harness({ existing: [{ employee_id: "emp-b" }] });
  const outcome = await store.run(VALID_BODY);

  assert.deepEqual(outcome, { status: 200, body: { ok: true, inserted: 2 } });
  assert.equal(store.inserts.length, 1);
  assert.deepEqual(store.inserts[0].map((row) => row.employee_id), ["emp-a", "emp-c"]);
  assert.deepEqual(store.audits, [
    { actorId: "actor-1", entityId: "session-1", detail: '{"inserted":2}' },
  ]);
});

test("close-cycle: a second click inserts 0 rows and writes no attendance", async () => {
  const store = harness({
    existing: [{ employee_id: "emp-a" }, { employee_id: "emp-b" }, { employee_id: "emp-c" }],
  });
  const outcome = await store.run(VALID_BODY);

  assert.deepEqual(outcome, { status: 200, body: { ok: true, inserted: 0 } });
  assert.equal(store.inserts.length, 0);
  assert.equal(store.audits.length, 1);
  assert.equal(store.audits[0].detail, '{"inserted":0}');
});

test("close-cycle: before the cutoff answers 400 and writes nothing", async () => {
  const store = harness({
    sessions: [{ ...SESSION, session_date: TODAY, cutoff_time: "12:00" }],
  });
  const outcome = await store.run({ code: "sup", cycle: TODAY });

  assert.deepEqual(outcome, {
    status: 400,
    body: { ok: false, message: "ยังไม่ถึงเวลาปิดลงทะเบียน" },
  });
  assert.equal(store.inserts.length, 0);
  assert.equal(store.audits.length, 0);
});

test("close-cycle: no session for the cycle answers 404", async () => {
  const store = harness({ sessions: [] });
  const outcome = await store.run(VALID_BODY);

  assert.deepEqual(outcome, { status: 404, body: { ok: false, message: "ไม่พบรอบประชุมนี้" } });
  assert.equal(store.inserts.length, 0);
});

test("close-cycle: several sessions in one cycle are refused", async () => {
  const store = harness({ sessions: [SESSION, { ...SESSION, id: "session-2" }] });
  const outcome = await store.run({ code: "monthly", cycle: "2026-11" });

  assert.deepEqual(outcome, { status: 400, body: { ok: false, message: "ข้อมูลไม่ถูกต้อง" } });
  assert.equal(store.inserts.length, 0);
});

test("close-cycle: an unusable cutoff time is a 400, not a late close", async () => {
  const store = harness({ sessions: [{ ...SESSION, cutoff_time: "" }] });
  const outcome = await store.run(VALID_BODY);

  assert.deepEqual(outcome, { status: 400, body: { ok: false, message: "ข้อมูลไม่ถูกต้อง" } });
  assert.equal(store.inserts.length, 0);
});

test("close-cycle: a read failure answers 500 with the Thai server message", async () => {
  const store = harness({ failWith: Object.assign(new Error("boom"), { code: "fake" }) });
  const outcome = await store.run(VALID_BODY);

  assert.deepEqual(outcome, {
    status: 500,
    body: { ok: false, message: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง" },
  });
});

test("close-cycle: the body is validated before any read", async () => {
  const store = harness();
  for (const body of [null, {}, { code: "sup", cycle: "bad" }]) {
    const outcome = await store.run(body);
    assert.deepEqual(outcome, { status: 400, body: { ok: false, message: "ข้อมูลไม่ถูกต้อง" } });
  }
  assert.deepEqual(store.calls, { sessions: 0, roster: 0, attendance: 0 });
});
