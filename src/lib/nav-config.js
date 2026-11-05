// The one source of truth for the menus. Labels, routes and icon names are
// copied verbatim from the menus they replace; the approvals entry is not in the
// base lists because it depends on the signed-in employee
// (src/lib/leave-nav-items.js).

import { approvalsMenuItem } from './leave-nav-items.js'

export const NAV_SECTION_LABELS = Object.freeze({
  mine: 'งานของฉัน',
  approver: 'งานหัวหน้า',
  meeting: 'งานประชุม',
  hr: 'งาน HR',
  admin: 'ผู้ดูแลระบบ',
})

export function leaveNavItems() {
  return [
    { label: 'ใบลาของฉัน', to: '/leave', icon: 'event_note' },
    { label: 'ยื่นใบลา', to: '/leave/new', icon: 'edit_calendar' },
    { label: 'ปฏิทินการลา', to: '/leave/calendar', icon: 'calendar_month' },
    { label: 'ข้อมูลส่วนตัว', to: '/profile', icon: 'person' },
    { label: 'เปลี่ยน PIN', to: '/change-pin', icon: 'password' },
  ]
}

export function hrNavItems() {
  return [
    { label: 'หน้าหลัก', to: '/hr', icon: 'home' },
    { label: 'รายชื่อพนักงาน', to: '/hr/employees', icon: 'groups' },
    { label: 'นำเข้าพนักงาน', to: '/hr/employees/import', icon: 'upload_file' },
    { label: 'จัดการข้อมูลพนักงาน', to: '/hr/employees/manage', icon: 'edit' },
    { label: 'จัดการรหัสผ่านพนักงาน', to: '/hr/employees/password', icon: 'password' },
    { label: 'ใบลาทั้งหมด', to: '/hr/leave', icon: 'event_note' },
    { label: 'คีย์ใบลาย้อนหลัง', to: '/hr/leave/backdated', icon: 'edit_calendar' },
    { label: 'วันหยุด', to: '/hr/leave/holidays', icon: 'event_busy' },
    { label: 'ผู้อนุมัติ', to: '/hr/leave/approvers', icon: 'how_to_reg' },
    { label: 'ตั้งค่าใบลา', to: '/hr/leave/settings', icon: 'settings' },
  ]
}

export function meetingNavItems() {
  return [
    { label: 'หน้าหลัก', to: '/meeting/controller', icon: 'dashboard' },
    { label: 'QR และรอบประชุม', to: '/meeting/controller/qr', icon: 'qr_code_2' },
    { label: 'รายชื่อประชุม', to: '/meeting/controller/roster', icon: 'groups' },
    { label: 'จัดการข้อมูลพนักงาน', to: '/meeting/controller/employees', icon: 'manage_accounts' },
    { label: 'ผู้เข้าร่วม', to: '/meeting/controller/registrants', icon: 'badge' },
    { label: 'ข้อมูลย้อนหลัง', to: '/meeting/controller/backfill', icon: 'history' },
    { label: 'นำเข้าข้อมูลย้อนหลัง', to: '/meeting/controller/backfill/import', icon: 'upload_file' },
    { label: 'แดชบอร์ด', to: '/meeting/controller/dashboard', icon: 'insights' },
  ]
}

export function adminNavItems() {
  return [
    { label: 'ภาพรวมผู้ดูแล', to: '/admin', icon: 'space_dashboard' },
    { label: 'สิทธิ์ผู้ใช้', to: '/admin/permissions', icon: 'manage_accounts' },
    // Not built yet: labels only, never a target.
    { label: 'จัดการผู้ใช้', icon: 'manage_accounts', disabled: true },
    { label: 'ตั้งค่าระบบ', icon: 'settings', disabled: true },
  ]
}

/**
 * The menu as ordered, labelled sections, the same in every shell: my work
 * first (the same five items for every active employee, so nothing moves when a
 * role signs in), then that shell's own work, then the approvals queue.
 * A section with no item is omitted, so a role never sees an empty heading.
 */
export function navSections({ role, isApprover = false, pendingCount = 0 } = {}) {
  const sections = [
    { id: 'mine', label: NAV_SECTION_LABELS.mine, items: leaveNavItems() },
  ]

  if (role === 'meeting_controller') {
    sections.push({ id: 'meeting', label: NAV_SECTION_LABELS.meeting, items: meetingNavItems() })
  }
  if (role === 'hr') {
    sections.push({ id: 'hr', label: NAV_SECTION_LABELS.hr, items: hrNavItems() })
  }
  if (role === 'system_admin') {
    sections.push({ id: 'admin', label: NAV_SECTION_LABELS.admin, items: adminNavItems() })
  }

  const approval = approvalsMenuItem({ isApprover, pendingCount })
  if (approval) {
    sections.push({ id: 'approver', label: NAV_SECTION_LABELS.approver, items: [approval] })
  }

  return sections.filter((section) => section.items.length > 0)
}
