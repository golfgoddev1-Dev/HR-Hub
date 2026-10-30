import { Router } from 'express'
import { z } from 'zod'
import { getSupabase } from '../supabase.js'
import { bangkokToday, resolveScanState } from '../register-window.js'
import { isUniqueViolation } from '../unique-violation.js'
import { STATUS_CODE_BY_LABEL, statusCodeFromLabel } from '../attendance-status.js'

const router = Router()

const LINK_ERROR_MESSAGE = 'ลิงก์ไม่ถูกต้อง กรุณาสแกน QR ใหม่อีกครั้ง'
const SERVER_ERROR_MESSAGE = 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'
const ROSTER_ERROR_MESSAGE = 'ไม่พบรายชื่อนี้ในรายชื่อการประชุม'
const DUPLICATE_MESSAGE = 'ท่านได้ลงทะเบียนสำหรับประชุมนี้แล้ว'
const INVALID_BODY_MESSAGE = 'ข้อมูลไม่ถูกต้อง'
const DASH = '-'

const STATUSES = Object.keys(STATUS_CODE_BY_LABEL)
const REASON_STATUSES = ['ติดงานด่วน', 'ลาประชุม']
const LEAVE_STATUS = 'ลาประชุม'
const SHIFTS = ['กะ A', 'กะ B']
const REASON_MAX_LENGTH = 200

const submitSchema = z.object({
  t: z.string().min(1),
  employeeId: z.uuid(),
  statusCode: z.string(),
  shift: z.string().nullish(),
  reason: z.string().nullish(),
}).strict()

function logError(error) {
  console.error('[register-error]', {
    code: error?.code,
    name: error?.name,
    constraint: error?.constraint,
  })
}

function toHm(value) {
  if (typeof value !== 'string' || value.length < 5) return null
  return value.slice(0, 5)
}

function formatSavedAt(date) {
  const day = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
  return `${day} · ${time} น.`
}

async function findTypeByToken(supabase, token) {
  if (typeof token !== 'string' || token.length === 0) return null
  const { data, error } = await supabase
    .from('meeting_types')
    .select('id, code, name, weekday, default_open_time, default_cutoff_time')
    .eq('qr_token', token)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

async function loadMonthlySessions(supabase, typeId) {
  const today = bangkokToday()
  const { data, error } = await supabase
    .from('meeting_sessions')
    .select('id, session_date, open_time, cutoff_time')
    .eq('meeting_type_id', typeId)
    .eq('session_date', today)
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    sessionDate: row.session_date,
    openTime: toHm(row.open_time),
    cutoffTime: toHm(row.cutoff_time),
  }))
}

async function resolveForType(supabase, type) {
  const sessions = type.code === 'monthly' ? await loadMonthlySessions(supabase, type.id) : []
  const state = resolveScanState({
    now: new Date(),
    typeCode: type.code,
    meetingDefaults: {
      weekday: type.weekday,
      openTime: toHm(type.default_open_time),
      cutoffTime: toHm(type.default_cutoff_time),
    },
    sessions,
  })
  return { state, sessions }
}

async function loadActiveEmployees(supabase, typeId) {
  const { data, error } = await supabase
    .from('meeting_roster')
    .select('employee_id, employees!meeting_roster_employee_id_fkey!inner(full_name, departments(name), positions(name))')
    .eq('meeting_type_id', typeId)
    .eq('is_active', true)
  if (error) throw error
  return (data ?? [])
    .map((row) => ({
      employeeId: row.employee_id,
      fullName: row.employees?.full_name ?? DASH,
      departmentName: row.employees?.departments?.name ?? DASH,
      positionName: row.employees?.positions?.name ?? DASH,
    }))
    .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), 'th'))
}

async function findSessionForDay(supabase, typeId, sessionDate) {
  const { data, error } = await supabase
    .from('meeting_sessions')
    .select('id')
    .eq('meeting_type_id', typeId)
    .eq('session_date', sessionDate)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

async function ensureSession(supabase, type, sessions, state) {
  if (type.code === 'sup') {
    const today = bangkokToday()
    const existing = await findSessionForDay(supabase, type.id, today)
    if (existing) return existing

    const { data: created, error: insertError } = await supabase
      .from('meeting_sessions')
      .insert({
        meeting_type_id: type.id,
        session_date: today,
        cycle_key: `sup-${today}`,
        open_time: toHm(type.default_open_time),
        cutoff_time: toHm(type.default_cutoff_time),
      })
      .select('id')
      .single()

    if (insertError) {
      if (!isUniqueViolation(insertError)) throw insertError
      const raced = await findSessionForDay(supabase, type.id, today)
      if (raced) return raced
      throw insertError
    }
    return created
  }

  const session = (sessions ?? []).find((row) => row.sessionDate === state.session?.sessionDate)
  return session ? { id: session.id } : null
}

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})

router.get('/context', async (req, res) => {
  try {
    const token = typeof req.query.t === 'string' ? req.query.t : ''
    const supabase = getSupabase()
    const type = await findTypeByToken(supabase, token)
    if (!type) return res.status(404).json({ ok: false, message: LINK_ERROR_MESSAGE })

    const { state } = await resolveForType(supabase, type)
    const payload = {
      ok: true,
      meetingName: type.name,
      state: state.state,
      statuses: STATUSES,
      shifts: SHIFTS,
      reasonStatuses: REASON_STATUSES,
      leaveStatus: LEAVE_STATUS,
    }
    if (state.message) payload.message = state.message
    if (state.state === 'before') {
      payload.openTime = state.openTime
      payload.cutoffTime = state.cutoffTime
    }
    if (state.state === 'open') {
      payload.openTime = state.session.openTime
      payload.cutoffTime = state.session.cutoffTime
      payload.employees = await loadActiveEmployees(supabase, type.id)
    }
    return res.status(200).json(payload)
  } catch (error) {
    logError(error)
    return res.status(500).json({ ok: false, message: SERVER_ERROR_MESSAGE })
  }
})

router.post('/submit', async (req, res) => {
  const parsed = submitSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, message: INVALID_BODY_MESSAGE })

  const { t, employeeId } = parsed.data
  const statusDbCode = statusCodeFromLabel(parsed.data.statusCode)
  if (statusDbCode === null) return res.status(400).json({ ok: false, message: INVALID_BODY_MESSAGE })
  const status = parsed.data.statusCode

  const shiftValue = parsed.data.shift ?? null
  if (status === LEAVE_STATUS) {
    if (!SHIFTS.includes(shiftValue)) {
      return res.status(400).json({ ok: false, message: INVALID_BODY_MESSAGE })
    }
  } else if (shiftValue !== null) {
    return res.status(400).json({ ok: false, message: INVALID_BODY_MESSAGE })
  }

  const needsReason = REASON_STATUSES.includes(status)
  const rawReason = parsed.data.reason ?? null
  const trimmedReason = typeof rawReason === 'string' ? rawReason.trim() : ''
  if (needsReason) {
    if (trimmedReason.length === 0 || trimmedReason.length > REASON_MAX_LENGTH) {
      return res.status(400).json({ ok: false, message: INVALID_BODY_MESSAGE })
    }
  } else if (trimmedReason.length > 0) {
    return res.status(400).json({ ok: false, message: INVALID_BODY_MESSAGE })
  }
  const reasonValue = needsReason ? trimmedReason : null
  const savedShift = status === LEAVE_STATUS ? shiftValue : null

  try {
    const supabase = getSupabase()
    const type = await findTypeByToken(supabase, t)
    if (!type) return res.status(404).json({ ok: false, message: LINK_ERROR_MESSAGE })

    const { state, sessions } = await resolveForType(supabase, type)
    if (state.state !== 'open') {
      return res.status(403).json({ ok: false, message: state.message })
    }

    const { data: rosterRow, error: rosterError } = await supabase
      .from('meeting_roster')
      .select('employee_id')
      .eq('meeting_type_id', type.id)
      .eq('employee_id', employeeId)
      .eq('is_active', true)
      .maybeSingle()
    if (rosterError) throw rosterError
    if (!rosterRow) return res.status(400).json({ ok: false, message: ROSTER_ERROR_MESSAGE })

    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('id, full_name, department_id, position_id, departments(name), positions(name)')
      .eq('id', employeeId)
      .maybeSingle()
    if (employeeError) throw employeeError
    if (!employee) return res.status(400).json({ ok: false, message: ROSTER_ERROR_MESSAGE })

    const session = await ensureSession(supabase, type, sessions, state)
    if (!session) return res.status(500).json({ ok: false, message: SERVER_ERROR_MESSAGE })

    const { data: existing, error: existingError } = await supabase
      .from('meeting_attendance')
      .select('id')
      .eq('session_id', session.id)
      .eq('employee_id', employeeId)
      .maybeSingle()
    if (existingError) throw existingError
    if (existing) return res.status(409).json({ ok: false, message: DUPLICATE_MESSAGE })

    const now = new Date()
    const { error: insertError } = await supabase.from('meeting_attendance').insert({
      session_id: session.id,
      employee_id: employeeId,
      status_code: statusDbCode,
      reason: reasonValue,
      shift: savedShift,
      department_id: employee.department_id ?? null,
      position_id: employee.position_id ?? null,
      registered_at: now.toISOString(),
    })
    if (insertError) {
      if (isUniqueViolation(insertError)) {
        return res.status(409).json({ ok: false, message: DUPLICATE_MESSAGE })
      }
      throw insertError
    }

    return res.status(200).json({
      ok: true,
      summary: {
        name: employee.full_name ?? DASH,
        dept: employee.departments?.name ?? DASH,
        level: employee.positions?.name ?? DASH,
        status,
        shift: savedShift,
        meetingName: type.name,
        savedAt: formatSavedAt(now),
      },
    })
  } catch (error) {
    logError(error)
    return res.status(500).json({ ok: false, message: SERVER_ERROR_MESSAGE })
  }
})

export default router
