// The admin overview screen: which number comes from which existing endpoint,
// and how a reply is turned into a value. Nothing here invents a number: a stat
// stays null (shown as "—") when its endpoint is missing, refuses the caller, or
// answers a page that may be truncated.
//
// No new Worker endpoint was added for this screen; every url below already
// exists and is owned by another page.

import { todayBangkokIso } from './thai-date.js'

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

/** The endpoints cap their lists; a full page means the total is unknown. */
export const ADMIN_APPROVER_LIST_LIMIT = 200
export const ADMIN_HOLIDAY_LIST_LIMIT = 400
export const ADMIN_REQUEST_PAGE_SIZE = 50

export const ADMIN_STATS = [
  {
    key: 'activeEmployees',
    label: 'พนักงานที่ใช้งาน',
    icon: 'groups',
    kind: 'none',
    // /api/hr/employees is a search endpoint (at least 2 characters), so it
    // cannot report a total. No other existing endpoint counts employees.
    url: null,
    caption: 'ยังไม่มี endpoint สำหรับนับพนักงานทั้งหมด',
  },
  {
    key: 'pendingLeave',
    label: 'ใบลารออนุมัติ',
    icon: 'pending_actions',
    kind: 'requests',
    url: `/api/leave/hr/requests?status=pending&page=1&pageSize=${ADMIN_REQUEST_PAGE_SIZE}`,
    caption: 'จากรายการสถานะรออนุมัติ (50 รายการแรก)',
  },
  {
    key: 'activeApprovers',
    label: 'ผู้อนุมัติที่ใช้งาน',
    icon: 'how_to_reg',
    kind: 'approvers',
    url: '/api/leave/hr/approvers?scope=department',
    caption: 'นับเฉพาะรายการระดับแผนกที่เปิดใช้งาน',
  },
  {
    key: 'holidays',
    label: 'วันหยุดปีนี้',
    icon: 'event_busy',
    kind: 'holidays',
    // The holiday table stores Gregorian dates, so the request asks for the
    // Bangkok year as-is.
    url: () => `/api/leave/hr/holidays?year=${todayBangkokIso().slice(0, 4)}`,
    caption: 'จากปฏิทินวันหยุดของปีปัจจุบัน',
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

/**
 * A number for one stat, or null when the reply cannot support one.
 * - requests: `count` is the page length, so `hasMore`/`scanCapped` means the
 *   real total is larger than what we can see.
 * - approvers: counts the active rows of a list that stops at 200.
 * - holidays: `count` of a list that stops at 400.
 */
export function readStatValue(kind, payload) {
  if (payload === null || typeof payload !== 'object' || payload.ok !== true) return null

  if (kind === 'requests') {
    if (!Number.isInteger(payload.count) || payload.count < 0) return null
    if (payload.hasMore === true || payload.scanCapped === true) return null
    return payload.count
  }

  if (kind === 'approvers') {
    if (!Array.isArray(payload.results)) return null
    if (payload.results.length >= ADMIN_APPROVER_LIST_LIMIT) return null
    return payload.results.filter(
      (row) => row !== null && typeof row === 'object' && row.isActive === true
    ).length
  }

  if (kind === 'holidays') {
    if (!Number.isInteger(payload.count) || payload.count < 0) return null
    if (payload.count >= ADMIN_HOLIDAY_LIST_LIMIT) return null
    return payload.count
  }

  return null
}

/**
 * Loads every stat in parallel. `fetcher(url)` resolves to the parsed body, or
 * null/throws when the call failed (a 403 from the HR guard included): that stat
 * is then simply unavailable.
 */
export async function loadAdminStats(fetcher) {
  const entries = await Promise.all(
    ADMIN_STATS.map(async (stat) => {
      const url = typeof stat.url === 'function' ? stat.url() : stat.url
      if (!url || typeof fetcher !== 'function') return [stat.key, null]
      try {
        return [stat.key, readStatValue(stat.kind, await fetcher(url))]
      } catch {
        return [stat.key, null]
      }
    })
  )

  return Object.fromEntries(entries)
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
