// Approval history helpers: the default month, the query string, merging a
// "โหลดเพิ่ม" page, and Bangkok date/time formatting. The list rows never carry
// a reason; that only comes from the scoped detail read.

import { addIsoDays, isIsoDate } from './leave-calendar.js'

export const HISTORY_PAGE_SIZE = 50
export const HISTORY_DECISIONS = Object.freeze(['all', 'approved', 'rejected'])
export const HISTORY_TIME_ZONE = 'Asia/Bangkok'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function dateFormatter(options) {
  try {
    return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
      timeZone: HISTORY_TIME_ZONE,
      ...options,
    })
  } catch {
    return null
  }
}

const DATE = dateFormatter({ day: 'numeric', month: 'short', year: 'numeric' })
const TIME = dateFormatter({ hour: '2-digit', minute: '2-digit', hour12: false })

/** The current month as an inclusive YYYY-MM-DD range. */
export function currentMonthRange(todayIso) {
  const today = typeof todayIso === 'string' ? todayIso.slice(0, 10) : ''
  if (!DATE_ONLY.test(today) || !isIsoDate(today)) return { from: '', to: '' }
  const from = `${today.slice(0, 7)}-01`
  const nextMonthStart = addIsoDays(`${today.slice(0, 7)}-01`, 32).slice(0, 7) + '-01'
  return { from, to: addIsoDays(nextMonthStart, -1) }
}

/** The GET query for one page; empty filters are omitted. */
export function historyQuery({ from = '', to = '', decision = 'all', search = '', page = 1 } = {}) {
  const params = new URLSearchParams()
  if (from) params.set('from', from.slice(0, 10))
  if (to) params.set('to', to.slice(0, 10))
  if (HISTORY_DECISIONS.includes(decision) && decision !== 'all') params.set('decision', decision)
  const term = typeof search === 'string' ? search.trim() : ''
  if (term) params.set('search', term)
  const safePage = Number.isInteger(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 1
  params.set('page', String(safePage))
  params.set('pageSize', String(HISTORY_PAGE_SIZE))
  return `/api/leave/approvals/history?${params.toString()}`
}

/** Appends a page without allowing a duplicate decision row. */
export function mergeHistoryPages(current, incoming) {
  const rows = []
  const seen = new Set()
  for (const row of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!row || typeof row.id !== 'string' || seen.has(row.id)) continue
    seen.add(row.id)
    rows.push(row)
  }
  return rows
}

export function decisionLabel(decision) {
  if (decision === 'approved') return 'อนุมัติ'
  if (decision === 'rejected') return 'ไม่อนุมัติ'
  return '—'
}

export function formatHistoryDate(iso) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return DATE ? DATE.format(date) : '—'
}

export function formatHistoryTime(iso) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return TIME ? TIME.format(date) : '—'
}

/** Exactly the columns the history list may show — no reason, no note. */
export function historyRowView(row) {
  if (!row) return null
  return {
    id: row.id,
    dateDecided: formatHistoryDate(row.decidedAt),
    timeDecided: formatHistoryTime(row.decidedAt),
    employeeName: row.employeeName || '—',
    departmentName: row.departmentName || '—',
    leaveTypeName: row.leaveTypeName || '—',
    dates: [row.startDate, row.endDate],
    days: Number(row.days),
    decision: row.decision,
    decisionLabel: decisionLabel(row.decision),
  }
}
