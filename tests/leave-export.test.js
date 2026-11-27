import { describe, expect, it } from 'vitest'

import {
  EXPORT_MAX_PAGES,
  EXPORT_PAGE_SIZE,
  bangkokDateTime,
  collectLeaveRows,
  csvCell,
  exportFileName,
  exportQuery,
  leaveRowsToCsv,
} from '../src/lib/leave-export.js'
import { readSource } from './helpers/read-source.js'

const ROW = {
  requestCode: 'LV-20261101-ABC123',
  requester: { employeeCode: 'EMP001', fullName: 'สมชาย ใจดี' },
  departmentName: 'การเงิน, บัญชี',
  leaveTypeName: 'ลาป่วย',
  startDate: '2026-11-01',
  endDate: '2026-11-02',
  days: 2,
  status: 'approved',
  approver: { fullName: 'หัวหน้า "ทีม"' },
  createdAt: '2026-10-31T18:30:00Z',
  decidedAt: null,
  source: 'hr_backdated',
  reason: 'ป่วยเป็นไข้หวัด',
  decisionNote: 'หายไวๆ',
  attachmentPath: 'certs/secret.pdf',
}

describe('csv cells', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(2.5)).toBe('2.5')
  })

  it('keeps spreadsheet formulas as text', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+66')).toBe("'+66")
    expect(csvCell('-1')).toBe("'-1")
    expect(csvCell('@sum')).toBe("'@sum")
    expect(csvCell(-1)).toBe('-1')
  })
})

describe('the file', () => {
  it('starts with a BOM, uses CRLF and a Thai header row', () => {
    const csv = leaveRowsToCsv([ROW])
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0].split(',')[0]).toBe('รหัสใบลา')
    expect(lines).toHaveLength(3)
    expect(lines[2]).toBe('')
  })

  it('writes the row in Bangkok time with Thai status, and nothing private', () => {
    const csv = leaveRowsToCsv([ROW])
    expect(csv).toContain('LV-20261101-ABC123,EMP001,สมชาย ใจดี,"การเงิน, บัญชี",ลาป่วย,2026-11-01,2026-11-02,2,อนุมัติแล้ว')
    expect(csv).toContain('"หัวหน้า ""ทีม"""')
    expect(csv).toContain('2026-11-01 01:30')
    expect(csv).toContain(',ใช่')
    expect(csv).not.toContain('ไข้หวัด')
    expect(csv).not.toContain('หายไวๆ')
    expect(csv).not.toContain('secret.pdf')
  })

  it('formats Bangkok date-times and tolerates bad values', () => {
    expect(bangkokDateTime('2026-11-27T07:05:00Z')).toBe('2026-11-27 14:05')
    expect(bangkokDateTime(null)).toBe('')
    expect(bangkokDateTime('nope')).toBe('')
  })

  it('names the file from the date range', () => {
    expect(exportFileName({ from: '2026-11-01', to: '2026-11-30' }, '2026-11-27')).toBe('ใบลา-2026-11-01-ถึง-2026-11-30.csv')
    expect(exportFileName({ from: '2026-11-01' }, '2026-11-27')).toBe('ใบลา-2026-11-01-ถึง-ปัจจุบัน.csv')
    expect(exportFileName({}, '2026-11-27')).toBe('ใบลา-ทั้งหมด-2026-11-27.csv')
  })
})

describe('collecting every page', () => {
  it('sends the list filters with the largest page size the API allows', () => {
    const query = new URLSearchParams(exportQuery({ status: 'approved', from: '2026-11-01', departmentId: null }, 3))
    expect(Object.fromEntries(query)).toEqual({ status: 'approved', from: '2026-11-01', page: '3', pageSize: String(EXPORT_PAGE_SIZE) })
    expect(EXPORT_PAGE_SIZE).toBe(50)
  })

  it('follows hasMore until the last page', async () => {
    const seen = []
    const result = await collectLeaveRows(async (query) => {
      const page = Number(new URLSearchParams(query).get('page'))
      seen.push(page)
      return { ok: true, results: [{ requestCode: `p${page}` }], hasMore: page < 3, scanCapped: page === 2 }
    }, {})
    expect(seen).toEqual([1, 2, 3])
    expect(result.rows.map((row) => row.requestCode)).toEqual(['p1', 'p2', 'p3'])
    expect(result.truncated).toBe(false)
    expect(result.scanCapped).toBe(true)
  })

  it('stops at the page cap and says the file was cut', async () => {
    let calls = 0
    const result = await collectLeaveRows(async () => {
      calls += 1
      return { ok: true, results: [{}], hasMore: true }
    }, {})
    expect(calls).toBe(EXPORT_MAX_PAGES)
    expect(result.truncated).toBe(true)
  })

  it('throws on a failed page instead of writing half a file', async () => {
    await expect(
      collectLeaveRows(async (query) =>
        new URLSearchParams(query).get('page') === '1'
          ? { ok: true, results: [{}], hasMore: true }
          : { ok: false, message: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้' }
      , {})
    ).rejects.toMatchObject({ userMessage: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  })
})

describe('HR leave page wiring', () => {
  const PAGE = readSource('src/pages/HrLeaveRequestsPage.vue')

  it('exports the filters the list last loaded, not the unsaved ones', () => {
    expect(PAGE).toContain('appliedFilters.value = { ...filters.value }')
    expect(PAGE).toContain('collectLeaveRows(')
    expect(PAGE).toContain('appliedFilters.value')
  })
})
