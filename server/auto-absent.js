const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_MS = 48 * 60 * 60 * 1000

function parseDayKey(dayKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof dayKey === 'string' ? dayKey : '')
  if (!match) return null
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function parseTime(timeText) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof timeText === 'string' ? timeText : '')
  if (!match) return null
  return { hours: Number(match[1]), minutes: Number(match[2]) }
}

function cutoffMomentMs(dayMs, time) {
  return dayMs + time.hours * 60 * 60 * 1000 + time.minutes * 60 * 1000 - BANGKOK_OFFSET_MS
}

export function isDueSession({ now, cutoffTime, sessionDate, todayKey }) {
  const sessionMs = parseDayKey(sessionDate)
  const todayMs = parseDayKey(todayKey)
  const time = parseTime(cutoffTime)
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN
  if (sessionMs === null || todayMs === null || time === null) return false
  if (!Number.isFinite(nowMs)) return false
  if (sessionMs > todayMs) return false

  const cutoffMs = cutoffMomentMs(sessionMs, time)
  if (nowMs < cutoffMs) return false
  return nowMs - cutoffMs <= WINDOW_MS
}

export function missingEmployees(rosterEmployeeIds, attendedEmployeeIds) {
  const attended = new Set(attendedEmployeeIds ?? [])
  return (rosterEmployeeIds ?? []).filter(
    (employeeId) => typeof employeeId === 'string' && employeeId.length > 0 && !attended.has(employeeId),
  )
}

export function isSkipDate(dayKey, skipDateSet) {
  if (typeof dayKey !== 'string' || dayKey.length === 0) return false
  if (skipDateSet instanceof Set) return skipDateSet.has(dayKey)
  if (Array.isArray(skipDateSet)) return skipDateSet.includes(dayKey)
  return false
}

export function shouldEnsureSupSession({ now, weekday, cutoffTime, todayKey, skipDateSet }) {
  if (weekday === null || weekday === undefined) return false
  const todayMs = parseDayKey(todayKey)
  const time = parseTime(cutoffTime)
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN
  if (todayMs === null || time === null) return false
  if (!Number.isFinite(nowMs)) return false
  if (new Date(todayMs).getUTCDay() !== Number(weekday)) return false
  if (isSkipDate(todayKey, skipDateSet)) return false
  return nowMs >= cutoffMomentMs(todayMs, time)
}

export function dayKeyBefore(dayKey, days) {
  const todayMs = parseDayKey(dayKey)
  if (todayMs === null) return ''
  const shifted = new Date(todayMs - Number(days) * DAY_MS)
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${month}-${day}`
}
