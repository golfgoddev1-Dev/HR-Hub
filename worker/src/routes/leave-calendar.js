// GET /api/leave/calendar — read-only month/week feed for the leave calendar.
//
// Scope is decided here, never by the client:
// - a plain employee sees their own department only;
// - an active approver sees only the people they are responsible for: their
//   granted departments plus the employees they are named approver for (and
//   themselves). Their own department is not an implicit grant;
// - a departmentId from either of them is ignored, and only visible rows are
//   returned, so a foreign filter cannot widen the feed;
// - HR ("hr") sees every department and may narrow it with departmentId.
//
// Only pending and approved requests leave this route, and only the display
// fields in publicCalendarEvent(). Review fields (including the reason) are
// attached only when the shared detail rule allows them.

import { Hono } from "hono";

import { createDb } from "../db.js";
import {
  CALENDAR_MESSAGES,
  CALENDAR_STATUSES,
  buildDayCounts,
  chunksOf,
  displayName,
  parseCalendarRange,
  publicCalendarDetail,
  publicCalendarEvent,
} from "../leave-calendar.js";
import { canViewLeaveRequest } from "../leave-scope.js";
import {
  loadViewerScope,
  loadVisibleEmployeeIds,
  viewerCanSee,
} from "../leave-visibility.js";
import { requireRole } from "../require-role.js";

const leaveCalendar = new Hono();

const ROLES = ["employee", "hr", "meeting_controller"];
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

    const scope = await loadViewerScope(db, {
      role: auth.session.role,
      employeeId: employee.id,
      departmentId: employee.department_id ?? null,
    });

    // A plain employee no longer has a calendar; only an active approver in the
    // employee role keeps the responsibility-scoped feed.
    if (auth.session.role === "employee" && scope.grants?.isApprover !== true) {
      return c.json({ ok: false, message: MESSAGE.forbidden }, 403);
    }
    const scopedByResponsibility = isHr === false && scope.grants?.isApprover === true;

    // HR may choose a department; nobody else can widen their scope with the
    // query parameter. An approver sees exactly their grants, a plain employee
    // keeps their own department's calendar.
    const scopeDepartmentId = isHr ? range.departmentId : employee.department_id ?? null;
    const responseScope = isHr
      ? scopeDepartmentId
        ? "department"
        : "all"
      : scopedByResponsibility
        ? "responsibilities"
        : "department";
    const responseDepartmentId = isHr
      ? scopeDepartmentId
      : scopedByResponsibility
        ? null
        : scopeDepartmentId;

    const empty = () =>
      c.json(
        {
          ok: true,
          from: range.from,
          to: range.to,
          scope: responseScope,
          departmentId: responseDepartmentId,
          count: 0,
          dayCounts: {},
          events: [],
        },
        200
      );

    let scopedEmployeeIds = null;
    if (isHr) {
      if (scopeDepartmentId) {
        const colleagues = await db.select(EMPLOYEES_TABLE, {
          columns: "id",
          filters: [["department_id", "eq", scopeDepartmentId]],
          limit: 5000,
        });
        scopedEmployeeIds = colleagues.map((row) => row.id).filter(Boolean);
        if (scopedEmployeeIds.length === 0) return empty();
      }
    } else {
      const visibleIds = await loadVisibleEmployeeIds(db, scope);
      if (visibleIds.size === 0) return empty();
      scopedEmployeeIds = [...visibleIds];
    }

    const baseFilters = [
      ["status", "in", CALENDAR_STATUSES],
      ["start_date", "lte", range.to],
      ["end_date", "gte", range.from],
    ];

    const columns =
      "id,employee_id,approver_id,leave_type_id,request_code,other_type_detail,start_date,end_date,status,days,return_date,return_time,shift_option_code,shift_end_override,ot_option,reason,has_medical_certificate,decision_note,decided_at,created_at";
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
    const requesterIds = [...new Set(rows.map((row) => row.employee_id).filter(Boolean))];
    const typeIds = [...new Set(rows.map((row) => row.leave_type_id).filter(Boolean))];

    const requesters = requesterIds.length
      ? await db.select(EMPLOYEES_TABLE, {
          columns: "id,employee_code,name_prefix,full_name,department_id",
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

    // The row rule runs again after the read: the query limits the employee
    // ids, and this guarantees an event, a daily count or a reason can only
    // describe someone the viewer is responsible for.
    const visible = rows
      .filter((row) => CALENDAR_STATUSES.includes(row.status))
      .filter((row) =>
        viewerCanSee(
          scope,
          row,
          requesterById.get(row.employee_id)?.department_id ?? null
        )
      )
      .slice(0, ROW_LIMIT);

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
          // The reason and the other review fields only reach a caller who
          // passes the approvals scope for this very request.
          detail: canViewLeaveRequest({
            role: auth.session.role,
            employeeId: employee.id,
            grants: scope.grants,
            request: row,
            requesterDepartmentId: requester?.department_id ?? null,
          })
            ? publicCalendarDetail({
                requestCode: row.request_code,
                employeeCode: requester?.employee_code,
                otherTypeDetail: row.other_type_detail,
                days: row.days,
                returnDate: row.return_date,
                returnTime: row.return_time,
                shiftCode: row.shift_option_code,
                shiftEndOverride: row.shift_end_override,
                otOption: row.ot_option,
                reason: row.reason,
                hasMedicalCertificate: row.has_medical_certificate,
                decisionNote: row.decision_note,
                decidedAt: row.decided_at,
                createdAt: row.created_at,
              })
            : null,
        });
      })
      .filter((event) => event.id && event.startDate && event.endDate);

    return c.json(
      {
        ok: true,
        from: range.from,
        to: range.to,
        scope: responseScope,
        departmentId: responseDepartmentId,
        count: events.length,
        // Approved people per Bangkok calendar day, counted from the same rows
        // the grid was built from. The day panel's count and list use this.
        dayCounts: buildDayCounts(visible),
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
