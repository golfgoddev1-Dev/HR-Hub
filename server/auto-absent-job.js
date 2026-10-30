import { bangkokToday } from './register-window.js'
import {
  dayKeyBefore,
  isDueSession,
  missingEmployees,
  shouldEnsureSupSession,
} from './auto-absent.js'

const RUN_INTERVAL_MS = 10 * 60 * 1000
const FIRST_RUN_DELAY_MS = 60 * 1000
const WINDOW_DAYS = 2
const MEETING_CODES = ['sup', 'monthly']
const ABSENT_STATUS_CODE = 'not_attended'
const AUDIT_ACTION = 'auto_absent_done'
const AUDIT_ENTITY = 'meeting_session'

function logError(error) {
  console.error('[auto-absent-error]', error?.code ?? error?.name)
}

function toHm(value) {
  if (typeof value !== 'string' || value.length < 5) return null
  return value.slice(0, 5)
}

async function loadTypes(supabase) {
  const { data, error } = await supabase
    .from('meeting_types')
    .select('id, code, weekday, default_open_time, default_cutoff_time')
    .in('code', MEETING_CODES)
  if (error) throw error
  return data ?? []
}

async function loadSkipDates(supabase, fromKey, todayKey) {
  const { data, error } = await supabase
    .from('meeting_skip_dates')
    .select('skip_date')
    .gte('skip_date', fromKey)
    .lte('skip_date', todayKey)
  if (error) throw error
  return new Set((data ?? []).map((row) => row.skip_date))
}

async function ensureSupSession(supabase, type, todayKey) {
  const { error } = await supabase.from('meeting_sessions').upsert(
    {
      meeting_type_id: type.id,
      session_date: todayKey,
      cycle_key: `sup-${todayKey}`,
      open_time: toHm(type.default_open_time),
      cutoff_time: toHm(type.default_cutoff_time),
    },
    { onConflict: 'meeting_type_id,session_date', ignoreDuplicates: true },
  )
  if (error) throw error
}

async function loadSessions(supabase, fromKey, todayKey) {
  const { data, error } = await supabase
    .from('meeting_sessions')
    .select('id, meeting_type_id, session_date, cutoff_time')
    .gte('session_date', fromKey)
    .lte('session_date', todayKey)
  if (error) throw error
  return data ?? []
}

async function loadDoneSessions(supabase, sessionIds) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('entity_id')
    .eq('action', AUDIT_ACTION)
    .eq('entity', AUDIT_ENTITY)
    .in('entity_id', sessionIds)
  if (error) throw error
  return new Set((data ?? []).map((row) => row.entity_id))
}

async function loadRoster(supabase, typeIds) {
  const { data, error } = await supabase
    .from('meeting_roster')
    .select(
      'meeting_type_id, employee_id, employees!meeting_roster_employee_id_fkey!inner(department_id, position_id)',
    )
    .in('meeting_type_id', typeIds)
    .eq('is_active', true)
  if (error) throw error
  return data ?? []
}

async function loadAttended(supabase, sessionIds) {
  const { data, error } = await supabase
    .from('meeting_attendance')
    .select('session_id, employee_id')
    .in('session_id', sessionIds)
  if (error) throw error
  return data ?? []
}

export async function runAutoAbsentOnce(supabase) {
  const now = new Date()
  const todayKey = bangkokToday(now)
  const fromKey = dayKeyBefore(todayKey, WINDOW_DAYS)
  if (!fromKey) return { processed: 0 }

  const types = await loadTypes(supabase)
  const supType = types.find((row) => row.code === 'sup') ?? null

  let skipDates
  try {
    skipDates = await loadSkipDates(supabase, fromKey, todayKey)
  } catch (error) {
    logError(error)
    return { processed: 0 }
  }

  if (
    supType &&
    shouldEnsureSupSession({
      now,
      weekday: supType.weekday,
      cutoffTime: toHm(supType.default_cutoff_time),
      todayKey,
      skipDateSet: skipDates,
    })
  ) {
    await ensureSupSession(supabase, supType, todayKey)
  }

  const sessions = await loadSessions(supabase, fromKey, todayKey)
  const typeById = new Map(types.map((row) => [row.id, row]))

  const dueSessions = []
  for (const session of sessions) {
    const type = typeById.get(session.meeting_type_id)
    if (!type) continue
    const cutoffTime = toHm(session.cutoff_time) ?? toHm(type.default_cutoff_time)
    if (!cutoffTime) continue
    if (!isDueSession({ now, cutoffTime, sessionDate: session.session_date, todayKey })) continue
    dueSessions.push(session)
  }
  if (dueSessions.length === 0) return { processed: 0 }

  const done = await loadDoneSessions(
    supabase,
    dueSessions.map((session) => session.id),
  )
  const pending = dueSessions.filter((session) => !done.has(session.id))
  if (pending.length === 0) return { processed: 0 }

  const rosterRows = await loadRoster(supabase, [
    ...new Set(pending.map((session) => session.meeting_type_id)),
  ])
  const rosterByType = new Map()
  const employeeById = new Map()
  for (const row of rosterRows) {
    const list = rosterByType.get(row.meeting_type_id) ?? []
    list.push(row.employee_id)
    rosterByType.set(row.meeting_type_id, list)
    employeeById.set(row.employee_id, {
      departmentId: row.employees?.department_id ?? null,
      positionId: row.employees?.position_id ?? null,
    })
  }

  const attendedRows = await loadAttended(
    supabase,
    pending.map((session) => session.id),
  )
  const attendedBySession = new Map()
  for (const row of attendedRows) {
    const list = attendedBySession.get(row.session_id) ?? []
    list.push(row.employee_id)
    attendedBySession.set(row.session_id, list)
  }

  const stamp = new Date().toISOString()
  let processed = 0

  for (const session of pending) {
    const rosterIds = rosterByType.get(session.meeting_type_id) ?? []
    const missing = missingEmployees(rosterIds, attendedBySession.get(session.id) ?? [])

    const rows = missing.map((employeeId) => ({
      session_id: session.id,
      employee_id: employeeId,
      status_code: ABSENT_STATUS_CODE,
      reason: null,
      shift: null,
      department_id: employeeById.get(employeeId)?.departmentId ?? null,
      position_id: employeeById.get(employeeId)?.positionId ?? null,
      registered_at: stamp,
    }))

    if (rows.length > 0) {
      const { error } = await supabase
        .from('meeting_attendance')
        .upsert(rows, { onConflict: 'session_id,employee_id', ignoreDuplicates: true })
      if (error) throw error
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      actor_id: null,
      action: AUDIT_ACTION,
      entity: AUDIT_ENTITY,
      entity_id: session.id,
      detail: JSON.stringify({ count: rows.length }),
    })
    if (auditError) throw auditError

    processed += 1
  }

  return { processed }
}

export function startAutoAbsentJob(supabase) {
  let running = false
  let intervalTimer = null

  async function run() {
    if (running) return
    running = true
    try {
      await runAutoAbsentOnce(supabase)
    } catch (error) {
      logError(error)
    } finally {
      running = false
    }
  }

  const firstTimer = setTimeout(run, FIRST_RUN_DELAY_MS)
  if (typeof firstTimer.unref === 'function') firstTimer.unref()

  intervalTimer = setInterval(run, RUN_INTERVAL_MS)
  if (typeof intervalTimer.unref === 'function') intervalTimer.unref()

  return function stopAutoAbsentJob() {
    clearTimeout(firstTimer)
    clearInterval(intervalTimer)
  }
}
