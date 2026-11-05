// Queue state machine: backoff steps, the five-attempt cap, and what happens
// when no subscription exists, one device fails, or every device fails.
import { describe, expect, it } from 'vitest'

import {
  MAX_ATTEMPTS,
  RETRY_DELAY_MINUTES,
  STALE_CLAIM_MINUTES,
  enqueueNotification,
  planRetry,
  planSendOutcome,
  retryDelayMinutes,
  staleClaimCutoff,
} from '../worker/src/push/queue.js'
import { NOTIFICATION_KINDS } from '../worker/src/push/payload.js'

const NOW = new Date('2026-11-03T00:00:00.000Z')
const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111'
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'

function plusMinutes(minutes) {
  return new Date(NOW.getTime() + minutes * 60000).toISOString()
}

describe('retryDelayMinutes', () => {
  it('follows the documented schedule', () => {
    expect(RETRY_DELAY_MINUTES).toEqual([1, 5, 15, 60, 240])
    expect(retryDelayMinutes(1)).toBe(1)
    expect(retryDelayMinutes(2)).toBe(5)
    expect(retryDelayMinutes(3)).toBe(15)
    expect(retryDelayMinutes(4)).toBe(60)
    expect(retryDelayMinutes(5)).toBe(240)
    // Anything beyond the table keeps the last delay.
    expect(retryDelayMinutes(9)).toBe(240)
  })
})

describe('planRetry', () => {
  it('backs off one minute on the first failure', () => {
    expect(planRetry({ attempts: 0, now: NOW })).toEqual({
      status: 'pending',
      attempts: 1,
      nextAttemptAt: plusMinutes(1),
    })
  })

  it('grows the delay with each failure', () => {
    expect(planRetry({ attempts: 1, now: NOW })).toEqual({
      status: 'pending',
      attempts: 2,
      nextAttemptAt: plusMinutes(5),
    })
    expect(planRetry({ attempts: 3, now: NOW })).toEqual({
      status: 'pending',
      attempts: 4,
      nextAttemptAt: plusMinutes(60),
    })
  })

  it('gives up on the fifth failure', () => {
    expect(planRetry({ attempts: MAX_ATTEMPTS - 1, now: NOW })).toEqual({
      status: 'failed',
      attempts: MAX_ATTEMPTS,
      nextAttemptAt: null,
    })
  })

  it('treats a missing attempts value as zero', () => {
    expect(planRetry({ now: NOW }).attempts).toBe(1)
    expect(planRetry({ attempts: null, now: NOW }).status).toBe('pending')
  })
})

describe('staleClaimCutoff', () => {
  it('releases a claim that never finished', () => {
    expect(STALE_CLAIM_MINUTES).toBe(10)
    expect(staleClaimCutoff(NOW)).toBe(plusMinutes(-10))
  })
})

describe('planSendOutcome', () => {
  it('cancels the row when the employee has no device', () => {
    expect(planSendOutcome({ results: [], attempts: 0, now: NOW })).toEqual({
      status: 'cancelled',
      attempts: 0,
      nextAttemptAt: null,
      sentAt: null,
      deactivated: [],
      error: 'no_subscription',
    })
  })

  it('marks the row sent when at least one device accepted it', () => {
    const outcome = planSendOutcome({
      results: [
        { ok: true, status: 201, gone: false, endpoint: 'https://push.test/a' },
        { ok: false, status: 500, gone: false, endpoint: 'https://push.test/b' },
      ],
      attempts: 2,
      now: NOW,
    })

    expect(outcome.status).toBe('sent')
    expect(outcome.sentAt).toBe(NOW.toISOString())
    expect(outcome.nextAttemptAt).toBe(null)
    expect(outcome.error).toBe('partial_failure')
    expect(outcome.deactivated).toEqual([])
  })

  it('keeps the row pending with a backoff when every device failed', () => {
    const outcome = planSendOutcome({
      results: [{ ok: false, status: 503, gone: false, endpoint: 'https://push.test/a' }],
      attempts: 0,
      now: NOW,
    })

    expect(outcome.status).toBe('pending')
    expect(outcome.attempts).toBe(1)
    expect(outcome.nextAttemptAt).toBe(plusMinutes(1))
    expect(outcome.error).toBe('http_503')
    expect(outcome.sentAt).toBe(null)
  })

  it('fails the row after the cap', () => {
    const outcome = planSendOutcome({
      results: [{ ok: false, status: 500, gone: false, endpoint: 'https://push.test/a' }],
      attempts: MAX_ATTEMPTS - 1,
      now: NOW,
    })

    expect(outcome.status).toBe('failed')
    expect(outcome.attempts).toBe(MAX_ATTEMPTS)
    expect(outcome.nextAttemptAt).toBe(null)
  })

  it('deactivates a subscription the push service reports as gone', () => {
    const outcome = planSendOutcome({
      results: [{ ok: false, status: 410, gone: true, endpoint: 'https://push.test/gone' }],
      attempts: 0,
      now: NOW,
    })
    expect(outcome.deactivated).toEqual(['https://push.test/gone'])
    expect(outcome.status).toBe('pending')
  })
})

describe('enqueueNotification', () => {
  it('stores the built payload and the employee id it was given', async () => {
    const rows = []
    const db = {
      insert: async (table, row) => {
        rows.push({ table, row })
        return { data: { id: 'queue-1' }, error: null }
      },
    }

    const result = await enqueueNotification(db, {
      employeeId: EMPLOYEE_ID,
      leaveRequestId: REQUEST_ID,
      kind: NOTIFICATION_KINDS.SUBMITTED,
      now: NOW,
    })

    // The id lets the route dispatch exactly this row right away.
    expect(result).toEqual({ ok: true, id: 'queue-1' })
    expect(rows).toHaveLength(1)
    expect(rows[0].table).toBe('notification_queue')
    expect(rows[0].row.employee_id).toBe(EMPLOYEE_ID)
    expect(rows[0].row.status).toBe('pending')
    expect(rows[0].row.attempts).toBe(0)
    expect(rows[0].row.next_attempt_at).toBe(NOW.toISOString())
    expect(rows[0].row.payload.title).toBe('มีใบลารออนุมัติ')
    expect(rows[0].row.payload.url).toBe(`/leave/approvals?focus=${REQUEST_ID}`)
  })

  it('refuses an unknown kind instead of queueing an empty notification', async () => {
    const rows = []
    const db = {
      insert: async (table, row) => {
        rows.push(row)
        return { error: null }
      },
    }

    const result = await enqueueNotification(db, {
      employeeId: EMPLOYEE_ID,
      kind: 'leave_reminder',
      now: NOW,
    })

    expect(result).toEqual({ ok: false, code: 'invalid_payload' })
    expect(rows).toHaveLength(0)
  })
})
