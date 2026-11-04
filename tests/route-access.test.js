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

  it('gives an employee only the leave pages and the PIN page', () => {
    expect(canOpenPath('employee', '/leave')).toBe(true)
    expect(canOpenPath('employee', '/change-pin')).toBe(true)
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
