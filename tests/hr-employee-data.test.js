// Read-only employee profile and the one HR employee-data page. These are
// source checks because the page components render Vuetify dialogs; the
// behavioural checks live in the Worker route tests.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { navSections } from '../src/lib/nav-config.js'

const PROFILE_PAGE = readFileSync(
  new URL('../src/pages/ProfilePage.vue', import.meta.url),
  'utf8'
)
const HR_PAGE = readFileSync(
  new URL('../src/pages/HrEmployeeDataPage.vue', import.meta.url),
  'utf8'
)
const DIRECTORY_MANAGER = readFileSync(
  new URL('../src/components/EmployeeDirectoryManager.vue', import.meta.url),
  'utf8'
)
const HR_ROUTE = readFileSync(
  new URL('../worker/src/routes/employee-directory.js', import.meta.url),
  'utf8'
)

describe('employee profile is read-only', () => {
  it('shows the prominent Thai HR-contact note at the top', () => {
    expect(PROFILE_PAGE).toContain('ข้อมูลส่วนตัวของคุณเป็นแบบอ่านอย่างเดียว')
    expect(PROFILE_PAGE).toContain('readonly-note')
    expect(PROFILE_PAGE).toContain('หากต้องการแก้ไขข้อมูล กรุณาติดต่อฝ่ายบุคคล (HR) เท่านั้น')
    expect(PROFILE_PAGE.indexOf('readonly-note')).toBeLessThan(
      PROFILE_PAGE.indexOf('profile.employeeCode')
    )
  })

  it('has no personal-data form or save control', () => {
    expect(PROFILE_PAGE).not.toContain('<form')
    expect(PROFILE_PAGE).not.toContain('<input')
    expect(PROFILE_PAGE).not.toContain('<select')
    expect(PROFILE_PAGE).not.toContain('profilePatch')
    expect(PROFILE_PAGE).not.toContain('startEdit')
    expect(PROFILE_PAGE).not.toContain('บันทึกข้อมูลส่วนตัวแล้ว')
  })
})

describe('one HR employee-data menu and page', () => {
  it('offers the menu only in the HR section', () => {
    const hr = navSections({ role: 'hr' })
    const manage = hr.flatMap((section) => section.items).find(
      (item) => item.to === '/hr/employees/manage'
    )
    expect(manage).toMatchObject({ label: 'จัดการข้อมูลพนักงาน' })

    for (const role of ['employee', 'meeting_controller', 'system_admin']) {
      const items = navSections({ role }).flatMap((section) => section.items)
      expect(items.some((item) => item.to === '/hr/employees/manage'), role).toBe(false)
    }
  })

  it('reuses the directory manager in full mode with a clear title', () => {
    expect(HR_PAGE).toContain('จัดการข้อมูลพนักงาน')
    expect(HR_PAGE).toContain('EmployeeDirectoryManager')
    expect(HR_PAGE).toContain('full')
    expect(HR_PAGE).toContain('/api/hr/directory')
  })

  it('offers every requested field in the HR editor', () => {
    for (const label of [
      'รหัสพนักงาน',
      'ชื่อ',
      'นามสกุล',
      'เลขบัตรประชาชน',
      'อีเมล',
      'เบอร์โทร',
      'แผนก',
      'ตำแหน่ง',
      'สถานะ',
    ]) {
      expect(DIRECTORY_MANAGER).toContain(label)
    }
    expect(DIRECTORY_MANAGER).toContain('form.nationalId')
    expect(DIRECTORY_MANAGER).toContain('form.isActive')
    expect(DIRECTORY_MANAGER).toContain('props.full')
    expect(DIRECTORY_MANAGER).toContain('PATCH')
  })
})

describe('HR audit contract', () => {
  it('uses one action and stores field names only', () => {
    expect(HR_ROUTE).toContain('employee_profile_updated')
    expect(HR_ROUTE).toContain('detail: JSON.stringify({ fields: changedFields })')
    expect(HR_ROUTE).toContain('Field names only. No old value, new value or personal data.')
  })

  it('checks employee code and national ID duplicates before writing', () => {
    expect(HR_ROUTE).toContain('duplicate_employee_code')
    expect(HR_ROUTE).toContain('duplicate_national_id')
    expect(HR_ROUTE).toContain('["employee_code", "eq", employeeCode]')
    expect(HR_ROUTE).toContain('["national_id_hash", "eq", nationalHash]')
  })
})
