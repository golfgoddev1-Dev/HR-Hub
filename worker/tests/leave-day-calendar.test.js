// The calendar day helpers: distinct people per day, multi-day coverage, a half
// day counting as one person, and the single read-scope rule the day detail and
// the approvals routes share.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addCalendarDays,
  buildDayCounts,
  publicCalendarEvent,
} from "../src/leave-calendar.js";
import { canSeeLeaveRequest, canViewLeaveRequest } from "../src/leave-scope.js";

const EMPLOYEE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMPLOYEE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EMPLOYEE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EMPLOYEE_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function row(overrides) {
  return {
    status: "approved",
    leave_type_id: "type-1",
    start_date: "2026-11-10",
    end_date: "2026-11-10",
    ...overrides,
  };
}

test("counts distinct people, not leave records", () => {
  const counts = buildDayCounts([
    row({ id: "r1", employee_id: EMPLOYEE_A }),
    row({ id: "r2", employee_id: EMPLOYEE_B }),
    // A second record for the same person on the same day is still one person.
    row({ id: "r3", employee_id: EMPLOYEE_A }),
  ]);

  assert.deepEqual(counts, { "2026-11-10": 2 });
});

test("a multi-day request is counted once on every day it covers", () => {
  const counts = buildDayCounts([
    row({ id: "r1", employee_id: EMPLOYEE_A, start_date: "2026-11-10", end_date: "2026-11-12" }),
    row({ id: "r2", employee_id: EMPLOYEE_B, start_date: "2026-11-11", end_date: "2026-11-11" }),
  ]);

  assert.deepEqual(counts, {
    "2026-11-10": 1,
    "2026-11-11": 2,
    "2026-11-12": 1,
  });
});

test("a half-day leave counts as one person", () => {
  const counts = buildDayCounts([
    row({
      id: "half",
      employee_id: EMPLOYEE_C,
      start_date: "2026-11-12",
      end_date: "2026-11-12",
      days: 0.5,
    }),
  ]);

  assert.deepEqual(counts, { "2026-11-12": 1 });
});

test("a holiday is not a person: only approved leave rows count", () => {
  const counts = buildDayCounts([
    row({ id: "pending", employee_id: EMPLOYEE_D, status: "pending" }),
    row({ id: "rejected", employee_id: EMPLOYEE_D, status: "rejected" }),
    row({ id: "approved", employee_id: EMPLOYEE_B }),
  ]);

  assert.deepEqual(counts, { "2026-11-10": 1 });
});

test("the count map never shifts a date-only value", () => {
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addCalendarDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29");

  const counts = buildDayCounts([
    row({ id: "r1", employee_id: EMPLOYEE_A, start_date: "2026-12-31", end_date: "2027-01-01" }),
  ]);
  assert.deepEqual(counts, { "2026-12-31": 1, "2027-01-01": 1 });
});

test("the calendar event hides review fields unless a detail is supplied", () => {
  const base = {
    id: "r1",
    employeeName: "นาย ก",
    departmentName: "ฝ่ายบุคคล",
    leaveTypeLabel: "ลากิจ",
    status: "approved",
    startDate: "2026-11-10",
    endDate: "2026-11-10",
  };

  const plain = publicCalendarEvent(base);
  assert.equal(Object.prototype.hasOwnProperty.call(plain, "detail"), false);
  assert.deepEqual(Object.keys(plain).sort(), [
    "departmentName",
    "employeeName",
    "endDate",
    "id",
    "leaveTypeLabel",
    "startDate",
    "status",
  ]);

  const withDetail = publicCalendarEvent({ ...base, detail: { reason: "ปวดหัว" } });
  assert.equal(withDetail.detail.reason, "ปวดหัว");
});

test("the detail rule: HR, a named grant, or a department grant", () => {
  const request = { employee_id: EMPLOYEE_A };
  const grants = {
    isApprover: true,
    employeeIds: new Set([EMPLOYEE_B]),
    departmentIds: new Set(["dept-finance"]),
  };

  assert.equal(
    canViewLeaveRequest({
      role: "employee",
      employeeId: "approver-1",
      grants,
      request,
      requesterDepartmentId: "dept-sales",
    }),
    false
  );
  assert.equal(
    canViewLeaveRequest({
      role: "employee",
      employeeId: "approver-1",
      grants,
      request,
      requesterDepartmentId: "dept-finance",
    }),
    true
  );
  assert.equal(
    canViewLeaveRequest({
      role: "employee",
      employeeId: "approver-1",
      grants,
      request: { employee_id: EMPLOYEE_B },
      requesterDepartmentId: "dept-sales",
    }),
    true
  );
  assert.equal(
    canViewLeaveRequest({
      role: "hr",
      employeeId: "hr-1",
      request,
      requesterDepartmentId: "dept-sales",
    }),
    true
  );
  assert.equal(
    canViewLeaveRequest({ role: "employee", employeeId: "plain", request, requesterDepartmentId: "dept-finance" }),
    false
  );
  assert.equal(canViewLeaveRequest({ role: "hr", employeeId: "hr-1" }), false);
});

test("an approver's own department is not an implicit grant", () => {
  const grants = {
    isApprover: true,
    employeeIds: new Set(),
    departmentIds: new Set(["dept-finance"]),
  };
  const request = { employee_id: EMPLOYEE_B };

  assert.equal(
    canSeeLeaveRequest({
      role: "employee",
      employeeId: "approver-1",
      departmentId: "dept-accounting",
      grants,
      request,
      requesterDepartmentId: "dept-accounting",
    }),
    false
  );
  assert.equal(
    canSeeLeaveRequest({
      role: "employee",
      employeeId: "approver-1",
      departmentId: "dept-accounting",
      grants,
      request,
      requesterDepartmentId: "dept-finance",
    }),
    true
  );
});

test("a plain employee keeps department visibility and sees their own row", () => {
  const request = { employee_id: EMPLOYEE_B };
  const grants = { isApprover: false, employeeIds: new Set(), departmentIds: new Set() };

  assert.equal(
    canSeeLeaveRequest({
      role: "employee",
      employeeId: "plain",
      departmentId: "dept-accounting",
      grants,
      request,
      requesterDepartmentId: "dept-accounting",
    }),
    true
  );
  assert.equal(
    canSeeLeaveRequest({
      role: "employee",
      employeeId: "plain",
      departmentId: "dept-accounting",
      grants,
      request,
      requesterDepartmentId: "dept-finance",
    }),
    false
  );
  assert.equal(
    canSeeLeaveRequest({
      role: "employee",
      employeeId: EMPLOYEE_A,
      departmentId: "dept-accounting",
      grants,
      request: { employee_id: EMPLOYEE_A },
      requesterDepartmentId: "dept-finance",
    }),
    true
  );
});
