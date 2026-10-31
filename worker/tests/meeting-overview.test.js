import test from "node:test";
import assert from "node:assert/strict";

import {
  countByStatus,
  findPending,
  formatDateText,
  sessionPhase,
  todayOf,
  weekdayOf,
} from "../src/meeting-overview.js";

// Frozen Bangkok Monday 2026-01-05, 10:00 (03:00Z).
const NOW = new Date(1767582000000);

// --- countByStatus ------------------------------------------------------------

test("countByStatus counts each known status and the total", () => {
  const rows = [
    { status_code: "attended" },
    { status_code: "attended" },
    { status_code: "not_attended" },
    { status_code: "urgent_busy" },
    { status_code: "leave" },
  ];
  assert.deepEqual(countByStatus(rows), {
    attended: 2,
    not_attended: 1,
    urgent_busy: 1,
    leave: 1,
    total: 5,
  });
});

test("countByStatus counts every row of the session, not latest per employee", () => {
  // Two rows for the same employee still count both, like the Express helper.
  const rows = [
    { employee_id: "e1", status_code: "attended" },
    { employee_id: "e1", status_code: "leave" },
  ];
  const counts = countByStatus(rows);
  assert.equal(counts.total, 2);
  assert.equal(counts.attended, 1);
  assert.equal(counts.leave, 1);
});

test("countByStatus keeps the total exact for unknown codes and skips unusable rows", () => {
  const counts = countByStatus([
    { status_code: "unknown_code" },
    { status_code: "" },
    { status_code: null },
    {},
    null,
  ]);
  assert.equal(counts.total, 1);
  assert.deepEqual(
    { attended: counts.attended, not_attended: counts.not_attended, urgent_busy: counts.urgent_busy, leave: counts.leave },
    { attended: 0, not_attended: 0, urgent_busy: 0, leave: 0 }
  );
  assert.deepEqual(countByStatus([]), { attended: 0, not_attended: 0, urgent_busy: 0, leave: 0, total: 0 });
  assert.deepEqual(countByStatus(), { attended: 0, not_attended: 0, urgent_busy: 0, leave: 0, total: 0 });
});

// --- sessionPhase -------------------------------------------------------------

test("sessionPhase is not_open before the open time on the Bangkok clock", () => {
  // 02:00Z = 09:00 Bangkok; open 09:30, cutoff 12:00.
  assert.equal(sessionPhase({ now: new Date("2026-01-05T02:00:00Z"), openTime: "09:30", cutoffTime: "12:00" }), "not_open");
});

test("sessionPhase is open between open and cutoff", () => {
  assert.equal(sessionPhase({ now: NOW, openTime: "09:00", cutoffTime: "12:00" }), "open");
  assert.equal(sessionPhase({ now: new Date("2026-01-05T04:59:00Z"), openTime: "09:00", cutoffTime: "12:00" }), "open");
});

test("sessionPhase is closed exactly at the cutoff and after", () => {
  // 05:00Z = 12:00 Bangkok cutoff.
  assert.equal(sessionPhase({ now: new Date("2026-01-05T05:00:00Z"), openTime: "09:00", cutoffTime: "12:00" }), "closed");
  assert.equal(sessionPhase({ now: new Date("2026-01-05T05:01:00Z"), openTime: "09:00", cutoffTime: "12:00" }), "closed");
});

test("sessionPhase returns none with no session, missing times or times with seconds", () => {
  assert.equal(sessionPhase({ now: NOW, openTime: null, cutoffTime: "12:00" }), "none");
  assert.equal(sessionPhase({ now: NOW, openTime: "09:00", cutoffTime: null }), "none");
  assert.equal(sessionPhase({ now: NOW, openTime: "", cutoffTime: "12:00" }), "none");
  // Times with seconds are valid storage shapes; slice keeps only HH:mm.
  assert.equal(sessionPhase({ now: NOW, openTime: "09:00:00", cutoffTime: "12:00:30" }), "open");
  assert.equal(sessionPhase({ openTime: "09:00", cutoffTime: "12:00" }), "none");
});

// --- findPending --------------------------------------------------------------

test("findPending excludes anyone with any attendance row, including not_attended", () => {
  const roster = [
    { employeeId: "e1", fullName: "สมชาย ใจดี" },
    { employeeId: "e2", fullName: "ขจร เดือนดี" },
    { employeeId: "e3", fullName: "อำพล แก้วมงคล" },
  ];
  const attendance = [
    { employee_id: "e1" }, // attended
    { employee_id: "e2" }, // a not_attended row still counts as having responded
  ];
  const pending = findPending(roster, attendance).map((row) => row.employeeId);
  assert.deepEqual(pending, ["e3"]);
});

test("findPending sorts the remaining members with Thai collation", () => {
  const roster = [
    { employeeId: "e1", fullName: "สมชาย ใจดี" },
    { employeeId: "e2", fullName: "ขจร เดือนดี" },
    { employeeId: "e3", fullName: "อำพล แก้วมงคล" },
    { employeeId: "e4", fullName: "กมล วงขาว" },
  ];
  const pending = findPending(roster, []).map((row) => row.fullName);
  assert.deepEqual(pending, ["กมล วงขาว", "ขจร เดือนดี", "สมชาย ใจดี", "อำพล แก้วมงคล"]);
});

test("findPending handles empty or missing inputs", () => {
  assert.deepEqual(findPending([], []), []);
  assert.deepEqual(findPending(), []);
  assert.deepEqual(findPending([{ employeeId: "e1", fullName: "six" }], [{ employee_id: "e1" }]), []);
});

// --- date helpers -------------------------------------------------------------

test("formatDateText renders the Thai Bangkok date text", () => {
  assert.equal(formatDateText(NOW), "วันจันทร์ที่ 5 ม.ค. 2569");
  // 2026-01-02T17:30Z is already Bangkok Saturday January 3.
  assert.equal(formatDateText(new Date(1767375000000)), "วันเสาร์ที่ 3 ม.ค. 2569");
});

test("todayOf returns the Bangkok YYYY-MM-DD day", () => {
  assert.equal(todayOf(NOW), "2026-01-05");
  assert.equal(todayOf(new Date(1767375000000)), "2026-01-03");
});

test("weekdayOf derives the weekday from the Bangkok date parts", () => {
  assert.equal(weekdayOf("2026-01-05"), 1); // Monday
  assert.equal(weekdayOf("2026-01-03"), 6); // Saturday
  assert.equal(weekdayOf("2026-01-04"), 0); // Sunday
});
