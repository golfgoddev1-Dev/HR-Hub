import { randomBytes } from 'node:crypto'
import { sha256Hex } from './crypto.js'
import { getSupabase } from './supabase.js'

export const sessionCookieName = 'hr_session'

export async function createSession(employeeId, loginRole) {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000)
  const { error } = await getSupabase().from('auth_sessions').insert({
    employee_id: employeeId,
    token_hash: sha256Hex(token),
    created_at: now.toISOString(),
    last_active_at: now.toISOString(),
    expires_at: expires.toISOString(),
    login_role: loginRole,
  })
  if (error) throw error
  return token
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  }
}
