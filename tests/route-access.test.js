// The router guard and the pages that link onward share one allow-list:
// who may open a path, and where each role lands when a page is not theirs.
import { describe, expect, it } from 'vitest'

import { canOpenPath, homePathByRole } from '../src/lib/route-access.js'

describe('canOpenPath', () => {
  it('gives the admin role the overview page and nothing under /hr', () => {
    expect(canOpenPath('system_admin', '/admin')).toBe(true)
    for (const path of ['/hr', '/hr/leave', '/hr/leave/approvers', '/leave', '/meeting/controller']) {
      expect(canOpenPath('system_admin', path), path).toBe(false)
    }
  })

  it('gives HR its own tools but not /admin', () => {
    expect(canOpenPath('hr', '/hr/leave')).toBe(true)
    expect(canOpenPath('hr', '/hr/leave/approvers')).toBe(true)
    expect(canOpenPath('hr', '/hr/employees/abc')).toBe(true)
    expect(canOpenPath('hr', '/admin')).toBe(false)
  })

  it('gives an employee the leave pages, but no calendar or PIN page', () => {
    expect(canOpenPath('employee', '/leave')).toBe(true)
    expect(canOpenPath('employee', '/leave/new')).toBe(true)
    expect(canOpenPath('employee', '/leave/my-approvers')).toBe(true)
    expect(canOpenPath('employee', '/leave/calendar')).toBe(false)
    expect(canOpenPath('employee', '/change-pin')).toBe(false)
    expect(canOpenPath('employee', '/hr')).toBe(false)
    expect(canOpenPath('employee', '/admin')).toBe(false)
  })

  it('gives a meeting controller only the controller pages', () => {
    expect(canOpenPath('meeting_controller', '/meeting/controller')).toBe(true)
    expect(canOpenPath('meeting_controller', '/meeting/controller/backfill/import')).toBe(true)
    expect(canOpenPath('meeting_controller', '/admin')).toBe(false)
    expect(canOpenPath('meeting_controller', '/leave')).toBe(false)
  })

  it('multi-role access: the leave print page follows its own rule, not this list', () => {
    expect(canOpenPath('hr', '/leave/hr/requests/abc/print')).toBe(true)
    expect(canOpenPath('employee', '/leave/hr/requests/abc/print')).toBe(false)
  })

  it('answers false for an unknown role or unusable input', () => {
    expect(canOpenPath('admin', '/admin')).toBe(false)
    expect(canOpenPath(null, '/admin')).toBe(false)
    expect(canOpenPath('hr', null)).toBe(false)
  })

  it('opens only the simple self pages for another role with an employee record', () => {
    for (const role of ['hr', 'meeting_controller', 'system_admin']) {
      for (const path of ['/leave', '/leave/new', '/profile']) {
        expect(canOpenPath(role, path, { role, hasEmployee: true }), `${role} ${path}`).toBe(true)
        expect(canOpenPath(role, path, { role, hasEmployee: false }), `${role} ${path}`).toBe(
          false
        )
        expect(canOpenPath(role, path), `${role} ${path}`).toBe(false)
      }

      const calendarOwn = role === 'hr' || role === 'meeting_controller'
      expect(canOpenPath(role, '/leave/calendar', { role, hasEmployee: true }), role).toBe(
        calendarOwn
      )
      expect(canOpenPath(role, '/change-pin', { role, hasEmployee: true }), role).toBe(
        role === 'system_admin'
      )
    }
  })

  it('keeps the role-only pages closed even with an employee record', () => {
    const meeting = { role: 'meeting_controller', hasEmployee: true }
    expect(canOpenPath('meeting_controller', '/hr', meeting)).toBe(false)
    expect(canOpenPath('meeting_controller', '/admin', meeting)).toBe(false)

    const admin = { role: 'system_admin', hasEmployee: true }
    expect(canOpenPath('system_admin', '/hr/leave', admin)).toBe(false)

    // The contact page is employee-only, even for another role with an employee row.
    for (const role of ['hr', 'meeting_controller', 'system_admin']) {
      expect(canOpenPath(role, '/leave/my-approvers', { role, hasEmployee: true })).toBe(false)
    }
  })

  it('opens the approvals queue from the approver flag, not the role', () => {
    const approverMeeting = {
      role: 'meeting_controller',
      hasEmployee: true,
      isApprover: true,
    }
    expect(canOpenPath('meeting_controller', '/leave/approvals', approverMeeting)).toBe(true)

    const approverAdmin = { role: 'system_admin', hasEmployee: true, isApprover: true }
    expect(canOpenPath('system_admin', '/leave/approvals', approverAdmin)).toBe(true)

    const plainMeeting = { role: 'meeting_controller', hasEmployee: true }
    expect(canOpenPath('meeting_controller', '/leave/approvals', plainMeeting)).toBe(false)
  })

  it('gives an approver the calendar but never the change-PIN page', () => {
    for (const path of ['/leave', '/leave/new', '/leave/approvals', '/profile']) {
      expect(canOpenPath('employee', path), path).toBe(true)
    }
    expect(canOpenPath('employee', '/leave/calendar', { role: 'employee' })).toBe(false)
    expect(
      canOpenPath('employee', '/leave/calendar', { role: 'employee', isApprover: true })
    ).toBe(true)
    expect(
      canOpenPath('employee', '/change-pin', { role: 'employee', mustChangePin: true })
    ).toBe(false)
  })
})

describe('homePathByRole', () => {
  it('sends each role to a page it may open', () => {
    expect(homePathByRole).toEqual({
      employee: '/leave',
      hr: '/hr',
      meeting_controller: '/meeting/controller',
      system_admin: '/admin',
    })
    for (const [role, path] of Object.entries(homePathByRole)) {
      expect(canOpenPath(role, path), role).toBe(true)
    }
  })
})
