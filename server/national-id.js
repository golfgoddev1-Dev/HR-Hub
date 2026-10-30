import { getRequiredEnv } from './config.js'
import { hmacSha256Hex } from './crypto.js'

export function normalizeNationalId(input) {
  return input.replace(/\D/g, '')
}

export function nationalIdHash(normalized) {
  return hmacSha256Hex(getRequiredEnv('NATIONAL_ID_PEPPER'), normalized)
}
