import { describe, expect, it } from 'vitest'
import {
  LOCK_DURATION_MS,
  LOGIN_ROLE_BY_TYPE,
  MAX_FAILED_ATTEMPTS,
  PIN_INVALID_MESSAGE,
  PIN_LOCKED_MESSAGE,
  isLockActive,
  lockUntilFrom,
} from '../server/pin-verify.js'

describe('lockUntilFrom', () => {
  it('moves the lock time fifteen minutes past now', () => {
    const now = new Date('2026-10-30T10:00:00.000Z')
    expect(lockUntilFrom(now).toISOString()).toBe('2026-10-30T10:15:00.000Z')
  })

  it('keeps the lock window at fifteen minutes', () => {
    expect(LOCK_DURATION_MS).toBe(15 * 60 * 1000)
  })
})

describe('isLockActive', () => {
  const now = new Date('2026-10-30T10:00:00.000Z')

  it('is true while the lock time is still in the future', () => {
    expect(isLockActive('2026-10-30T10:15:00.000Z', now)).toBe(true)
  })

  it('is false once the lock time has passed', () => {
    expect(isLockActive('2026-10-30T09:59:59.000Z', now)).toBe(false)
  })

  it('is false when there is no lock', () => {
    expect(isLockActive(null, now)).toBe(false)
    expect(isLockActive(undefined, now)).toBe(false)
  })
})

describe('login role mapping', () => {
  it('maps each login type to the same role the login route used before', () => {
    expect(LOGIN_ROLE_BY_TYPE).toEqual({
      employee: 'employee',
      hr: 'hr',
      controller: 'meeting_controller',
      system: 'system_admin',
    })
  })

  it('locks after five failed attempts', () => {
    expect(MAX_FAILED_ATTEMPTS).toBe(5)
  })
})

describe('login messages', () => {
  it('keeps the generic invalid message', () => {
    expect(PIN_INVALID_MESSAGE).toBe('เลขบัตรประชาชนหรือ PIN ไม่ถูกต้อง')
  })

  it('keeps the locked message', () => {
    expect(PIN_LOCKED_MESSAGE).toBe('บัญชีถูกล็อกชั่วคราว')
  })
})
