import { describe, expect, it } from 'vitest'
import { isUniqueViolation } from '../server/unique-violation.js'

describe('isUniqueViolation', () => {
  it('returns true for the Postgres unique violation code', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
  })

  it('returns false for another error code', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
  })

  it('returns false when there is no error', () => {
    expect(isUniqueViolation(undefined)).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation({})).toBe(false)
  })
})
