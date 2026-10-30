import { afterEach, describe, expect, it } from 'vitest'
import { nationalIdHash, normalizeNationalId } from '../server/national-id.js'

const originalPepper = process.env.NATIONAL_ID_PEPPER

afterEach(() => {
  if (originalPepper === undefined) delete process.env.NATIONAL_ID_PEPPER
  else process.env.NATIONAL_ID_PEPPER = originalPepper
})

describe('national ID helpers', () => {
  it('removes every non-digit character', () => {
    expect(normalizeNationalId('1-2345-67890-12-3')).toBe('1234567890123')
  })

  it('returns a deterministic lowercase 64-character hash', () => {
    process.env.NATIONAL_ID_PEPPER = 'test-pepper-only'
    const first = nationalIdHash('1234567890123')
    expect(first).toMatch(/^[a-f\d]{64}$/)
    expect(nationalIdHash('1234567890123')).toBe(first)
  })
})
