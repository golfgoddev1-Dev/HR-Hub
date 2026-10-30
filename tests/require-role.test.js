import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ readSession: vi.fn() }))

vi.mock('../server/session-check.js', () => ({ readSession: mocks.readSession }))

import { requireRole } from '../server/middleware/require-role.js'

function createRes() {
  const res = { statusCode: null, body: null }
  res.status = vi.fn((code) => {
    res.statusCode = code
    return res
  })
  res.json = vi.fn((payload) => {
    res.body = payload
    return res
  })
  return res
}

describe('requireRole', () => {
  beforeEach(() => {
    mocks.readSession.mockReset()
  })

  it('responds 401 when there is no session', async () => {
    mocks.readSession.mockResolvedValue({ ok: false })
    const req = { cookies: {} }
    const res = createRes()
    const next = vi.fn()

    await requireRole('meeting_controller')(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ ok: false, message: 'ไม่ได้เข้าสู่ระบบ' })
    expect(next).not.toHaveBeenCalled()
    expect(req.session).toBeUndefined()
  })

  it('responds 403 when the role is not allowed', async () => {
    mocks.readSession.mockResolvedValue({
      ok: true,
      employeeId: 'employee-1',
      role: 'employee',
      redirectTo: '/pending?to=%2Fleave',
    })
    const req = { cookies: {} }
    const res = createRes()
    const next = vi.fn()

    await requireRole('meeting_controller')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ ok: false, message: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้' })
    expect(next).not.toHaveBeenCalled()
    expect(req.session).toBeUndefined()
  })

  it('calls next and exposes the session for an allowed role', async () => {
    mocks.readSession.mockResolvedValue({
      ok: true,
      employeeId: 'employee-1',
      role: 'meeting_controller',
      redirectTo: '/pending?to=%2Fmeeting%2Fcontroller',
    })
    const req = { cookies: {} }
    const res = createRes()
    const next = vi.fn()

    await requireRole('meeting_controller')(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
    expect(req.session).toEqual({ employeeId: 'employee-1', role: 'meeting_controller' })
  })

  it('accepts any of the listed roles', async () => {
    mocks.readSession.mockResolvedValue({
      ok: true,
      employeeId: 'employee-2',
      role: 'system_admin',
      redirectTo: '/pending?to=%2Fadmin',
    })
    const req = { cookies: {} }
    const res = createRes()
    const next = vi.fn()

    await requireRole('meeting_controller', 'system_admin')(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(req.session).toEqual({ employeeId: 'employee-2', role: 'system_admin' })
  })
})
