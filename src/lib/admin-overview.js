// The admin overview screen: which card shows which number, and how the single
// read-only reply is read. Nothing here invents a number — a failed call, a
// missing count or a value that is not a whole number leaves the card at "—".

/** The one read-only endpoint behind all four cards. */
export const ADMIN_OVERVIEW_URL = '/api/admin/overview'

export const ADMIN_NO_VALUE = '—'

/** Thai name for each login role the system issues. */
export const ADMIN_ROLE_LABELS = {
  system_admin: 'ผู้ดูแลระบบ',
  hr: 'เจ้าหน้าที่ HR',
  employee: 'พนักงาน',
  meeting_controller: 'ผู้ควบคุมการประชุม',
}

/** The role as shown on the overview; "—" when it is not a known role. */
export function adminRoleLabel(role) {
  if (typeof role !== 'string') return ADMIN_NO_VALUE
  return ADMIN_ROLE_LABELS[role] ?? ADMIN_NO_VALUE
}

/** The four cards, in the order they appear. `key` matches the reply's counts. */
export const ADMIN_STATS = [
  {
    key: 'activeEmployees',
    label: 'พนักงานที่ใช้งาน',
    icon: 'groups',
    caption: 'นับเฉพาะบัญชีพนักงานที่เปิดใช้งาน',
  },
  {
    key: 'pendingLeave',
    label: 'ใบลารออนุมัติ',
    icon: 'pending_actions',
    caption: 'ทุกใบลาที่สถานะรออนุมัติ',
  },
  {
    key: 'activeApprovers',
    label: 'ผู้อนุมัติที่ใช้งาน',
    icon: 'how_to_reg',
    caption: 'รายการที่เปิดใช้งาน ทั้งระดับแผนกและรายบุคคล',
  },
  {
    key: 'holidays',
    label: 'วันหยุดปีนี้',
    icon: 'event_busy',
    caption: 'ปฏิทินวันหยุดของปีนี้ตามเวลาไทย',
  },
]

/** Existing HR pages offered as shortcuts from the overview. */
export const ADMIN_SHORTCUTS = [
  {
    to: '/hr/leave',
    label: 'ใบลาทั้งหมด',
    icon: 'event_note',
    description: 'ตรวจสอบและติดตามใบลาทุกสถานะ พร้อมเปิดดูรายละเอียดรายใบ',
  },
  {
    to: '/hr/leave/approvers',
    label: 'ตั้งค่าผู้อนุมัติ',
    icon: 'how_to_reg',
    description: 'จัดการผู้อนุมัติระดับแผนกและรายบุคคล รวมถึงเปิดหรือปิดการใช้งาน',
  },
  {
    to: '/hr/employees',
    label: 'รายชื่อพนักงาน',
    icon: 'groups',
    description: 'ค้นหาพนักงานด้วยชื่อหรือรหัส และเปิดดูข้อมูลรายคน',
  },
  {
    to: '/hr/leave/holidays',
    label: 'วันหยุด',
    icon: 'event_busy',
    description: 'ดูแลปฏิทินวันหยุดที่ระบบใช้คำนวณวันลา',
  },
]

/** Every card key, so a failed call can blank all four without guessing. */
export const ADMIN_STAT_KEYS = ADMIN_STATS.map((stat) => stat.key)

function wholeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null
}

/** The four values from one reply; anything unusable becomes null. */
export function readOverview(payload) {
  const values = Object.fromEntries(ADMIN_STAT_KEYS.map((key) => [key, null]))
  if (payload === null || typeof payload !== 'object' || payload.ok !== true) return values
  if (payload.counts === null || typeof payload.counts !== 'object') return values

  for (const key of ADMIN_STAT_KEYS) {
    values[key] = wholeCount(payload.counts[key])
  }
  return values
}

/**
 * Loads the overview once. `fetcher(url)` resolves to the parsed body, or
 * null/throws when the call failed (a 401/403/500 included): every card then
 * shows "—".
 */
export async function loadAdminStats(fetcher) {
  if (typeof fetcher !== 'function') return readOverview(null)

  try {
    return readOverview(await fetcher(ADMIN_OVERVIEW_URL))
  } catch {
    return readOverview(null)
  }
}

/** "—" for anything that is not a whole, non-negative number. */
export function formatStatValue(value) {
  if (!Number.isInteger(value) || value < 0) return ADMIN_NO_VALUE
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** True when no card has a number, so the page can show its calm empty state. */
export function allStatsUnavailable(values) {
  return ADMIN_STATS.every((stat) => !Number.isInteger(values?.[stat.key]))
}
