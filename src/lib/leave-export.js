// CSV export of the HR leave list. It pages through the same endpoint the list
// already reads (/api/leave/hr/requests) with the filters the list last applied,
// so the file is exactly the list without the 20-row paging. Reasons, decision
// notes and certificate paths are left out: the file is for counting and
// reporting, and it leaves the system once it is downloaded.

export const EXPORT_PAGE_SIZE = 50
/** 40 pages of 50: past this the file is cut and the page says so. */
export const EXPORT_MAX_PAGES = 40

export const EXPORT_ERROR = 'ส่งออกไฟล์ไม่สำเร็จ กรุณาลองใหม่'

const STATUS_LABELS = {
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
}

const COLUMNS = [
  ['รหัสใบลา', (row) => row.requestCode],
  ['รหัสพนักงาน', (row) => row.requester?.employeeCode],
  ['ชื่อพนักงาน', (row) => row.requester?.fullName],
  ['แผนก', (row) => row.departmentName],
  ['ประเภทการลา', (row) => row.leaveTypeName],
  ['วันเริ่มลา', (row) => row.startDate],
  ['วันสิ้นสุด', (row) => row.endDate],
  ['จำนวนวัน', (row) => row.days],
  ['สถานะ', (row) => STATUS_LABELS[row.status] ?? row.status],
  ['ผู้อนุมัติ', (row) => row.approver?.fullName],
  ['วันที่ยื่น', (row) => bangkokDateTime(row.createdAt)],
  ['วันที่ตัดสิน', (row) => bangkokDateTime(row.decidedAt)],
  ['คีย์ย้อนหลังโดย HR', (row) => (row.source === 'hr_backdated' ? 'ใช่' : '')],
]

const dateTimeFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** "2026-11-27 14:05" in Bangkok time, or "" for no value. */
export function bangkokDateTime(iso) {
  if (typeof iso !== 'string' || iso.length === 0) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return dateTimeFormat.format(date).replace(', ', ' ')
}

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (= + - @ and the
 * tab/CR variants) gets a leading apostrophe, so a name typed as "=HYPERLINK(...)"
 * stays text when HR opens the file.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text
}

/** BOM + CRLF so Excel opens Thai text correctly without an import step. */
export function leaveRowsToCsv(rows) {
  const lines = [COLUMNS.map(([title]) => csvCell(title)).join(',')]
  for (const row of rows) lines.push(COLUMNS.map(([, read]) => csvCell(read(row))).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}

/** The list's query for one export page. Empty filters are left out, like the list. */
export function exportQuery(filters, page) {
  const params = new URLSearchParams()
  if (filters?.departmentId) params.set('departmentId', filters.departmentId)
  if (filters?.status) params.set('status', filters.status)
  if (filters?.leaveTypeId) params.set('leaveTypeId', filters.leaveTypeId)
  if (filters?.from) params.set('from', filters.from)
  if (filters?.to) params.set('to', filters.to)
  params.set('page', String(page))
  params.set('pageSize', String(EXPORT_PAGE_SIZE))
  return params.toString()
}

/**
 * Every row for `filters`, page by page. `fetchPage(query)` resolves to the
 * parsed reply and throws on a failed call; a reply that is not ok also throws,
 * so a half-read list never becomes a file.
 */
export async function collectLeaveRows(fetchPage, filters) {
  const rows = []
  let scanCapped = false
  for (let page = 1; page <= EXPORT_MAX_PAGES; page += 1) {
    const data = await fetchPage(exportQuery(filters, page))
    if (!data || data.ok !== true || !Array.isArray(data.results)) {
      const error = new Error('export page failed')
      error.userMessage = typeof data?.message === 'string' ? data.message : EXPORT_ERROR
      throw error
    }
    rows.push(...data.results)
    scanCapped = scanCapped || data.scanCapped === true
    if (data.hasMore !== true) return { rows, truncated: false, scanCapped }
  }
  return { rows, truncated: true, scanCapped }
}

/** "ใบลา-2026-11-01-ถึง-2026-11-30.csv", or "ใบลา-ทั้งหมด-<today>.csv" without a range. */
export function exportFileName(filters, today) {
  const from = filters?.from || ''
  const to = filters?.to || ''
  if (from || to) return `ใบลา-${from || 'ต้น'}-ถึง-${to || 'ปัจจุบัน'}.csv`
  return `ใบลา-ทั้งหมด-${today}.csv`
}
