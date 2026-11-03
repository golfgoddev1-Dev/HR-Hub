// Node-only HMAC helper for the operator scripts (was server/crypto.js).
import { createHmac } from 'node:crypto'

export function hmacSha256Hex(key, text) {
  return createHmac('sha256', key).update(text, 'utf8').digest('hex')
}
