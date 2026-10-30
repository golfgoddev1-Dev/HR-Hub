import bcrypt from 'bcryptjs'
import { allowedLoginTypesFor } from './access.js'
import { getSupabase } from './supabase.js'

export const PIN_INVALID_MESSAGE = 'เลขบัตรประชาชนหรือ PIN ไม่ถูกต้อง'
export const PIN_LOCKED_MESSAGE = 'บัญชีถูกล็อกชั่วคราว'
export const MAX_FAILED_ATTEMPTS = 5
export const LOCK_DURATION_MS = 15 * 60 * 1000

export const LOGIN_ROLE_BY_TYPE = {
  employee: 'employee',
  hr: 'hr',
  controller: 'meeting_controller',
  system: 'system_admin',
}

const CREDENTIAL_FIELDS =
  'employee_id, pin_hash, failed_attempts, locked_until, employees!inner(id, full_name, employee_code, is_active)'

export function lockUntilFrom(now) {
  return new Date(now.getTime() + LOCK_DURATION_MS)
}

export function isLockActive(lockedUntil, now) {
  return Boolean(lockedUntil) && new Date(lockedUntil) > now
}

function invalidRequest() {
  return { ok: false, status: 401, message: PIN_INVALID_MESSAGE }
}

async function loadCredentials(supabase, { employeeId, nationalIdHash }) {
  const base = supabase.from('employee_credentials').select(CREDENTIAL_FIELDS)
  const filtered =
    typeof nationalIdHash === 'string'
      ? base.eq('national_id_hash', nationalIdHash)
      : base.eq('employee_id', employeeId)
  const { data, error } = await filtered.maybeSingle()
  if (error) throw error
  return data ?? null
}

export async function verifyLoginPin({ employeeId, nationalIdHash, pin, loginType, loginRole }) {
  const role = loginRole ?? LOGIN_ROLE_BY_TYPE[loginType] ?? null
  const supabase = getSupabase()
  const credentials = await loadCredentials(supabase, { employeeId, nationalIdHash })
  const employee = credentials?.employees
  if (!credentials || !employee) return invalidRequest()
  if (!employee.is_active || credentials.pin_hash === null) return invalidRequest()

  const now = new Date()
  if (isLockActive(credentials.locked_until, now)) {
    return {
      ok: false,
      status: 423,
      message: PIN_LOCKED_MESSAGE,
      unlockAt: new Date(credentials.locked_until).toISOString(),
    }
  }

  const passwordMatches = await bcrypt.compare(pin, credentials.pin_hash)
  const allowed = passwordMatches ? await allowedLoginTypesFor(credentials.employee_id) : []
  if (!passwordMatches || !allowed.includes(role)) {
    const failed = credentials.failed_attempts + 1
    if (failed >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = lockUntilFrom(now)
      const { error } = await supabase
        .from('employee_credentials')
        .update({
          failed_attempts: 0,
          locked_until: lockedUntil.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq('employee_id', credentials.employee_id)
      if (error) throw error
      return {
        ok: false,
        status: 423,
        message: PIN_LOCKED_MESSAGE,
        unlockAt: lockedUntil.toISOString(),
      }
    }
    const { error } = await supabase
      .from('employee_credentials')
      .update({
        failed_attempts: failed,
        updated_at: now.toISOString(),
      })
      .eq('employee_id', credentials.employee_id)
    if (error) throw error
    return invalidRequest()
  }

  const { error: resetError } = await supabase
    .from('employee_credentials')
    .update({
      failed_attempts: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('employee_id', credentials.employee_id)
  if (resetError) throw resetError

  return { ok: true, employeeId: credentials.employee_id }
}
