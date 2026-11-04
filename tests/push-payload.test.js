// Payload builder: generic wording only, a same-origin link, and nothing that
// reveals why someone is on leave.
import { describe, expect, it } from 'vitest'

import {
  MAX_PAYLOAD_BYTES,
  NOTIFICATION_KINDS,
  buildNotificationPayload,
  payloadFits,
} from '../worker/src/push/payload.js'

const REQUEST_ID = '11111111-1111-4111-8111-111111111111'

describe('buildNotificationPayload', () => {
  it('sends the approver to the approval queue', () => {
    const payload = buildNotificationPayload(NOTIFICATION_KINDS.SUBMITTED, {
      requestId: REQUEST_ID,
    })
    expect(payload.title).toBe('มีใบลารออนุมัติ')
    expect(payload.body).toBe('มีใบลาใหม่รอการอนุมัติ')
    expect(payload.url).toBe(`/leave/approvals?focus=${REQUEST_ID}`)
    expect(payload.tag).toBe('leave-submitted')
  })

  it('sends the owner to their own list with the decision only', () => {
    const approved = buildNotificationPayload(NOTIFICATION_KINDS.DECIDED, {
      requestId: REQUEST_ID,
      status: 'approved',
    })
    expect(approved.body).toBe('สถานะใบลา: อนุมัติแล้ว')
    expect(approved.url).toBe(`/leave?focus=${REQUEST_ID}`)

    const rejected = buildNotificationPayload(NOTIFICATION_KINDS.DECIDED, {
      requestId: REQUEST_ID,
      status: 'rejected',
    })
    expect(rejected.body).toBe('สถานะใบลา: ไม่อนุมัติ')
    expect(rejected.body).not.toContain('เหตุผล')
  })

  it('covers an HR backdated entry', () => {
    const payload = buildNotificationPayload(NOTIFICATION_KINDS.BACKDATED, {
      requestId: REQUEST_ID,
    })
    expect(payload.title).toBe('มีใบลาที่ HR บันทึกให้')
    expect(payload.url).toBe(`/leave?focus=${REQUEST_ID}`)
  })

  it('never carries a leave type, reason, date or health detail', () => {
    for (const kind of Object.values(NOTIFICATION_KINDS)) {
      const payload = buildNotificationPayload(kind, { requestId: REQUEST_ID, status: 'approved' })
      const text = JSON.stringify(payload)
      expect(text).not.toMatch(/ป่วย|ใบรับรองแพทย์|โรงพยาบาล|ลากิจ|ลาพักร้อน/)
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/)
      expect(Object.keys(payload).sort()).toEqual(['body', 'kind', 'tag', 'title', 'url'])
    }
  })

  it('returns null for an unknown kind', () => {
    expect(buildNotificationPayload('leave_reminder', { requestId: REQUEST_ID })).toBe(null)
    expect(buildNotificationPayload(undefined)).toBe(null)
  })

  it('keeps the focus id encoded and omits it when absent', () => {
    const withoutId = buildNotificationPayload(NOTIFICATION_KINDS.SUBMITTED, {})
    expect(withoutId.url).toBe('/leave/approvals')

    const encoded = buildNotificationPayload(NOTIFICATION_KINDS.SUBMITTED, {
      requestId: 'a b&c',
    })
    expect(encoded.url).toBe('/leave/approvals?focus=a%20b%26c')
  })
})

describe('payloadFits', () => {
  it('accepts every real payload and rejects an oversized one', () => {
    for (const kind of Object.values(NOTIFICATION_KINDS)) {
      expect(payloadFits(buildNotificationPayload(kind, { requestId: REQUEST_ID }))).toBe(true)
    }
    expect(payloadFits({ body: 'x'.repeat(MAX_PAYLOAD_BYTES) })).toBe(false)
  })
})
