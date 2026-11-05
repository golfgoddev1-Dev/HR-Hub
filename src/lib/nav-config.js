// The one source of truth for the two dock menus. Labels, routes and icon names
// are copied verbatim from the menus they replace; the approvals entry is not
// here because it depends on the signed-in employee (src/lib/leave-nav-items.js).

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
    { label: 'ปฏิทินการลา', to: '/leave/calendar', icon: 'calendar_month' },
    { label: 'คีย์ใบลาย้อนหลัง', to: '/hr/leave/backdated', icon: 'edit_calendar' },
    { label: 'วันหยุด', to: '/hr/leave/holidays', icon: 'event_busy' },
    { label: 'ผู้อนุมัติ', to: '/hr/leave/approvers', icon: 'how_to_reg' },
    { label: 'ตั้งค่าใบลา', to: '/hr/leave/settings', icon: 'settings' },
  ]
}
