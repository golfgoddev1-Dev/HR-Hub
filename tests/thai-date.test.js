// The leave pages show every date through src/lib/thai-date.js: Thai month
// names with the Buddhist year, always on the Asia/Bangkok calendar.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import {
  NO_DATE,
  formatThaiDate,
  formatThaiDateLong,
  formatThaiDateRange,
  todayBangkokIso,
} from '../src/lib/thai-date.js'

const MODULE_URL = new URL('../src/lib/thai-date.js', import.meta.url).href
const runNode = promisify(execFile)

/** Run the helper in a child process whose local zone is `tz`. */
async function probeInZone(tz) {
  const script = `
    const dates = await import(${JSON.stringify(MODULE_URL)})
    console.log(JSON.stringify({
      date: dates.formatThaiDate('2026-11-05'),
      range: dates.formatThaiDateRange('2026-12-30', '2027-01-02'),
      today: dates.todayBangkokIso(new Date('2026-11-04T17:30:00.000Z')),
    }))
  `
  const { stdout } = await runNode(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  })
  return JSON.parse(stdout.trim())
}

describe('formatThaiDate', () => {
  it('writes a YYYY-MM-DD date with the Thai month and the Buddhist year', () => {
    expect(formatThaiDate('2026-11-05')).toBe('5 พ.ย. 2569')
    expect(formatThaiDate('2026-01-01')).toBe('1 ม.ค. 2569')
    expect(formatThaiDate('2026-12-31')).toBe('31 ธ.ค. 2569')
  })

  it('uses the Bangkok day for a timestamp', () => {
    expect(formatThaiDate('2026-11-02T20:00:00.000Z')).toBe('3 พ.ย. 2569')
    expect(formatThaiDate('2026-11-02T16:59:00.000Z')).toBe('2 พ.ย. 2569')
  })

  it('accepts a Date and keeps a UTC midnight on the same calendar day', () => {
    expect(formatThaiDate(new Date('2026-11-05T00:00:00.000Z'))).toBe('5 พ.ย. 2569')
  })

  it('returns a dash for a missing or unreadable value', () => {
    expect(formatThaiDate(null)).toBe(NO_DATE)
    expect(formatThaiDate(undefined)).toBe(NO_DATE)
    expect(formatThaiDate('')).toBe(NO_DATE)
    expect(formatThaiDate('   ')).toBe(NO_DATE)
    expect(formatThaiDate('not-a-date')).toBe(NO_DATE)
  })
})

describe('formatThaiDateLong', () => {
  it('spells out the weekday and the month', () => {
    expect(formatThaiDateLong('2026-11-05')).toBe('วันพฤหัสบดีที่ 5 พฤศจิกายน 2569')
    expect(formatThaiDateLong(null)).toBe(NO_DATE)
  })
})

describe('formatThaiDateRange', () => {
  it('joins two dates inside the same month', () => {
    expect(formatThaiDateRange('2026-11-01', '2026-11-05')).toBe('1 พ.ย. 2569 – 5 พ.ย. 2569')
  })

  it('crosses months', () => {
    expect(formatThaiDateRange('2026-11-28', '2026-12-02')).toBe('28 พ.ย. 2569 – 2 ธ.ค. 2569')
  })

  it('crosses years', () => {
    expect(formatThaiDateRange('2026-12-30', '2027-01-02')).toBe('30 ธ.ค. 2569 – 2 ม.ค. 2570')
    expect(formatThaiDateRange('2026-12-31', '2027-01-01')).toBe('31 ธ.ค. 2569 – 1 ม.ค. 2570')
  })

  it('collapses a one-day range and tolerates a missing end', () => {
    expect(formatThaiDateRange('2026-11-05', '2026-11-05')).toBe('5 พ.ย. 2569')
    expect(formatThaiDateRange('2026-11-05', null)).toBe('5 พ.ย. 2569')
    expect(formatThaiDateRange('2026-11-05', '')).toBe('5 พ.ย. 2569')
    expect(formatThaiDateRange(null, '2026-11-05')).toBe(NO_DATE)
  })
})

describe('todayBangkokIso', () => {
  it('reads the Bangkok calendar day, not the UTC day', () => {
    expect(todayBangkokIso(new Date('2026-11-04T16:59:00.000Z'))).toBe('2026-11-04')
    expect(todayBangkokIso(new Date('2026-11-04T17:00:00.000Z'))).toBe('2026-11-05')
    expect(todayBangkokIso(new Date('2026-11-04T17:30:00.000Z'))).toBe('2026-11-05')
  })

  it('returns YYYY-MM-DD for the current time', () => {
    expect(todayBangkokIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('gives the same answer whatever zone the machine is set to', async () => {
    // UTC+14 and UTC-11 are the extremes that would shift a naive local date.
    const zones = ['UTC', 'Asia/Bangkok', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Midway']
    const results = await Promise.all(
      zones.map(async (tz) => ({ tz, ...(await probeInZone(tz)) }))
    )

    for (const result of results) {
      expect(result.today, result.tz).toBe('2026-11-05')
      expect(result.date, result.tz).toBe('5 พ.ย. 2569')
      expect(result.range, result.tz).toBe('30 ธ.ค. 2569 – 2 ม.ค. 2570')
    }
  }, 60000)
})
