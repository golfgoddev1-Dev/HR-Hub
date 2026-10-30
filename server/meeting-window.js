import { randomBytes } from 'node:crypto'

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export function validateWindow({ openTime, cutoffTime }) {
  if (!TIME_PATTERN.test(openTime) || !TIME_PATTERN.test(cutoffTime)) {
    return { ok: false, message: 'รูปแบบเวลาไม่ถูกต้อง' }
  }
  if (openTime >= cutoffTime) {
    return { ok: false, message: 'เวลาเปิดรับต้องก่อนเวลาปิดรับ' }
  }
  return { ok: true }
}

export function buildRegisterUrl(origin, token) {
  if (typeof origin !== 'string' || origin.trim().length === 0) {
    throw new Error('origin is required')
  }
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('token is required')
  }
  const base = origin.trim().replace(/\/+$/, '')
  return `${base}/meeting/register?t=${encodeURIComponent(token)}`
}

export function newQrToken() {
  return randomBytes(32).toString('hex')
}
