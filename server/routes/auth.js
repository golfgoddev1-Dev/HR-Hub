import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { landingPathFor } from '../access.js'
import { normalizeNationalId, nationalIdHash } from '../national-id.js'
import { hmacSha256Hex, sha256Hex, timingSafeEqualHex } from '../crypto.js'
import { getRequiredEnv } from '../config.js'
import { validatePin } from '../pin.js'
import { verifyLoginPin } from '../pin-verify.js'
import { getSupabase } from '../supabase.js'
import { createSession, sessionCookieName, sessionCookieOptions } from '../session.js'
import { readSession } from '../session-check.js'

const router = Router()
const loginSchema = z.object({
  loginType: z.enum(['employee', 'hr', 'controller', 'system']),
  nationalId: z.string(),
  pin: z.string(),
}).strict()
const SESSION_MESSAGE = 'ไม่ได้เข้าสู่ระบบ'
const setPinSchema = z.object({
  nationalId: z.string(),
  code: z.string(),
  pin: z.string(),
  pinConfirm: z.string(),
}).strict()
const SET_PIN_INVALID_MESSAGE = 'เลขบัตรประชาชนหรือรหัสจาก HR ไม่ถูกต้อง'

router.get('/me', async (req, res) => {
  const session = await readSession(req)
  if (!session.ok) return res.status(401).json({ ok: false, message: SESSION_MESSAGE })

  return res.status(200).json({
    ok: true,
    role: session.role,
    redirectTo: session.redirectTo,
  })
})

router.post('/set-pin', async (req, res) => {
  const parsed = setPinSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, message: 'ข้อมูลไม่ถูกต้อง' })

  const { nationalId, code, pin, pinConfirm } = parsed.data
  const normalized = normalizeNationalId(nationalId)
  if (!/^\d{13}$/.test(normalized)) {
    return res.status(400).json({ ok: false, message: 'ข้อมูลไม่ถูกต้อง' })
  }
  if (!/^\d{8}$/.test(code)) {
    return res.status(400).json({ ok: false, message: 'ข้อมูลไม่ถูกต้อง' })
  }
  const pinValidation = validatePin(pin)
  if (!pinValidation.ok) return res.status(400).json({ ok: false, message: pinValidation.message })
  if (pinConfirm !== pin) {
    return res.status(400).json({ ok: false, message: 'PIN ทั้งสองช่องไม่ตรงกัน' })
  }

  try {
    const supabase = getSupabase()
    const hash = nationalIdHash(normalized)
    const { data: credentials, error: credentialsError } = await supabase
      .from('employee_credentials')
      .select('employee_id, employees!inner(id, is_active)')
      .eq('national_id_hash', hash)
      .maybeSingle()
    if (credentialsError) throw credentialsError
    const employee = credentials?.employees
    if (!credentials || !employee) {
      return res.status(401).json({ ok: false, message: SET_PIN_INVALID_MESSAGE })
    }
    if (employee.is_active !== true) {
      return res.status(401).json({ ok: false, message: SET_PIN_INVALID_MESSAGE })
    }

    const now = new Date()
    const nowIso = now.toISOString()
    const { data: resetCode, error: resetCodeError } = await supabase
      .from('pin_reset_codes')
      .select('id, code_hash, attempts')
      .eq('employee_id', credentials.employee_id)
      .is('used_at', null)
      .gt('expires_at', nowIso)
      .lt('attempts', 5)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (resetCodeError) throw resetCodeError
    if (!resetCode) {
      return res.status(401).json({ ok: false, message: SET_PIN_INVALID_MESSAGE })
    }

    const expectedHash = hmacSha256Hex(
      getRequiredEnv('PIN_RESET_SECRET'),
      `${credentials.employee_id}:${code}`,
    )
    if (!timingSafeEqualHex(expectedHash, resetCode.code_hash)) {
      const attempts = resetCode.attempts + 1
      const update = { attempts }
      if (attempts >= 5) update.used_at = nowIso
      const { error } = await supabase
        .from('pin_reset_codes')
        .update(update)
        .eq('id', resetCode.id)
        .is('used_at', null)
      if (error) throw error
      return res.status(401).json({ ok: false, message: SET_PIN_INVALID_MESSAGE })
    }

    const pinHash = await bcrypt.hash(pin, 10)
    const { error: credentialUpdateError } = await supabase
      .from('employee_credentials')
      .update({
        pin_hash: pinHash,
        pin_set_at: nowIso,
        failed_attempts: 0,
        locked_until: null,
        updated_at: nowIso,
      })
      .eq('employee_id', credentials.employee_id)
    if (credentialUpdateError) throw credentialUpdateError

    const { error: codeUpdateError } = await supabase
      .from('pin_reset_codes')
      .update({ used_at: nowIso })
      .eq('id', resetCode.id)
      .is('used_at', null)
    if (codeUpdateError) throw codeUpdateError

    const { error: sessionRevokeError } = await supabase
      .from('auth_sessions')
      .update({ revoked_at: nowIso })
      .eq('employee_id', credentials.employee_id)
      .is('revoked_at', null)
    if (sessionRevokeError) throw sessionRevokeError

    const { error: auditError } = await supabase.from('audit_logs').insert({
      actor_id: credentials.employee_id,
      action: 'pin_set',
      entity: 'employee',
      entity_id: credentials.employee_id,
      detail: null,
    })
    if (auditError) throw auditError

    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[set-pin-error]', error && error.code)
    return res.status(500).json({ ok: false, message: 'ไม่สามารถตั้ง PIN ได้ กรุณาลองใหม่' })
  }
})

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, message: 'ข้อมูลไม่ถูกต้อง' })
  const { loginType, nationalId, pin } = parsed.data
  const loginRole = {
    employee: 'employee',
    hr: 'hr',
    controller: 'meeting_controller',
    system: 'system_admin',
  }[loginType]
  const normalized = normalizeNationalId(nationalId)
  if (!/^\d{13}$/.test(normalized) || !/^\d{6}$/.test(pin)) {
    return res.status(400).json({ ok: false, message: 'ข้อมูลไม่ถูกต้อง' })
  }

  try {
    const hash = nationalIdHash(normalized)
    const supabase = getSupabase()
    const verification = await verifyLoginPin({ nationalIdHash: hash, pin, loginType, loginRole })
    if (!verification.ok) {
      const body = { ok: false, message: verification.message }
      if (verification.unlockAt) body.lockedUntil = verification.unlockAt
      return res.status(verification.status).json(body)
    }
    const employeeId = verification.employeeId

    let hasPendingApprovals = false
    if (loginType === 'employee') {
      const { data: pending, error } = await supabase
        .from('leave_requests')
        .select('employee_id')
        .eq('approver_id', employeeId)
        .eq('status', 'pending')
        .limit(1)
      if (error) throw error
      hasPendingApprovals = pending.length > 0
    }

    const token = await createSession(employeeId, loginRole)
    res.cookie(sessionCookieName, token, sessionCookieOptions())
    const target = landingPathFor(loginRole, hasPendingApprovals)
    return res.status(200).json({
      ok: true,
      redirectTo: `/pending?to=${encodeURIComponent(target)}`,
    })
  } catch (err) {
    console.error("[login-error]", err && err.name, err && err.code, err && err.message)
    return res.status(500).json({ ok: false, message: 'ไม่สามารถเชื่อมต่อได้ กรุณาลองใหม่' })
  }
})

export function clearSessionCookieOptions() {
  return { ...sessionCookieOptions(), maxAge: 0 }
}

router.post('/logout', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const token = req.cookies?.[sessionCookieName]

  try {
    if (typeof token === 'string' && token.length > 0) {
      const supabase = getSupabase()
      const { data: revoked, error } = await supabase
        .from('auth_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('token_hash', sha256Hex(token))
        .is('revoked_at', null)
        .select('id, employee_id')
      if (error) throw error

      const session = Array.isArray(revoked) ? revoked[0] : null
      if (session) {
        try {
          await supabase.from('audit_logs').insert({
            actor_id: session.employee_id,
            action: 'logout',
            entity: 'auth_session',
            entity_id: session.id,
            detail: null,
          })
        } catch {
          // audit failure must not block logout
        }
      }
    }

    res.cookie(sessionCookieName, '', clearSessionCookieOptions())
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[logout-error]', error?.code ?? error?.name)
    res.cookie(sessionCookieName, '', clearSessionCookieOptions())
    return res.status(500).json({ ok: false, message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง' })
  }
})

export default router
