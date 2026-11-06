// Payload builder: fixed generic wording only and a fixed route key, with no
// personal detail and no payload-supplied URL.
import { describe, expect, it } from 'vitest'

import {
  MAX_PAYLOAD_BYTES,
  NOTIFICATION_KINDS,
  NOTIFICATION_ROUTES,
  buildNotificationPayload,
  buildSignedOutPendingPayload,
  payloadFits,
} from '../worker/src/push/payload.js'

const REQUEST_KINDS = [
  NOTIFICATION_KINDS.SUBMITTED,
  NOTIFICATION_KINDS.DECIDED,
  NOTIFICATION_KINDS.BACKDATED,
]

describe('buildNotificationPayload', () => {
  it('sends the approver the fixed new-request notice', () => {
    const payload = buildNotificationPayload(NOTIFICATION_KINDS.SUBMITTED)
    expect(payload.title).toBe('ระบบใบลา')
    expect(payload.body).toBe('มีรายการรออนุมัติใหม่ 1 รายการ')
    expect(payload.route).toBe(NOTIFICATION_ROUTES.APPROVALS)
    expect(payload.tag).toBe('leave-submitted')
    expect(payload).not.toHaveProperty('url')
  })

  it('sends the owner the same update notice for either decision', () => {
    const approved = buildNotificationPayload(NOTIFICATION_KINDS.DECIDED, {
      requestId: '11111111-1111-4111-8111-111111111111',
      status: 'approved',
    })
    expect(approved.title).toBe('ระบบใบลา')
    expect(approved.body).toBe('มีการอัปเดตใบลาของคุณ')
    expect(approved.route).toBe(NOTIFICATION_ROUTES.LEAVE)

    const rejected = buildNotificationPayload(NOTIFICATION_KINDS.DECIDED, {
      requestId: '11111111-1111-4111-8111-111111111111',
      status: 'rejected',
    })
    expect(rejected.title).toBe('ระบบใบลา')
    expect(rejected.body).toBe('มีการอัปเดตใบลาของคุณ')
    expect(rejected.route).toBe(NOTIFICATION_ROUTES.LEAVE)
  })

  it('treats an HR backdated entry as an employee update', () => {
    const payload = buildNotificationPayload(NOTIFICATION_KINDS.BACKDATED)
    expect(payload.title).toBe('ระบบใบลา')
    expect(payload.body).toBe('มีการอัปเดตใบลาของคุณ')
    expect(payload.route).toBe(NOTIFICATION_ROUTES.LEAVE)
  })

  it('never carries a personal field or a free-text URL', () => {
    for (const kind of REQUEST_KINDS) {
      const payload = buildNotificationPayload(kind, {
        requestId: '11111111-1111-4111-8111-111111111111',
        status: 'approved',
        employeeName: 'สมชาย ใจดี',
        employeeCode: 'EMP-999',
        department: 'การเงิน',
        leaveType: 'ลากิจ',
        date: '2026-11-10',
        reason: 'ธุระส่วนตัว',
        nationalId: '1234567890123',
      })
      const text = JSON.stringify(payload)
      expect(text).not.toMatch(/สมชาย|EMP-999|การเงิน|ลากิจ|2026-11-10|ธุระส่วนตัว|1234567890123/)
      expect(text).not.toMatch(/employeeName|employeeCode|department|leaveType|reason|nationalId/)
      expect(Object.keys(payload).sort()).toEqual(['body', 'kind', 'route', 'tag', 'title'])
    }
  })

  it('returns null for an unknown kind', () => {
    expect(buildNotificationPayload('leave_reminder')).toBe(null)
    expect(buildNotificationPayload(undefined)).toBe(null)
  })

  it('omits the old focus id and every URL field', () => {
    const payload = buildNotificationPayload(NOTIFICATION_KINDS.SUBMITTED, {
      requestId: 'a b&c',
    })
    expect(JSON.stringify(payload)).not.toContain('focus')
    expect(payload).not.toHaveProperty('url')
  })

  it('builds the signed-out notice as a count with the approvals route', () => {
    const payload = buildSignedOutPendingPayload(3)

    expect(payload.title).toBe('ระบบใบลา')
    expect(payload.body).toBe('คุณมีรายการรออนุมัติ 3 รายการ')
    expect(payload.route).toBe(NOTIFICATION_ROUTES.APPROVALS)
    expect(payload.kind).toBe(NOTIFICATION_KINDS.PENDING_SIGNED_OUT)
    expect(payload).not.toHaveProperty('url')
  })
})

describe('payloadFits', () => {
  it('accepts every real payload and rejects an oversized one', () => {
    for (const kind of REQUEST_KINDS) {
      expect(payloadFits(buildNotificationPayload(kind))).toBe(true)
    }
    expect(payloadFits(buildSignedOutPendingPayload(1))).toBe(true)
    expect(payloadFits({ body: 'x'.repeat(MAX_PAYLOAD_BYTES) })).toBe(false)
  })
})
