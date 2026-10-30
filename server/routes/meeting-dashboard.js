import { Router } from 'express'
import { z } from 'zod'
import { getSupabase } from '../supabase.js'
import { requireRole } from '../middleware/require-role.js'
import { STATUS_LABEL_BY_CODE } from '../meeting-overview.js'
import { verifyLoginPin } from '../pin-verify.js'
import {
  EMPTY_MESSAGE,
  bangkokDayKey,
  countByStatus,
  deptSummary,
  historyKeys,
  latestPerEmployee,
  rateOf,
  thaiDateLabel,
  thaiMonthLabel,
  thaiShortDateLabel,
  topAbsentPerDept,
} from '../meeting-dashboard.js'

const router = Router()

const SERVER_ERROR_MESSAGE = 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'
const TYPE_ERROR_MESSAGE = 'ประเภทการประชุมไม่ถูกต้อง'
const INVALID_INPUT_MESSAGE = 'ข้อมูลไม่ถูกต้อง'
const NO_REASON_MESSAGE = 'สถานะนี้ไม่มีเหตุผล'
const NO_ROW_MESSAGE = 'ไม่พบข้อมูลของคนนี้ในรอบนี้'
const DASH = '-'
const SESSION_LIMIT = 400
const LOAD_CHUNK = 100
const REASON_STATUS_CODES = ['urgent_busy', 'leave']

const STATUS_LABELS = Object.values(STATUS_LABEL_BY_CODE)
const NOT_YET_LABEL = 'ยังไม่ลงทะเบียน'
const STATUS_ORDER = new Map(STATUS_LABELS.map((label, index) => [label, index]))

const dashboardSchema = z.object({
  code: z.enum(['sup', 'monthly']),
  mode: z.enum(['day', 'month', 'year']).optional(),
  value: z.string().max(10).optional(),
})

const cyclesSchema = z.object({
  code: z.enum(['sup', 'monthly']),
})

const deptSchema = z.object({
  code: z.enum(['sup', 'monthly']),
  cycle: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  dept: z.string().min(1).max(200),
})

const monthlySummarySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
})

const reasonSchema = z
  .object({
    pin: z.string().regex(/^\d{6}$/),
    code: z.enum(['sup', 'monthly']),
    cycle: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
    employeeId: z.uuid(),
  })
  .strict()

const ROSTER_FIELDS =
  'employee_id, employees!meeting_roster_employee_id_fkey!inner(full_name, department_id, departments(name), positions(name))'

function logError(error) {
  console.error('[meeting-dashboard-error]', error?.code ?? error?.name)
}

function emptyLabelCounts() {
  const counts = {}
  for (const label of STATUS_LABELS) counts[label] = 0
  return counts
}

function timeOfDay(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

function cycleKeyOf(code, sessionDate) {
  const text = typeof sessionDate === 'string' ? sessionDate : ''
  return code === 'sup' ? text : text.slice(0, 7)
}

function nextMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  const next = new Date(Date.UTC(year, month, 1, 12))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
}

async function loadCycleSessions(supabase, typeId, code, cycle) {
  const base = supabase
    .from('meeting_sessions')
    .select('id, session_date')
    .eq('meeting_type_id', typeId)
  const query =
    code === 'sup'
      ? base.eq('session_date', cycle)
      : base
          .gte('session_date', `${cycle}-01`)
          .lt('session_date', `${nextMonthKey(cycle)}-01`)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

function cycleLabel(code, key) {
  return code === 'sup' ? thaiShortDateLabel(key) : thaiMonthLabel(key)
}

function cycleFullLabel(code, key) {
  return code === 'sup' ? thaiDateLabel(key) : thaiMonthLabel(key)
}

async function loadType(supabase, code) {
  const { data, error } = await supabase
    .from('meeting_types')
    .select('id, code, name')
    .eq('code', code)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

async function loadSessions(supabase, typeId) {
  const { data, error } = await supabase
    .from('meeting_sessions')
    .select('id, session_date')
    .eq('meeting_type_id', typeId)
    .order('session_date', { ascending: false })
    .limit(SESSION_LIMIT)
  if (error) throw error
  return data ?? []
}

async function loadAttendance(supabase, sessionIds) {
  const rows = []
  for (let index = 0; index < sessionIds.length; index += LOAD_CHUNK) {
    const chunk = sessionIds.slice(index, index + LOAD_CHUNK)
    const { data, error } = await supabase
      .from('meeting_attendance')
      .select('id, session_id, employee_id, status_code, reason, shift, registered_at')
      .in('session_id', chunk)
    if (error) throw error
    rows.push(...(data ?? []))
  }
  return rows
}

async function loadContext(supabase, code) {
  const type = await loadType(supabase, code)
  if (!type) return null

  const sessions = await loadSessions(supabase, type.id)
  const attendance = await loadAttendance(supabase, sessions.map((row) => row.id))
  const dateBySession = new Map(sessions.map((row) => [row.id, row.session_date]))

  const rowsByCycle = new Map()
  for (const row of attendance) {
    const sessionDate = dateBySession.get(row.session_id)
    if (!sessionDate) continue
    const key = cycleKeyOf(code, sessionDate)
    if (!key) continue
    const list = rowsByCycle.get(key) ?? []
    list.push(row)
    rowsByCycle.set(key, list)
  }

  const availableKeys = [...rowsByCycle.keys()].sort((a, b) => a.localeCompare(b))
  return { type, sessions, rowsByCycle, availableKeys }
}

async function loadRoster(supabase, typeId) {
  const { data, error } = await supabase
    .from('meeting_roster')
    .select(ROSTER_FIELDS)
    .eq('meeting_type_id', typeId)
    .eq('is_active', true)
  if (error) throw error

  return (data ?? []).map((row) => ({
    employeeId: row.employee_id,
    fullName: row.employees?.full_name ?? DASH,
    departmentName: row.employees?.departments?.name ?? DASH,
    positionName: row.employees?.positions?.name ?? DASH,
  }))
}

async function loadEmployees(supabase, employeeIds) {
  const map = new Map()
  const unique = [...new Set(employeeIds.filter((id) => typeof id === 'string' && id.length > 0))]
  for (let index = 0; index < unique.length; index += LOAD_CHUNK) {
    const chunk = unique.slice(index, index + LOAD_CHUNK)
    const { data, error } = await supabase
      .from('employees')
      .select('id, full_name, departments(name), positions(name)')
      .in('id', chunk)
    if (error) throw error
    for (const row of data ?? []) {
      map.set(row.id, {
        fullName: row.full_name ?? DASH,
        departmentName: row.departments?.name ?? DASH,
        positionName: row.positions?.name ?? DASH,
      })
    }
  }
  return map
}

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
router.use(requireRole('meeting_controller'))

router.get('/', async (req, res) => {
  const parsed = dashboardSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ ok: false, message: INVALID_INPUT_MESSAGE })
  const { code } = parsed.data
  const mode = parsed.data.mode ?? 'day'
  const value = typeof parsed.data.value === 'string' ? parsed.data.value.trim() : ''

  try {
    const supabase = getSupabase()
    const context = await loadContext(supabase, code)
    if (!context) return res.status(400).json({ ok: false, message: TYPE_ERROR_MESSAGE })

    const roster = await loadRoster(supabase, context.type.id)
    const currentKey = context.availableKeys[context.availableKeys.length - 1] ?? ''
    const currentRows = currentKey ? context.rowsByCycle.get(currentKey) ?? [] : []
    const currentLatest = latestPerEmployee(currentRows)
    const currentCounts = countByStatus(currentLatest)

    const rosterIds = new Set(roster.map((member) => member.employeeId))
    const registeredInRoster = currentLatest.filter((row) => rosterIds.has(row.employee_id)).length

    const keys = historyKeys({ code, mode, value, availableKeys: context.availableKeys })
    const cycles = keys.map((key) => {
      const rows = key === currentKey ? currentRows : context.rowsByCycle.get(key) ?? []
      const counts = countByStatus(latestPerEmployee(rows))
      return {
        key,
        label: cycleLabel(code, key),
        fullLabel: cycleFullLabel(code, key),
        counts,
        total: counts.total,
        rate: rateOf(counts.attended, counts.total),
      }
    })

    const todayByStatus = emptyLabelCounts()
    for (const [statusCode, count] of Object.entries(currentCounts)) {
      if (statusCode === 'total') continue
      const label = STATUS_LABEL_BY_CODE[statusCode]
      if (label) todayByStatus[label] = count
    }

    const options = context.availableKeys.map((key) => ({
      key,
      label: cycleFullLabel(code, key),
    }))

    return res.status(200).json({
      ok: true,
      meeting: {
        code,
        name: context.type.name,
        periodLabel: code === 'sup' ? 'รายสัปดาห์ · ทุกวันอังคาร' : 'รายเดือน',
      },
      updated: new Date().toISOString(),
      todayKey: bangkokDayKey(new Date()),
      current: {
        key: currentKey,
        label: currentKey ? cycleFullLabel(code, currentKey) : EMPTY_MESSAGE,
      },
      statuses: STATUS_LABELS,
      rosterCount: roster.length,
      today: {
        registered: currentCounts.total,
        byStatus: todayByStatus,
        notYet: Math.max(roster.length - registeredInRoster, 0),
      },
      depts: deptSummary(roster, currentLatest),
      history: {
        mode,
        key: value || currentKey,
        options,
        cycles,
        empty: context.availableKeys.length === 0,
        emptyMessage: EMPTY_MESSAGE,
      },
    })
  } catch (error) {
    logError(error)
    return res.status(500).json({ ok: false, message: SERVER_ERROR_MESSAGE })
  }
})

router.get('/cycles', async (req, res) => {
  const parsed = cyclesSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ ok: false, message: INVALID_INPUT_MESSAGE })

  try {
    const supabase = getSupabase()
    const context = await loadContext(supabase, parsed.data.code)
    if (!context) return res.status(400).json({ ok: false, message: TYPE_ERROR_MESSAGE })

    const options = context.availableKeys.map((key) => ({
      key,
      label: cycleFullLabel(parsed.data.code, key),
    }))
    return res.status(200).json({ ok: true, options })
  } catch (error) {
    logError(error)
    return res.status(500).json({ ok: false, message: SERVER_ERROR_MESSAGE })
  }
})

router.get('/dept', async (req, res) => {
  const parsed = deptSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ ok: false, message: INVALID_INPUT_MESSAGE })
  const { code, cycle, dept } = parsed.data

  try {
    const supabase = getSupabase()
    const type = await loadType(supabase, code)
    if (!type) return res.status(400).json({ ok: false, message: TYPE_ERROR_MESSAGE })

    const roster = await loadRoster(supabase, type.id)
    const members = roster.filter((member) => member.departmentName === dept)

    const sessions = await loadCycleSessions(supabase, type.id, code, cycle)
    const cycleRows = await loadAttendance(supabase, sessions.map((row) => row.id))
    const latestById = new Map(
      latestPerEmployee(cycleRows).map((row) => [row.employee_id, row]),
    )

    const counts = emptyLabelCounts()
    const people = members.map((member) => {
      const row = latestById.get(member.employeeId) ?? null
      const status = row ? STATUS_LABEL_BY_CODE[row.status_code] ?? DASH : NOT_YET_LABEL
      if (STATUS_LABELS.includes(status)) counts[status] += 1
      return {
        employeeId: member.employeeId,
        name: member.fullName,
        level: member.positionName,
        status,
        shift: row?.shift ?? null,
        time: row ? timeOfDay(row.registered_at) : null,
      }
    })
    people.sort((a, b) => {
      const left = STATUS_ORDER.has(a.status) ? STATUS_ORDER.get(a.status) : STATUS_LABELS.length
      const right = STATUS_ORDER.has(b.status) ? STATUS_ORDER.get(b.status) : STATUS_LABELS.length
      return left - right || a.name.localeCompare(b.name, 'th')
    })

    const notYet = people.filter((person) => person.status === NOT_YET_LABEL).length

    return res.status(200).json({
      ok: true,
      dept,
      cycle: { key: cycle, label: cycleFullLabel(code, cycle) },
      total: members.length,
      counts,
      people,
      notYet,
    })
  } catch (error) {
    logError(error)
    return res.status(500).json({ ok: false, message: SERVER_ERROR_MESSAGE })
  }
})

router.get('/monthly-summary', async (req, res) => {
  const parsed = monthlySummarySchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ ok: false, message: INVALID_INPUT_MESSAGE })
  const { month } = parsed.data

  try {
    const supabase = getSupabase()
    const context = await loadContext(supabase, 'monthly')
    if (!context) return res.status(400).json({ ok: false, message: TYPE_ERROR_MESSAGE })

    const roster = await loadRoster(supabase, context.type.id)
    const rows = context.rowsByCycle.get(month) ?? []
    const dateKeys = new Set(
      context.sessions
        .map((row) => row.session_date)
        .filter((date) => typeof date === 'string' && date.slice(0, 7) === month),
    )

    const employees = await loadEmployees(supabase, rows.map((row) => row.employee_id))
    const deptNames = [...new Set(roster.map((member) => member.departmentName))].sort((a, b) =>
      a.localeCompare(b, 'th'),
    )

    const rowsByDept = new Map()
    const personCounts = new Map()
    for (const row of rows) {
      const employee = employees.get(row.employee_id)
      const dept = employee?.departmentName
      if (!dept) continue
      const list = rowsByDept.get(dept) ?? []
      list.push(row)
      rowsByDept.set(dept, list)

      const label = STATUS_LABEL_BY_CODE[row.status_code]
      if (!label) continue
      const personKey = `${dept}\u0000${employee.fullName}\u0000${label}`
      personCounts.set(personKey, (personCounts.get(personKey) ?? 0) + 1)
    }

    const depts = deptNames.map((name) => {
      const deptRows = rowsByDept.get(name) ?? []
      const counts = emptyLabelCounts()
      for (const row of deptRows) {
        const label = STATUS_LABEL_BY_CODE[row.status_code]
        if (label) counts[label] += 1
      }
      const rates = {}
      for (const label of STATUS_LABELS) rates[label] = rateOf(counts[label], deptRows.length)
      return { name, counts, rows: deptRows.length, rates }
    })

    const aggregated = [...personCounts.entries()].map(([key, count]) => {
      const [dept, name, status] = key.split('\u0000')
      return { dept, name, status, count }
    })
    const totalMeetings = dateKeys.size
    const top = topAbsentPerDept(aggregated).map((entry) => ({
      ...entry,
      pct: totalMeetings > 0 ? entry.count / totalMeetings : 0,
    }))

    return res.status(200).json({
      ok: true,
      month: { key: month, label: thaiMonthLabel(month) },
      totalMeetings,
      depts,
      top,
    })
  } catch (error) {
    logError(error)
    return res.status(500).json({ ok: false, message: SERVER_ERROR_MESSAGE })
  }
})

router.post('/reason', async (req, res) => {
  const parsed = reasonSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, message: INVALID_INPUT_MESSAGE })
  const { pin, code, cycle, employeeId } = parsed.data

  try {
    const verification = await verifyLoginPin({
      employeeId: req.session.employeeId,
      pin,
      loginType: 'meeting_controller',
      loginRole: 'meeting_controller',
    })
    if (!verification.ok) {
      const body = { ok: false, message: verification.message }
      if (verification.unlockAt) body.lockedUntil = verification.unlockAt
      return res.status(verification.status).json(body)
    }

    const supabase = getSupabase()
    const context = await loadContext(supabase, code)
    if (!context) return res.status(400).json({ ok: false, message: TYPE_ERROR_MESSAGE })

    const cycleRows = (context.rowsByCycle.get(cycle) ?? []).filter(
      (row) => row.employee_id === employeeId,
    )
    if (cycleRows.length === 0) return res.status(200).json({ ok: false, message: NO_ROW_MESSAGE })

    const [row] = latestPerEmployee(cycleRows)
    if (!row) return res.status(200).json({ ok: false, message: NO_ROW_MESSAGE })

    if (!REASON_STATUS_CODES.includes(row.status_code)) {
      return res.status(200).json({ ok: false, message: NO_REASON_MESSAGE })
    }

    const { error } = await supabase.from('audit_logs').insert({
      actor_id: req.session.employeeId,
      action: 'dashboard_reason_viewed',
      entity: 'meeting_attendance',
      entity_id: row.id,
      detail: null,
    })
    if (error) throw error

    return res.status(200).json({
      ok: true,
      status: STATUS_LABEL_BY_CODE[row.status_code],
      reason: row.reason ?? '',
    })
  } catch (error) {
    logError(error)
    return res.status(500).json({ ok: false, message: SERVER_ERROR_MESSAGE })
  }
})

export default router
