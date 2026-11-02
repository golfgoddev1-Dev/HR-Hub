import test from "node:test";
import assert from "node:assert/strict";

import {
  DECISION_JOIN,
  buildBackfillPlan,
  normalizeClock,
  roundKeyOf,
} from "../src/import/backfill/plan.js";

const TYPES = [
  { id: "type-sup", code: "sup", name: "ประชุมหัวหน้างาน" },
  { id: "type-monthly", code: "monthly", name: "ประชุม Monthly" },
];

const EMPLOYEES = [
  { id: "emp-1", full_name: "นาย สมชาย ทดสอบ", name_prefix: "นาย" },
  { id: "emp-2", full_name: "นาง สมหญิง ทดสอบ", name_prefix: "นาง" },
  { id: "emp-3", full_name: "นาย ซ้ำ ชื่อ", name_prefix: "นาย" },
  { id: "emp-4", full_name: "นาย ซ้ำ ชื่อ", name_prefix: "นาย" },
];

function row(rowNumber, cells) {
  return { rowNumber, cells };
}

const HEAD = (overrides = {}) => [
  overrides.type ?? "ประชุมหัวหน้างาน",
  overrides.date ?? "01/10/2026",
  overrides.time ?? "09:00",
  overrides.location ?? "ห้องประชุม A",
  overrides.name ?? "นาย สมชาย ทดสอบ",
  overrides.status ?? "เข้าร่วมประชุม",
  overrides.shift ?? "",
  "",
  "",
  "",
  "",
  overrides.reason ?? "",
];

function plan(rows, options = {}) {
  return buildBackfillPlan({
    rows,
    meetingTypes: TYPES,
    employees: EMPLOYEES,
    sessions: options.sessions ?? [],
    recorded: options.recorded ?? new Set(),
    decisions: options.decisions ?? new Map(),
  });
}

test("normalizeClock keeps HH:mm from text and time values", () => {
  assert.equal(normalizeClock("09:30"), "09:30");
  assert.equal(normalizeClock("09:30:00"), "09:30");
  assert.equal(normalizeClock(""), "");
  assert.equal(normalizeClock(null), "");
});

test("a new round is planned with status and shift counts", () => {
  const result = plan([
    row(2, HEAD()),
    row(3, HEAD({ name: "นาง สมหญิง ทดสอบ", status: "ลาประชุม", shift: "กะ A", reason: "ลาป่วย" })),
    row(4, HEAD({ name: "นาง สมหญิง ทดสอบ", status: "ติดงานด่วน", reason: "งานด่วน" })),
  ]);

  assert.equal(result.summary.rounds, 1);
  assert.equal(result.summary.newRounds, 1);
  const round = result.rounds[0];
  assert.equal(round.mode, "new");
  assert.equal(round.rows, 2, "the repeated employee is skipped inside one round");
  assert.equal(round.statusCounts.attended, 1);
  assert.equal(round.statusCounts.leave, 1);
  assert.equal(round.shiftCounts["กะ A"], 1);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /ซ้ำในรอบเดียวกัน/);
});

test("an empty location is accepted and stored as an empty round location", () => {
  const result = plan([row(2, HEAD({ location: "" }))]);
  assert.equal(result.summary.newRounds, 1);
  assert.equal(result.rounds[0].location, "");
  assert.equal(result.skipped.length, 0);
});

test("an empty time is skipped with the time reason", () => {
  const result = plan([row(2, HEAD({ time: "" }))]);
  assert.equal(result.summary.writeRows, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /ต้องระบุเวลา/);
});

test("an existing session with the same time and location is reused", () => {
  const result = plan([row(2, HEAD())], {
    sessions: [
      {
        id: "session-1",
        meeting_type_id: "type-sup",
        session_date: "2026-10-01",
        session_time: "09:00",
        location: "ห้องประชุม A",
      },
    ],
  });

  assert.equal(result.summary.existingRounds, 1);
  assert.equal(result.rounds[0].mode, "existing");
  assert.equal(result.rounds[0].sessionId, "session-1");
});

test("a file round at another time becomes its own round on the same day", () => {
  const sessions = [
    {
      id: "session-1",
      meeting_type_id: "type-sup",
      session_date: "2026-10-01",
      session_time: "10:00",
      location: "ห้องประชุม A",
    },
  ];

  const result = plan([row(2, HEAD())], { sessions });
  assert.equal(result.rounds.length, 1);
  assert.equal(result.rounds[0].mode, "new");
  assert.equal(result.summary.newRounds, 1);
  assert.equal(result.summary.needsDecision, 0);
  assert.equal(result.summary.writeRows, 1);
});

test("a different location alone is a conflict", () => {
  const result = plan([row(2, HEAD())], {
    sessions: [
      {
        id: "session-1",
        meeting_type_id: "type-sup",
        session_date: "2026-10-01",
        session_time: "09:00",
        location: "ห้องประชุม B",
      },
    ],
  });
  assert.equal(result.rounds[0].mode, "conflict");
});

test("a person already recorded in the reused session is skipped", () => {
  const result = plan([row(2, HEAD())], {
    sessions: [
      {
        id: "session-1",
        meeting_type_id: "type-sup",
        session_date: "2026-10-01",
        session_time: "09:00",
        location: "ห้องประชุม A",
      },
    ],
    recorded: new Set(["session-1:emp-1"]),
  });

  assert.equal(result.summary.writeRows, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /มีข้อมูลของคนนี้ในรอบนี้แล้ว/);
});

test("several times on the same type and date yield several rounds", () => {
  const result = plan([
    row(2, HEAD({ time: "09:00" })),
    row(3, HEAD({ time: "13:00" })),
  ]);

  assert.equal(result.summary.rounds, 2);
  assert.equal(result.summary.newRounds, 2);
  assert.equal(result.summary.writeRows, 2);
  assert.equal(result.summary.needsDecision, 0);
  assert.deepEqual(result.rounds.map((round) => round.time), ["09:00", "13:00"]);
});

test("unknown meeting type, unknown name and ambiguous name are skipped", () => {
  const result = plan([
    row(2, HEAD({ type: "ประชุมอื่น" })),
    row(3, HEAD({ name: "นาย ไม่มี อยู่จริง" })),
    row(4, HEAD({ name: "นาย ซ้ำ ชื่อ" })),
  ]);

  assert.equal(result.summary.writeRows, 0);
  assert.equal(result.skipped.length, 3);
  assert.match(result.skipped[0].reason, /ไม่พบประเภทการประชุม/);
  assert.match(result.skipped[1].reason, /ไม่พบชื่อพนักงาน/);
  assert.match(result.skipped[2].reason, /มากกว่า 1 คน/);
});

test("a name without the leading prefix still matches one employee", () => {
  const result = plan([row(2, HEAD({ name: "สมชาย ทดสอบ" }))]);
  assert.equal(result.summary.writeRows, 1);
  assert.equal(result.rounds[0].entries[0].employeeId, "emp-1");
});

test("the shift is refused for a status that is not ลาประชุม", () => {
  const result = plan([row(2, HEAD({ shift: "A" }))]);
  assert.equal(result.summary.writeRows, 0);
  assert.match(result.skipped[0].reason, /ไม่ต้องระบุกะ/);
});

test("the accepted type aliases import into the stored meeting type", () => {
  const sup = plan([row(2, HEAD({ type: "หัวหน้างาน" }))]);
  assert.equal(sup.summary.writeRows, 1);
  assert.equal(sup.rounds[0].typeCode, "sup");
  assert.equal(sup.rounds[0].typeName, "ประชุมหัวหน้างาน");

  const monthly = plan([row(2, HEAD({ type: "Monthly" }))]);
  assert.equal(monthly.summary.writeRows, 1);
  assert.equal(monthly.rounds[0].typeCode, "monthly");
  assert.equal(monthly.rounds[0].typeName, "ประชุม Monthly");
});

test("a name outside the accepted table is still skipped", () => {
  const result = plan([row(2, HEAD({ type: "ประชุมพิเศษ" }))]);
  assert.equal(result.summary.writeRows, 0);
  assert.match(result.skipped[0].reason, /ไม่พบประเภทการประชุม/);
});
