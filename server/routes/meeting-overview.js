import { Router } from 'express'
import { z } from 'zod'
import { getSupabase } from '../supabase.js'
import { requireRole } from '../middleware/require-role.js'
import { bangkokToday } from '../register-window.js'
import { countByStatus, findPending, sessionPhase } from '../meeting-overview.js'

const router = Router()

const SERVER_ERROR_MESSAGE = 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'
const TYPE_ERROR_MESSAGE = 'ประเภทการประชุมไม่ถูกต้อง'
const DASH = '-'
const MEETING_CODES = ['sup', 'monthly']
const PENDING_FIELDS = 'employee_id, employees!meeting_roster_employee_id_fkey!inner(full_name, departments(name), positions(name))'

const pendingSchema = z.object({
  code: z.enum(['sup', 'monthly']),
}).strict()

function logError(error) {
  console.error('[meeting-overview-error]', { code: error?.code, name: error?.name })
}

function toHm(value) {
  if (typeof value !== 'string' || value.length < 5) return null
  return value.slice(0, 5)
}

function weekdayOf(dateText) {
  const [year, month, day] = dateText.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function formatDateText(now) {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(now)
}

async function loadTypes(supabase) {
  const { data, error } = await supabase
    .from('meeting_types')
    .select('id, code, name, weekday, default_open_time, default_cutoff_time')
    .in('code', MEETING_CODES)
  if (error) throw error
  return data ?? []
}

async function loadSession(supabase, typeId, sessionDate) {
  const { data, error } = await supabase
    .from('meeting_sessions')
    .select('id, open_time, cutoff_time')
    .eq('meeting_type_id', typeId)
    .eq('session_date', sessionDate)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

async function loadCounts(supabase, sessionId) {
  if (!sessionId) return countByStatus([])
  const { data, error } = await supabase
    .from('meeting_attendance')
    .select('status_code')
    .eq('session_id', sessionId)
  if (error) throw error
  return countByStatus(data ?? [])
}

async function loadRosterCount(supabase, typeId) {
  if (!typeId) return 0
  const { count, error } = await supabase
    .from('meeting_roster')
    .select('employee_id', { count: 'exact', head: true })
    .eq('meeting_type_id', typeId)
    .eq('is_active', true)
  if (error) throw error
  return count ?? 0
}

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
router.use(requireRole('meeting_controller'))

router.get('/', async (_req, res) => {
  try {
    const supabase = getSupabase()
    const now = new Date()
    const today = bangkokToday(now)
    const todayWeekday = weekdayOf(today)
    const types = await loadTypes(supabase)
    const supType = types.find((row) => row.code === 'sup') ?? null
    const monthlyType = types.find((row) => row.code === 'monthly') ?? null

    const supRosterCount = await loadRosterCount(supabase, supType?.id ?? null)
    let sup
    const isTuesday = supType !== null && supType.weekday === todayWeekday
    if (!isTuesday) {
      sup = { hasSession: false, rosterCount: supRosterCount }
    } else {
      const session = await loadSession(supabase, supType.id, today)
      const openTime = toHm(supType.default_open_time) ?? toHm(session?.open_time)
      const cutoffTime = toHm(supType.default_cutoff_time) ?? toHm(session?.cutoff_time)
      sup = {
        hasSession: true,
        openTime,
        cutoffTime,
        phase: sessionPhase({ now, openTime, cutoffTime }),
        counts: await loadCounts(supabase, session?.id ?? null),
        rosterCount: supRosterCount,
      }
    }

    const monthlyRosterCount = await loadRosterCount(supabase, monthlyType?.id ?? null)
    const monthlySession = monthlyType
      ? await loadSession(supabase, monthlyType.id, today)
      : null
    let monthly
    if (!monthlySession) {
      monthly = { hasSession: false, rosterCount: monthlyRosterCount }
    } else {
      const openTime = toHm(monthlySession.open_time)
      const cutoffTime = toHm(monthlySession.cutoff_time)
      monthly = {
        hasSession: true,
        openTime,
        cutoffTime,
        phase: sessionPhase({ now, openTime, cutoffTime }),
        counts: await loadCounts(supabase, monthlySession.id),
        rosterCount: monthlyRosterCount,
      }
    }

    return res.status(200).json({
      ok: true,
      today: { dateText: formatDateText(now), sup, monthly },
    })
  } catch (error) {
    logError(error)
    return res.status(500).json({ ok: false, message: SERVER_ERROR_MESSAGE })
  }
})

router.get('/pending', async (req, res) => {
  const parsed = pendingSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ ok: false, message: TYPE_ERROR_MESSAGE })
  const { code } = parsed.data

  try {
    const supabase = getSupabase()
    const today = bangkokToday()
    const types = await loadTypes(supabase)
    const type = types.find((row) => row.code === code) ?? null
    if (!type) return res.status(400).json({ ok: false, message: TYPE_ERROR_MESSAGE })

    const session = await loadSession(supabase, type.id, today)
    if (!session) return res.status(200).json({ ok: true, code, sessionDate: null, pending: [] })

    const { data: rosterRows, error: rosterError } = await supabase
      .from('meeting_roster')
      .select(PENDING_FIELDS)
      .eq('meeting_type_id', type.id)
      .eq('is_active', true)
    if (rosterError) throw rosterError

    const { data: attendanceRows, error: attendanceError } = await supabase
      .from('meeting_attendance')
      .select('employee_id')
      .eq('session_id', session.id)
    if (attendanceError) throw attendanceError

    const roster = (rosterRows ?? []).map((row) => ({
      employeeId: row.employee_id,
      fullName: row.employees?.full_name ?? DASH,
      departmentName: row.employees?.departments?.name ?? DASH,
      positionName: row.employees?.positions?.name ?? DASH,
    }))

    const pending = findPending(roster, attendanceRows ?? []).map((item) => ({
      fullName: item.fullName,
      departmentName: item.departmentName,
      positionName: item.positionName,
    }))

    return res.status(200).json({ ok: true, code, sessionDate: today, pending })
  } catch (error) {
    logError(error)
    return res.status(500).json({ ok: false, message: SERVER_ERROR_MESSAGE })
  }
})

export default router
