// Messages and the reject-reason rule for the public approval page.
//
// The rule is the one the in-app reject flow uses: whitespace is collapsed,
// at least one visible character is required and the note is capped at 500
// code points. The page disables its submit button until the rule passes.

export const APPROVAL_LINK_MESSAGE = 'ลิงก์นี้ใช้ไม่ได้แล้ว'
export const APPROVAL_APPROVED_MESSAGE = 'อนุมัติแล้ว'
export const APPROVAL_REJECTED_MESSAGE = 'ไม่อนุมัติแล้ว'
export const APPROVAL_LOAD_ERROR = 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่'
export const APPROVAL_ACTION_ERROR = 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่'
export const REJECT_REASON_REQUIRED = 'กรุณาระบุเหตุผลที่ไม่อนุมัติ'
export const REJECT_REASON_MAX_LENGTH = 500
export const REJECT_REASON_TOO_LONG = `เหตุผลต้องไม่เกิน ${REJECT_REASON_MAX_LENGTH} ตัวอักษร`

// Category only, no personal data.
export const INVALID_LINK_LABELS = {
  expired: 'ลิงก์หมดอายุแล้ว',
  used: 'ลิงก์นี้ถูกใช้ไปแล้ว',
  invalid: 'ลิงก์ไม่ถูกต้องหรือถูกแทนที่แล้ว',
}

export function invalidLinkLabel(category) {
  return INVALID_LINK_LABELS[category] ?? INVALID_LINK_LABELS.invalid
}

export function normalizeReason(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/** Empty string when the reason is acceptable, otherwise the message to show. */
export function reasonError(value) {
  const reason = normalizeReason(value)
  if (reason.length === 0) return REJECT_REASON_REQUIRED
  if (Array.from(reason).length > REJECT_REASON_MAX_LENGTH) return REJECT_REASON_TOO_LONG
  return ''
}

export function daysLabel(days) {
  const value = Number(days)
  if (!Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? `${value} วัน` : `${value} วัน (ครึ่งวัน)`
}

export function approvalPathForToken(token) {
  return `/api/approve-link/${encodeURIComponent(String(token ?? ''))}`
}
