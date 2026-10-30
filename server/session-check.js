import { sha256Hex } from './crypto.js'
import { allowedLoginTypesFor, landingPathFor } from './access.js'
import { getSupabase } from './supabase.js'
import { sessionCookieName } from './session.js'

export const IDLE_TIMEOUT_MS = 15 * 60 * 1000

export async function readSession(req) {
  const token = req.cookies?.[sessionCookieName]
  if (!token) return { ok: false }

  try {
    const supabase = getSupabase()
    const now = new Date()
    const { data: session, error: sessionError } = await supabase
      .from('auth_sessions')
      .select('id, employee_id, last_active_at, login_role')
      .eq('token_hash', sha256Hex(token))
      .is('revoked_at', null)
      .gt('expires_at', now.toISOString())
      .maybeSingle()
    if (sessionError) throw sessionError
    if (!session) return { ok: false }

    const lastActiveAt = new Date(session.last_active_at).getTime()
    if (now.getTime() - lastActiveAt > IDLE_TIMEOUT_MS) {
      const { error } = await supabase.from('auth_sessions').update({
        revoked_at: now.toISOString(),
      }).eq('id', session.id).is('revoked_at', null)
      if (error) throw error
      return { ok: false }
    }

    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('id, is_active')
      .eq('id', session.employee_id)
      .maybeSingle()
    if (employeeError) throw employeeError
    if (!employee || !employee.is_active) {
      const { error } = await supabase.from('auth_sessions').update({
        revoked_at: now.toISOString(),
      }).eq('id', session.id).is('revoked_at', null)
      if (error) throw error
      return { ok: false }
    }

    const allowed = await allowedLoginTypesFor(session.employee_id)
    if (!allowed.includes(session.login_role)) {
      const { error } = await supabase.from('auth_sessions').update({
        revoked_at: now.toISOString(),
      }).eq('id', session.id).is('revoked_at', null)
      if (error) throw error
      return { ok: false }
    }

    const { error: touchError } = await supabase.from('auth_sessions').update({
      last_active_at: now.toISOString(),
    }).eq('id', session.id).is('revoked_at', null)
    if (touchError) throw touchError

    let hasPendingApprovals = false
    if (session.login_role === 'employee') {
      const { data: pending, error } = await supabase
        .from('leave_requests')
        .select('employee_id')
        .eq('approver_id', session.employee_id)
        .eq('status', 'pending')
        .limit(1)
      if (error) throw error
      hasPendingApprovals = pending.length > 0
    }
    const target = landingPathFor(session.login_role, hasPendingApprovals)
    return {
      ok: true,
      employeeId: session.employee_id,
      role: session.login_role,
      redirectTo: `/pending?to=${encodeURIComponent(target)}`,
    }
  } catch {
    return { ok: false }
  }
}
