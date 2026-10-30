const BANGKOK_TIME_ZONE = 'Asia/Bangkok'

export const BEFORE_MESSAGE = 'ยังไม่ถึงเวลาลงทะเบียนเข้าประชุม'
export const AFTER_MESSAGE = 'หมดเวลาการลงทะเบียนเข้าประชุมแล้ว'
export const NO_SESSION_MESSAGE = 'ยังไม่ได้กำหนดรอบประชุม กรุณาแจ้งผู้ดูแล'

export function bangkokToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function bangkokMoment(now) {
  const date = bangkokToday(now)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return { date, time, weekday }
}

function normalizeTime(value) {
  if (typeof value !== 'string' || value.length < 5) return null
  return value.slice(0, 5)
}

function noSession() {
  return { state: 'no_session', message: NO_SESSION_MESSAGE }
}

function evaluate(nowTime, session) {
  if (nowTime < session.openTime) {
    return {
      state: 'before',
      openTime: session.openTime,
      cutoffTime: session.cutoffTime,
      message: BEFORE_MESSAGE,
    }
  }
  if (nowTime >= session.cutoffTime) {
    return { state: 'after', message: AFTER_MESSAGE }
  }
  return { state: 'open', session }
}

export function resolveScanState({ now, typeCode, meetingDefaults, sessions }) {
  const current = bangkokMoment(now)

  if (typeCode === 'sup') {
    if (current.weekday !== meetingDefaults?.weekday) return noSession()
    const openTime = normalizeTime(meetingDefaults?.openTime)
    const cutoffTime = normalizeTime(meetingDefaults?.cutoffTime)
    if (!openTime || !cutoffTime) return noSession()
    return evaluate(current.time, { sessionDate: current.date, openTime, cutoffTime })
  }

  if (typeCode === 'monthly') {
    const session = (sessions ?? []).find((item) => item.sessionDate === current.date)
    if (!session) return noSession()
    const openTime = normalizeTime(session.openTime)
    const cutoffTime = normalizeTime(session.cutoffTime)
    if (!openTime || !cutoffTime) return noSession()
    return evaluate(current.time, {
      sessionDate: session.sessionDate,
      openTime,
      cutoffTime,
    })
  }

  return noSession()
}
