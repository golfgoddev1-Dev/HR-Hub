import { describe, expect, it } from 'vitest'
import { clearSessionCookieOptions } from '../server/routes/auth.js'
import { sessionCookieName, sessionCookieOptions } from '../server/session.js'

describe('clearSessionCookieOptions', () => {
  it('expires the session cookie immediately', () => {
    expect(clearSessionCookieOptions().maxAge).toBe(0)
  })

  it('keeps the same cookie name, path, httpOnly, sameSite and secure as the login route', () => {
    const login = sessionCookieOptions()
    const cleared = clearSessionCookieOptions()
    expect(sessionCookieName).toBe('hr_session')
    expect(cleared.path).toBe(login.path)
    expect(cleared.httpOnly).toBe(login.httpOnly)
    expect(cleared.sameSite).toBe(login.sameSite)
    expect(cleared.secure).toBe(login.secure)
  })
})
