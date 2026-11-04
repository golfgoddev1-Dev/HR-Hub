// Values shown on the printable leave form (phase 4).
//
// Pure and timezone-explicit: the page and the test render the same strings, so
// a date shown on paper can never disagree with the row in the database.

export const PRINT_TIME_ZONE = 'Asia/Bangkok'
export const NO_VALUE = '-'

export const PRINT_STATUS_LABELS = {
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
}

const THAI_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
]

function text(value) {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return NO_VALUE
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : NO_VALUE
}

/** Bangkok calendar parts for a date, a timestamp or an ISO string. */
function bangkokParts(value) {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: PRINT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const out = {}
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = part.value
  }
  if (!out.year || !out.month || !out.day) return null
  return out
}

/** 2026-11-03 → "3 พ.ย. 2569" (Buddhist year). */
export function formatThaiDate(value) {
  const parts = bangkokParts(value)
  if (!parts) return NO_VALUE
  return `${Number(parts.day)} ${THAI_MONTHS[Number(parts.month) - 1]} ${Number(parts.year) + 543}`
}

/** "18:00:00" or an ISO timestamp → "18:00 น." */
export function formatThaiTime(value) {
  if (typeof value === 'string') {
    const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
    if (match) return `${match[1].padStart(2, '0')}:${match[2]} น.`
  }
  const parts = bangkokParts(value)
  if (!parts) return NO_VALUE
  return `${parts.hour}:${parts.minute} น.`
}

export function formatThaiDateTime(value) {
  const date = formatThaiDate(value)
  if (date === NO_VALUE) return NO_VALUE
  return `${date} ${formatThaiTime(value)}`
}

/** 0.5 is written as "ครึ่งวัน", never as "0.5 วัน". */
export function daysText(days) {
  if (days === null || days === undefined || days === '') return NO_VALUE
  const value = Number(days)
  if (!Number.isFinite(value)) return NO_VALUE
  if (value === 0.5) return 'ครึ่งวัน'
  return `${value} วัน`
}

export function certificateText(hasMedicalCertificate) {
  return hasMedicalCertificate === true ? 'ใช่' : 'ไม่ใช่'
}

export function isBackdatedRequest(request) {
  return request?.source === 'hr_backdated'
}

/** Only HR may open the printable form. */
export const PRINT_ALLOWED_ROLE = 'hr'

export function canPrintLeave(role) {
  return role === PRINT_ALLOWED_ROLE
}

function nameOf(person) {
  if (!person) return NO_VALUE
  const prefix = typeof person.namePrefix === 'string' ? person.namePrefix.trim() : ''
  const name = typeof person.fullName === 'string' ? person.fullName.trim() : ''
  if (name.length === 0) return NO_VALUE
  return `${prefix}${name}`
}

/**
 * Everything the printable form shows, already formatted.
 * There is deliberately no signature field: the form is not a signature sheet.
 */
export function leavePrintModel(source) {
  const request = source && typeof source === 'object' ? source : {}
  const requester = request.requester ?? {}
  const approver = request.approver ?? {}
  const shift = request.shift ?? null

  const shiftText = shift
    ? `${text(shift.label)} (${formatThaiTime(shift.timeFrom)} – ${formatThaiTime(shift.timeTo)})`
    : text(request.shiftCode)

  return {
    requestCode: text(request.requestCode),
    status: PRINT_STATUS_LABELS[request.status] ?? NO_VALUE,
    createdAt: formatThaiDate(request.createdAt),
    requesterName: nameOf(requester),
    requesterDepartment: text(request.departmentName ?? requester.departmentName),
    requesterPhone: text(requester.phone),
    leaveType: text(request.leaveTypeName),
    otherTypeDetail: text(request.otherTypeDetail),
    shiftText,
    ot: text(request.otOption),
    startDate: formatThaiDate(request.startDate),
    endDate: formatThaiDate(request.endDate),
    days: daysText(request.days),
    returnDate: formatThaiDate(request.returnDate),
    returnTime: formatThaiTime(request.returnTime),
    shiftEndTime: formatThaiTime(request.shiftEndOverride),
    reason: text(request.reason),
    approverName: nameOf(approver),
    decidedAt: request.decidedAt ? formatThaiDateTime(request.decidedAt) : NO_VALUE,
    cc: NO_VALUE,
    certificate: certificateText(request.hasMedicalCertificate),
    isBackdated: isBackdatedRequest(request),
  }
}
