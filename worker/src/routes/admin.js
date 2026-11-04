// Admin overview totals, read-only. Mounted at /api/admin by src/app.js.
//
// The role comes from requireRole(): the session's own role plus the PIN gate, so
// this file holds no role check of its own. Every number is a database count
// (HEAD + Prefer: count=exact) — no rows are read into memory to be tallied — and
// the response carries totals only, so no employee name, code, national ID or
// email can leave through it. Nothing is written and a read is not audited.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { requireRole } from "../require-role.js";
import { bangkokToday } from "../register-window.js";
import { HOLIDAYS_TABLE, HOLIDAY_DATE_COLUMN } from "../leave-holidays.js";
import { DEPARTMENT_APPROVERS_TABLE, EMPLOYEE_APPROVERS_TABLE } from "../leave-approvers.js";

const admin = new Hono();

const ROLE = "system_admin";
const EMPLOYEES_TABLE = "employees";
const LEAVE_REQUESTS_TABLE = "leave_requests";
const PENDING_STATUS = "pending";

const MESSAGE = {
  saveError: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
};

admin.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

function logError(scope, error) {
  console.error(scope, { name: error?.name, code: error?.code });
}

/**
 * The Bangkok calendar year as "YYYY". Thailand never shifts its offset, and the
 * holiday table stores Gregorian dates, so this is the year the leave rules and
 * the holiday screen already use.
 */
export function bangkokYear(now = new Date()) {
  return bangkokToday(now).slice(0, 4);
}

// --- GET /api/admin/overview -------------------------------------------------

admin.get("/overview", async (c) => {
  const auth = await requireRole(c.env, c.req.raw, [ROLE]);
  if (auth.status) return c.json({ ok: false, message: auth.message }, auth.status);

  const year = bangkokYear();

  try {
    const db = createDb(c.env);
    const [activeEmployees, pendingLeave, departmentApprovers, employeeApprovers, holidays] =
      await Promise.all([
        db.count(EMPLOYEES_TABLE, { filters: [["is_active", "eq", true]] }),
        db.count(LEAVE_REQUESTS_TABLE, { filters: [["status", "eq", PENDING_STATUS]] }),
        db.count(DEPARTMENT_APPROVERS_TABLE, { filters: [["is_active", "eq", true]] }),
        db.count(EMPLOYEE_APPROVERS_TABLE, { filters: [["is_active", "eq", true]] }),
        db.count(HOLIDAYS_TABLE, {
          filters: [
            [HOLIDAY_DATE_COLUMN, "gte", `${year}-01-01`],
            [HOLIDAY_DATE_COLUMN, "lte", `${year}-12-31`],
          ],
        }),
      ]);

    return c.json(
      {
        ok: true,
        year,
        counts: {
          activeEmployees,
          pendingLeave,
          // A department row and a personal row are both one assignment, so the
          // total is the sum of the two active lists.
          activeApprovers: departmentApprovers + employeeApprovers,
          holidays,
        },
      },
      200
    );
  } catch (error) {
    logError("admin overview failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

export default admin;
