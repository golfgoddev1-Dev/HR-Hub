// The one HR guard: the session role must be hr AND the caller must still be
// listed in hr_admins. The membership table is re-read on every request,
// because a revoked admin can keep a valid session for a while.
//
// Returns { db, session } on success or { response } with the exact answer the
// route should return. The two message strings are the ones the existing HR
// routes already use, so a refusal reads the same everywhere.

import { createDb } from "./db.js";
import { requireRole } from "./require-role.js";

export const HR_ADMINS_TABLE = "hr_admins";
export const HR_ROLE = "hr";

export const HR_GUARD_MESSAGES = Object.freeze({
  forbidden: "ไม่มีสิทธิ์เข้าถึงส่วนนี้",
  saveError: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
});

export async function requireHrAdmin(c) {
  const auth = await requireRole(c.env, c.req.raw, [HR_ROLE]);
  if (auth.status) {
    return { response: c.json({ ok: false, message: auth.message }, auth.status) };
  }

  try {
    const db = createDb(c.env);
    const member = await db.select(HR_ADMINS_TABLE, {
      columns: "employee_id",
      filters: [["employee_id", "eq", auth.session.employeeId]],
      single: true,
    });
    if (!member) {
      return {
        response: c.json({ ok: false, message: HR_GUARD_MESSAGES.forbidden }, 403),
      };
    }

    return { db, session: auth.session };
  } catch (error) {
    // Name and code only: never a message, URL or environment value.
    console.error("[hr-guard]", { name: error?.name, code: error?.code ?? null });
    return {
      response: c.json({ ok: false, message: HR_GUARD_MESSAGES.saveError }, 500),
    };
  }
}
