// The HR home shortcut menus: which HR menus a person pinned, in their order.
//
// One list feeds both ends: the picker on the profile page and the card stack on
// /hr. Labels are read from the HR navigation itself (nav-config.js), so a card
// can never say something the menu does not. Descriptions are written once, here,
// from the user's side of the screen (docs/ai/frontend-design.md section J).
import { hrNavItems } from './nav-config.js'

export const MAX_SHORTCUTS = 5
export const MIN_SHORTCUTS = 1

// Nothing saved means the system default, in this order. These are real HR
// navigation routes: "ใบลาทั้งหมด" (/hr/leave), "รายชื่อพนักงาน" (/hr/employees)
// and "วันหยุด" (/hr/leave/holidays).
export const DEFAULT_HR_MENU_SHORTCUTS = Object.freeze([
  '/hr/leave',
  '/hr/employees',
  '/hr/leave/holidays',
])

/** One plain-Thai line per HR menu: what opens, in the user's words. */
const DESCRIPTIONS = Object.freeze({
  '/hr': 'ภาพรวมงานของฝ่ายบุคคล',
  '/hr/employees': 'ค้นหาพนักงานด้วยชื่อหรือรหัส และเปิดดูข้อมูลรายคน',
  '/hr/employees/import': 'อัปโหลดรายชื่อพนักงานจากไฟล์ Excel หรือ CSV',
  '/hr/employees/manage': 'แก้แผนก ตำแหน่ง และรายชื่อที่ใช้ร่วมกัน',
  '/hr/employees/password': 'ออกรหัสผ่านชั่วคราวให้พนักงานรายคน',
  '/hr/leave': 'ดูใบลาทุกใบ กรองตามสถานะและแผนก',
  '/hr/leave/backdated': 'คีย์ใบลาย้อนหลังให้พนักงาน',
  '/hr/leave/holidays': 'กำหนดวันหยุดของบริษัทในแต่ละปี',
  '/hr/leave/certificates': 'เปิดดูใบรับรองแพทย์ของใบลาป่วย',
  '/hr/leave/approvers': 'กำหนดว่าใครเป็นผู้อนุมัติใบลา',
  '/hr/leave/settings': 'ตั้งค่าวันลาและระยะเวลาเก็บข้อมูล',
})

const FALLBACK_DESCRIPTION = 'เปิดเมนูนี้'

/** Every HR menu, with the label the menu itself uses. */
export function hrShortcutChoices() {
  return hrNavItems().map((item) => ({
    to: item.to,
    label: item.label,
    description: DESCRIPTIONS[item.to] ?? FALLBACK_DESCRIPTION,
  }))
}

const CHOICES = hrShortcutChoices()
const BY_ROUTE = new Map(CHOICES.map((item) => [item.to, item]))

/** Routes the picker offers: every HR menu except the home page itself. */
export function selectableHrMenus() {
  return CHOICES.filter((item) => item.to !== '/hr')
}

/**
 * A stored value, kept only if it is a list of known routes: unknown routes are
 * dropped, duplicates collapse to their first position, and the order is kept.
 * An empty result means "nothing usable saved", so the caller falls back to the
 * default rather than rendering an empty stack.
 */
export function normaliseHrShortcuts(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const routes = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !BY_ROUTE.has(entry) || seen.has(entry)) continue
    seen.add(entry)
    routes.push(entry)
  }
  return routes.slice(0, MAX_SHORTCUTS)
}

/** Accepts the profile object or the loader's `{ profile }` payload. */
function profileOf(payload) {
  const source = payload && typeof payload.profile === 'object' && payload.profile !== null ? payload.profile : payload
  return source && typeof source === 'object' ? source : {}
}

/** The saved choice, or the system default when nothing usable is saved. */
export function hrMenuShortcutRoutes(profile) {
  const saved = normaliseHrShortcuts(profileOf(profile).hrMenuShortcuts)
  return saved.length > 0 ? saved : [...DEFAULT_HR_MENU_SHORTCUTS]
}

/** Ready-to-render cards: route, name, description and icon. */
export function hrMenuShortcutItems(profile) {
  return hrMenuShortcutRoutes(profile)
    .map((route) => BY_ROUTE.get(route))
    .filter(Boolean)
}
