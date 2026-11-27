// The send-queue health screen: the one read-only endpoint, how a queue's numbers
// become a plain-language state, and how a reply is read. A failed or malformed
// reply is null, so the page says it could not check instead of showing zeros.

export const HEALTH_URL = '/api/admin/health'

export const HEALTH_LOAD_ERROR = 'ตรวจสถานะไม่สำเร็จ กรุณาลองใหม่'

/** Must match OVERDUE_MINUTES and FAILED_WINDOW_HOURS in worker/src/admin-health.js. */
export const OVERDUE_MINUTES = 10
export const FAILED_WINDOW_HOURS = 24

export const HEALTH_QUEUES = [
  {
    key: 'push',
    title: 'แจ้งเตือนบนอุปกรณ์',
    note: 'ส่งถึงผู้อนุมัติเมื่อมีใบลาใหม่ และถึงพนักงานเมื่อมีผลการตัดสิน',
  },
  {
    key: 'email',
    title: 'อีเมลแจ้งผลใบลา',
    note: 'ส่งถึงพนักงานเมื่อผู้อนุมัติตัดสินใบลาแล้ว',
  },
]

export const HEALTH_FIGURES = [
  { key: 'pending', label: 'รอส่ง' },
  { key: 'sending', label: 'กำลังส่ง' },
  { key: 'overdue', label: `ค้างเกิน ${OVERDUE_MINUTES} นาที` },
  { key: 'failed24h', label: `ส่งไม่สำเร็จใน ${FAILED_WINDOW_HOURS} ชั่วโมง` },
]

/** Status wording and icon; the colour pair is chosen in the page by `level`. */
export const HEALTH_LEVELS = {
  ok: { label: 'ส่งปกติ', icon: 'check_circle' },
  late: { label: 'มีรายการค้าง', icon: 'pending' },
  failed: { label: 'มีรายการส่งไม่สำเร็จ', icon: 'error' },
}

function whole(value) {
  return Number.isInteger(value) && value >= 0 ? value : null
}

/** "failed" beats "late" beats "ok": a failure is the thing to look at first. */
export function queueLevel(queue) {
  if (!queue) return null
  if (queue.failed24h > 0) return 'failed'
  if (queue.overdue > 0) return 'late'
  return 'ok'
}

function readQueue(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const queue = {
    pending: whole(raw.pending),
    sending: whole(raw.sending),
    overdue: whole(raw.overdue),
    failed24h: whole(raw.failed24h),
    lastSentAt: typeof raw.lastSentAt === 'string' ? raw.lastSentAt : null,
  }
  return HEALTH_FIGURES.every((figure) => queue[figure.key] !== null) ? queue : null
}

/** { checkedAt, queues: { push, email } } or null when the reply is unusable. */
export function readHealth(payload) {
  if (payload === null || typeof payload !== 'object' || payload.ok !== true) return null
  if (typeof payload.checkedAt !== 'string' || typeof payload.queues !== 'object') return null
  const queues = {}
  for (const meta of HEALTH_QUEUES) {
    const queue = readQueue(payload.queues?.[meta.key])
    if (!queue) return null
    queues[meta.key] = queue
  }
  return { checkedAt: payload.checkedAt, queues }
}
