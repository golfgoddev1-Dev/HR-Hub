import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function hmacSha256Hex(key, text) {
  return createHmac('sha256', key).update(text, 'utf8').digest('hex')
}

export function timingSafeEqualHex(a, b) {
  if (!/^[a-f\d]{64}$/i.test(a) || !/^[a-f\d]{64}$/i.test(b)) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}
