import { readSession } from '../session-check.js'

const SESSION_MESSAGE = 'ไม่ได้เข้าสู่ระบบ'
const FORBIDDEN_MESSAGE = 'ไม่มีสิทธิ์เข้าถึงส่วนนี้'

export function requireRole(...roles) {
  return async function roleGuard(req, res, next) {
    const session = await readSession(req)
    if (!session.ok) {
      return res.status(401).json({ ok: false, message: SESSION_MESSAGE })
    }
    if (!roles.includes(session.role)) {
      return res.status(403).json({ ok: false, message: FORBIDDEN_MESSAGE })
    }
    req.session = { employeeId: session.employeeId, role: session.role }
    return next()
  }
}
