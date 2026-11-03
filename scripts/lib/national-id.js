// Node-only national-ID hash for the operator scripts (was server/national-id.js).
import { getRequiredEnv } from './config.js'
import { hmacSha256Hex } from './crypto.js'

export function normalizeNationalId(input) {
  return String(input).replace(/\D/g, '')
}

export function nationalIdHash(normalized) {
  return hmacSha256Hex(getRequiredEnv('NATIONAL_ID_PEPPER'), normalized)
}
