// The audit log screen: the one read-only endpoint, the Thai name of each action,
// and how a page of rows becomes day groups. The server never sends audit detail,
// so nothing here can show it.

export const AUDIT_URL = '/api/admin/audit'

export const AUDIT_LOAD_ERROR = 'โหลดประวัติการใช้งานไม่สำเร็จ กรุณาลองใหม่'

export const AUDIT_ACTION_LABELS = {
  permission_granted: 'เพิ่มสิทธิ์',
  permission_revoked: 'ถอดสิทธิ์',
  leave_requested: 'ยื่นใบลา',
  leave_approved: 'อนุมัติใบลา',
  leave_rejected: 'ไม่อนุมัติใบลา',
  leave_backdated_created: 'บันทึกใบลาย้อนหลัง',
  leave_approval_link_resent: 'ส่งลิงก์อนุมัติใหม่',
  leave_approver_added: 'เพิ่มผู้อนุมัติ',
  leave_approver_deactivated: 'ปิดการใช้งานผู้อนุมัติ',
  leave_approver_reactivated: 'เปิดการใช้งานผู้อนุมัติอีกครั้ง',
  leave_holiday_added: 'เพิ่มวันหยุด',
  leave_holiday_deleted: 'ลบวันหยุด',
  leave_settings_updated: 'แก้ตั้งค่าการลา',
  view_medical_cert: 'เปิดดูใบรับรองแพทย์',
  employee_initial_pin_issued: 'ออกรหัส PIN เริ่มต้น',
  pin_reset_code_issued: 'ออกรหัสรีเซ็ต PIN',
  pin_set: 'ตั้ง PIN',
  pin_changed: 'เปลี่ยน PIN',
  logout: 'ออกจากระบบ',
  employees_imported: 'นำเข้าข้อมูลพนักงาน',
  employee_leave_quotas_updated: 'แก้โควตาวันลา',
  employee_profile_updated: 'แก้ข้อมูลพนักงาน',
  employee_department_changed: 'ย้ายแผนกพนักงาน',
  employee_position_changed: 'เปลี่ยนตำแหน่งพนักงาน',
  department_renamed: 'เปลี่ยนชื่อแผนก',
  position_renamed: 'เปลี่ยนชื่อตำแหน่ง',
  hr_menu_shortcuts_updated: 'แก้ทางลัดเมนู HR',
  hr_shift_leads_updated: 'แก้หัวหน้ากะ',
  meeting_attendance_status_updated: 'แก้สถานะเข้าประชุม',
  meeting_backfill_imported: 'นำเข้าข้อมูลประชุมย้อนหลัง',
  meeting_cycle_closed: 'ปิดรอบประชุม',
  meeting_qr_rotated: 'เปลี่ยน QR ลงทะเบียนประชุม',
  meeting_window_updated: 'แก้เวลารับลงทะเบียนประชุม',
  meeting_monthly_session_set: 'ตั้งรอบประชุมรายเดือน',
  dashboard_reason_viewed: 'เปิดดูเหตุผลในแดชบอร์ด',
  auto_absent_done: 'ระบบบันทึกขาดประชุมอัตโนมัติ',
  notifications_run: 'ระบบส่งการแจ้งเตือน',
}

const PERMISSION_LABELS = {
  hr_admin: 'ผู้ดูแล HR',
  meeting_admin: 'ผู้ดูแลการประชุม',
  system_admin: 'ผู้ดูแลระบบ',
  leave_approver: 'ผู้อนุมัติใบลา',
}

/** Options for the action filter, in the order the labels are declared. */
export const AUDIT_ACTION_OPTIONS = Object.entries(AUDIT_ACTION_LABELS).map(
  ([value, label]) => ({ value, label })
)

/** The Thai name of an action; an action nobody named yet shows as it is stored. */
export function auditActionLabel(action) {
  if (typeof action !== 'string' || action.length === 0) return '—'
  return AUDIT_ACTION_LABELS[action] ?? action
}

/** The action name, plus the permission name on a permission row. */
export function auditHeadline(item) {
  const label = auditActionLabel(item?.action)
  const permission = PERMISSION_LABELS[item?.permission]
  return permission ? `${label} ${permission}` : label
}

export function personLabel(person) {
  if (!person) return null
  const parts = [person.fullName, person.employeeCode].filter(
    (part) => typeof part === 'string' && part.length > 0
  )
  return parts.length > 0 ? parts.join(' ') : null
}

/** Query string for one page; empty filters are left out. */
export function buildAuditUrl({ action = '', from = '', to = '', before = '' } = {}) {
  const params = new URLSearchParams()
  if (action) params.set('action', action)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (before) params.set('before', before)
  const query = params.toString()
  return query ? `${AUDIT_URL}?${query}` : AUDIT_URL
}

/** The range the server would refuse: `from` after `to`. */
export function isRangeReversed(from, to) {
  return Boolean(from) && Boolean(to) && from > to
}

/** items and nextBefore from one reply, or null when the reply is unusable. */
export function readAuditPage(payload) {
  if (payload === null || typeof payload !== 'object' || payload.ok !== true) return null
  if (!Array.isArray(payload.items)) return null
  const items = payload.items.filter(
    (item) => item && typeof item.id === 'string' && typeof item.createdAt === 'string'
  )
  const nextBefore =
    typeof payload.nextBefore === 'string' && payload.nextBefore.length > 0
      ? payload.nextBefore
      : null
  return { items, nextBefore }
}

const dayKeyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** "YYYY-MM-DD" of an instant on the Bangkok calendar. */
export function bangkokDayKey(iso) {
  return dayKeyFormat.format(new Date(iso))
}

/** Rows already newest first, split into consecutive Bangkok days. */
export function groupByDay(items) {
  const groups = []
  for (const item of items) {
    const key = bangkokDayKey(item.createdAt)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(item)
    else groups.push({ key, iso: item.createdAt, items: [item] })
  }
  return groups
}
