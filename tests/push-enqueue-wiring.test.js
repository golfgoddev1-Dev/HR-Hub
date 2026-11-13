// Phase 3 enqueue wiring: the phase 2 fix-up must not drop a notification.
// A source check is enough here because each route's own behaviour is covered by
// the route tests; this only pins the three enqueue points and their kinds.

import { describe, expect, it } from 'vitest'

import { readSource } from './helpers/read-source.js'

const leave = readSource(new URL('../worker/src/routes/leave.js', import.meta.url))
const leaveHr = readSource(new URL('../worker/src/routes/leave-hr.js', import.meta.url))

function count(text, needle) {
  return text.split(needle).length - 1
}

describe('notification enqueue points', () => {
  it('queues once on submit and once on decide (employee route)', () => {
    expect(count(leave, 'enqueueNotificationSafely(')).toBe(2)
    expect(leave).toContain('NOTIFICATION_KINDS.SUBMITTED')
    expect(leave).toContain('NOTIFICATION_KINDS.DECIDED')
  })

  it('queues the HR backdated entry', () => {
    expect(count(leaveHr, 'enqueueNotificationSafely(')).toBe(1)
    expect(leaveHr).toContain('NOTIFICATION_KINDS.BACKDATED')
  })

  it('uses the leave-certificates bucket name for certificate cleanup', () => {
    const retention = readSource(
      new URL('../worker/src/leave-retention.js', import.meta.url)
    )
    expect(retention).toContain('CERT_BUCKET = "leave-certificates"')
    expect(retention).toContain('CERT_CLEANUP_CRON = "0 2 * * *"')
  })
})
