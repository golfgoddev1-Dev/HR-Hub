const BANGKOK_TIME_ZONE = 'Asia/Bangkok'

export const STATUS_LABEL_BY_CODE = {
  attended: 'เข้าร่วมประชุม',
  not_attended: 'ไม่เข้าร่วม',
  urgent_busy: 'ติดงานด่วน',
  leave: 'ลาประชุม',
}

const STATUS_CODES = Object.keys(STATUS_LABEL_BY_CODE)

function bangkokClock(now) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
}

function normalizeTime(value) {
  if (typeof value !== 'string' || value.length < 5) return null
  return value.slice(0, 5)
}

export function countByStatus(rows) {
  const counts = { attended: 0, not_attended: 0, urgent_busy: 0, leave: 0, total: 0 }
  for (const row of rows ?? []) {
    const code = row?.status_code
    if (typeof code !== 'string' || code.length === 0) continue
    counts.total += 1
    if (STATUS_CODES.includes(code)) counts[code] += 1
  }
  return counts
}

export function findPending(roster, attendanceRows) {
  const registered = new Set(
    (attendanceRows ?? [])
      .map((row) => row?.employee_id)
      .filter((id) => typeof id === 'string' && id.length > 0),
  )
  return [...(roster ?? [])]
    .filter((member) => !registered.has(member?.employeeId))
    .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), 'th'))
}

export function sessionPhase({ now, openTime, cutoffTime }) {
  const open = normalizeTime(openTime)
  const cutoff = normalizeTime(cutoffTime)
  if (!open || !cutoff) return 'none'

  const current = bangkokClock(now ?? new Date())
  if (current < open) return 'not_open'
  if (current >= cutoff) return 'closed'
  return 'open'
}
