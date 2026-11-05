// GET /api/leave/calendar — read-only month/week feed for the leave calendar.
//
// Scope is decided here, never by the client:
// - employee and approver (both login role "employee") see their own department
//   only; a departmentId they send is ignored;
// - HR ("hr") sees every department and may narrow it with departmentId.
//
// Only pending and approved requests leave this route, and only the seven
// display fields in publicCalendarEvent(): no reason, attachment, approver or
// national id is ever read.

import { Hono } from "hono";

import { createDb } from "../db.js";
import {
  CALENDAR_MESSAGES,
  CALENDAR_STATUSES,
  chunksOf,
  displayName,
  parseCalendarRange,
  publicCalendarEvent,
} from "../leave-calendar.js";
import { requireRole } from "../require-role.js";

const leaveCalendar = new Hono();

const ROLES = ["employee", "hr"];
const EMPLOYEES_TABLE = "employees";
const LEAVE_REQUESTS_TABLE = "leave_requests";
const LEAVE_TYPES_TABLE = "leave_types";
const DEPARTMENTS_TABLE = "departments";

const IN_CHUNK = 100;
const ROW_LIMIT = 2000;

const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

const MESSAGE = {
  forbidden: "ไม่มีสิทธิ์เข้าถึงส่วนนี้",
  saveError: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
};

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Never logs names, dates, ids or reasons: only a label and an error code. */
function logError(label, error) {
  console.error("[leave-calendar]", label, {
    code: error?.code ?? null,
    status: error?.status ?? null,
  });
}

leaveCalendar.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

leaveCalendar.get("/", async (c) => {
  const auth = await requireRole(c.env, c.req.raw, ROLES);
  if (auth.status) {
    return c.json({ ok: false, message: auth.message }, auth.status);
  }

  const range = parseCalendarRange(new URL(c.req.raw.url).searchParams);
  if (range.ok !== true) {
    return c.json({ ok: false, message: range.message }, 400);
  }

  try {
    const db = createDb(c.env);

    const employee = await db.select(EMPLOYEES_TABLE, {
      columns: "id,department_id,is_active",
      filters: [["id", "eq", auth.session.employeeId]],
      single: true,
    });
    if (!employee || employee.is_active !== true) {
      return c.json({ ok: false, message: MESSAGE.forbidden }, 403);
    }

    const isHr = auth.session.role === "hr";
    if (isHr && range.departmentId !== null && isUuid(range.departmentId) === false) {
      return c.json({ ok: false, message: CALENDAR_MESSAGES.departmentInvalid }, 400);
    }

    // The employee/approver scope is the caller's own department; only HR may
    // choose one, and no filter at all means every department.
    const scopeDepartmentId = isHr ? range.departmentId : employee.department_id ?? null;

    const empty = () =>
      c.json(
        {
          ok: true,
          from: range.from,
          to: range.to,
          scope: isHr ? (scopeDepartmentId ? "department" : "all") : "department",
          departmentId: scopeDepartmentId,
          count: 0,
          events: [],
        },
        200
      );

    if (!isHr && !scopeDepartmentId) return empty();

    let scopedEmployeeIds = null;
    if (scopeDepartmentId) {
      const colleagues = await db.select(EMPLOYEES_TABLE, {
        columns: "id",
        filters: [["department_id", "eq", scopeDepartmentId]],
        limit: 5000,
      });
      scopedEmployeeIds = colleagues.map((row) => row.id).filter(Boolean);
      if (scopedEmployeeIds.length === 0) return empty();
    }

    const baseFilters = [
      ["status", "in", CALENDAR_STATUSES],
      ["start_date", "lte", range.to],
      ["end_date", "gte", range.from],
    ];

    const columns = "id,employee_id,leave_type_id,start_date,end_date,status";
    let rows = [];

    if (scopedEmployeeIds === null) {
      rows = await db.select(LEAVE_REQUESTS_TABLE, {
        columns,
        filters: baseFilters,
        order: "start_date.asc",
        limit: ROW_LIMIT,
      });
    } else {
      for (const chunk of chunksOf(scopedEmployeeIds, IN_CHUNK)) {
        const part = await db.select(LEAVE_REQUESTS_TABLE, {
          columns,
          filters: [...baseFilters, ["employee_id", "in", chunk]],
          order: "start_date.asc",
          limit: ROW_LIMIT,
        });
        rows = rows.concat(part);
        if (rows.length >= ROW_LIMIT) break;
      }
    }

    // Defensive: the query already filters, but a status added later must not
    // leak through this read without a decision.
    const visible = rows
      .filter((row) => CALENDAR_STATUSES.includes(row.status))
      .slice(0, ROW_LIMIT);

    const requesterIds = [...new Set(visible.map((row) => row.employee_id).filter(Boolean))];
    const typeIds = [...new Set(visible.map((row) => row.leave_type_id).filter(Boolean))];

    const requesters = requesterIds.length
      ? await db.select(EMPLOYEES_TABLE, {
          columns: "id,name_prefix,full_name,department_id",
          filters: [["id", "in", requesterIds]],
        })
      : [];

    const departmentIds = [...new Set(requesters.map((row) => row.department_id).filter(Boolean))];
    const departments = departmentIds.length
      ? await db.select(DEPARTMENTS_TABLE, {
          columns: "id,name",
          filters: [["id", "in", departmentIds]],
        })
      : [];
    const types = typeIds.length
      ? await db.select(LEAVE_TYPES_TABLE, {
          columns: "id,name",
          filters: [["id", "in", typeIds]],
        })
      : [];

    const requesterById = new Map(requesters.map((row) => [row.id, row]));
    const departmentNameById = new Map(departments.map((row) => [row.id, row.name ?? null]));
    const typeNameById = new Map(types.map((row) => [row.id, row.name ?? ""]));

    const events = visible
      .map((row) => {
        const requester = requesterById.get(row.employee_id) ?? null;
        return publicCalendarEvent({
          id: row.id,
          employeeName: displayName(requester?.name_prefix, requester?.full_name),
          departmentName: requester?.department_id
            ? departmentNameById.get(requester.department_id) ?? null
            : null,
          leaveTypeLabel: typeNameById.get(row.leave_type_id) ?? "",
          status: row.status,
          startDate: String(row.start_date ?? "").slice(0, 10),
          endDate: String(row.end_date ?? "").slice(0, 10),
        });
      })
      .filter((event) => event.id && event.startDate && event.endDate);

    return c.json(
      {
        ok: true,
        from: range.from,
        to: range.to,
        scope: isHr ? (scopeDepartmentId ? "department" : "all") : "department",
        departmentId: scopeDepartmentId,
        count: events.length,
        events,
      },
      200
    );
  } catch (error) {
    logError("calendar read failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

export default leaveCalendar;
