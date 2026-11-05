// The two dock menus come from one config module. Labels, routes and icon names
// are pinned as a table so a rename or a reorder cannot slip in unnoticed, and
// the entrance flag is pinned as a one-shot.
import { describe, expect, it, vi } from 'vitest'

import {
  NAV_SECTION_LABELS,
  hrNavItems,
  leaveNavItems,
  navSections,
} from '../src/lib/nav-config.js'
import { approvalsMenuItem } from '../src/lib/leave-nav-items.js'

const LEAVE_TABLE = [
  ['ใบลาของฉัน', '/leave', 'event_note'],
  ['ยื่นใบลา', '/leave/new', 'edit_calendar'],
  ['ปฏิทินการลา', '/leave/calendar', 'calendar_month'],
  ['ข้อมูลส่วนตัว', '/profile', 'person'],
  ['เปลี่ยน PIN', '/change-pin', 'password'],
]

const HR_TABLE = [
  ['หน้าหลัก', '/hr', 'home'],
  ['รายชื่อพนักงาน', '/hr/employees', 'groups'],
  ['นำเข้าพนักงาน', '/hr/employees/import', 'upload_file'],
  ['จัดการข้อมูลพนักงาน', '/hr/employees/manage', 'edit'],
  ['จัดการรหัสผ่านพนักงาน', '/hr/employees/password', 'password'],
  ['ใบลาทั้งหมด', '/hr/leave', 'event_note'],
  ['คีย์ใบลาย้อนหลัง', '/hr/leave/backdated', 'edit_calendar'],
  ['วันหยุด', '/hr/leave/holidays', 'event_busy'],
  ['ผู้อนุมัติ', '/hr/leave/approvers', 'how_to_reg'],
  ['ตั้งค่าใบลา', '/hr/leave/settings', 'settings'],
]

const table = (items) => items.map((item) => [item.label, item.to, item.icon])

describe('leaveNavItems', () => {
  it('keeps the five employee items in order, with unchanged routes and icons', () => {
    expect(table(leaveNavItems())).toEqual(LEAVE_TABLE)
  })

  it('returns a fresh array, so a caller cannot mutate the menu', () => {
    const first = leaveNavItems()
    first.push({ label: 'x', to: '/x', icon: 'x' })
    expect(leaveNavItems()).toHaveLength(5)
  })

  it('never carries the approvals entry: that needs the session', () => {
    expect(leaveNavItems().some((item) => item.to === '/leave/approvals')).toBe(false)
  })
})

describe('hrNavItems', () => {
  it('keeps the ten HR items in order, with unchanged routes and icons', () => {
    expect(table(hrNavItems())).toEqual(HR_TABLE)
  })

  it('does not repeat the leave calendar: it lives in งานของฉัน', () => {
    expect(hrNavItems().some((item) => item.to === '/leave/calendar')).toBe(false)

    const mine = navSections({ role: 'hr' }).find((section) => section.id === 'mine')
    expect(mine.items.filter((item) => item.to === '/leave/calendar')).toHaveLength(1)
  })

  it('returns a fresh array', () => {
    const first = hrNavItems()
    first.length = 0
    expect(hrNavItems()).toHaveLength(10)
  })
})

describe('approvals entry in the shared menu', () => {
  it('is absent for a non-approver', () => {
    expect(approvalsMenuItem({ isApprover: false, pendingCount: 3 })).toBeNull()
  })

  it('is absent for a deactivated approver, because the server says false', () => {
    expect(approvalsMenuItem({ isApprover: false, pendingCount: 0 })).toBeNull()
    expect(approvalsMenuItem({ isApprover: 'true', pendingCount: 2 })).toBeNull()
  })

  it('is present for an active approver, with the pending count as a badge', () => {
    const item = approvalsMenuItem({ isApprover: true, pendingCount: 3 })
    expect(item).toMatchObject({
      label: 'อนุมัติใบลา',
      to: '/leave/approvals',
      icon: 'fact_check',
      badge: 3,
    })
    expect(approvalsMenuItem({ isApprover: true, pendingCount: 0 }).badge).toBe(0)
  })
})

describe('navSections', () => {
  it('orders the groups my work, the role section, then the approver section', () => {
    const sections = navSections({ role: 'hr', isApprover: true, pendingCount: 2 })

    expect(sections.map((section) => section.id)).toEqual(['mine', 'hr', 'approver'])
    expect(sections.map((section) => section.label)).toEqual([
      NAV_SECTION_LABELS.mine,
      NAV_SECTION_LABELS.hr,
      NAV_SECTION_LABELS.approver,
    ])
    expect(NAV_SECTION_LABELS).toMatchObject({
      mine: 'งานของฉัน',
      approver: 'งานหัวหน้า',
      meeting: 'งานประชุม',
      hr: 'งาน HR',
      admin: 'ผู้ดูแลระบบ',
    })
  })

  it('gives every shell the same five my-work items, calendar included', () => {
    for (const role of ['employee', 'hr', 'meeting_controller', 'system_admin']) {
      const mine = navSections({ role }).find((section) => section.id === 'mine')
      expect(mine.items.map((item) => item.to), role).toEqual([
        '/leave',
        '/leave/new',
        '/leave/calendar',
        '/profile',
        '/change-pin',
      ])
    }
  })

  it('shows /leave/calendar exactly once in the HR shell', () => {
    const paths = navSections({ role: 'hr', isApprover: true, pendingCount: 1 }).flatMap(
      (section) => section.items.map((item) => item.to)
    )

    expect(paths.filter((path) => path === '/leave/calendar')).toHaveLength(1)
  })

  it('hides a section with nothing to show', () => {
    expect(navSections({ role: 'employee' }).map((section) => section.id)).toEqual(['mine'])
    expect(navSections({ role: 'meeting_controller' }).map((section) => section.id)).toEqual([
      'mine',
      'meeting',
    ])
    expect(navSections({ role: 'system_admin' }).map((section) => section.id)).toEqual([
      'mine',
      'admin',
    ])
  })

  it('shows the approvals badge only for an approver, and never on another item', () => {
    expect(navSections({ role: 'employee' }).some((section) => section.id === 'approver')).toBe(
      false
    )

    const sections = navSections({ role: 'meeting_controller', isApprover: true, pendingCount: 4 })
    const approver = sections.find((section) => section.id === 'approver')
    expect(approver.items).toHaveLength(1)
    expect(approver.items[0]).toMatchObject({ to: '/leave/approvals', badge: 4 })

    for (const section of sections) {
      if (section.id === 'approver') continue
      expect(section.items.every((item) => item.badge === undefined)).toBe(true)
    }
  })
})

describe('dock entrance flag', () => {
  it('is true on the first call and false on every later call', async () => {
    vi.resetModules()
    const { takeDockEntrance } = await import('../src/lib/dock-entrance.js')

    expect(takeDockEntrance()).toBe(true)
    expect(takeDockEntrance()).toBe(false)
    expect(takeDockEntrance()).toBe(false)
  })

  it('starts over only when the module is loaded again (a new page load)', async () => {
    vi.resetModules()
    const first = await import('../src/lib/dock-entrance.js')
    expect(first.takeDockEntrance()).toBe(true)

    vi.resetModules()
    const second = await import('../src/lib/dock-entrance.js')
    expect(second.takeDockEntrance()).toBe(true)
  })
})
