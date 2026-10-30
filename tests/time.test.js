import { describe, expect, it } from 'vitest'
import { formatBangkokDate, formatBangkokTime } from '../server/time.js'

describe('Bangkok time formatting', () => {
  it('formats the requested ISO timestamp as local time', () => {
    expect(formatBangkokTime('2026-10-29T08:30:00Z')).toBe('15:30 น.')
  })

  it('formats a date using the Thai long date style', () => {
    expect(formatBangkokDate('2026-10-29T08:30:00Z')).toContain('29')
  })
})
