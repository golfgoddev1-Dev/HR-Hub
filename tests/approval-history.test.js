// The approval history page: one default month, a 50-row page with "โหลดเพิ่ม",
// no reason in the list, and menu/route visibility limited to an active approver
// or HR.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  HISTORY_PAGE_SIZE,
  currentMonthRange,
  decisionLabel,
  formatHistoryTime,
  historyQuery,
  historyRowView,
  mergeHistoryPages,
} from '../src/lib/approval-history.js'
import {
  HISTORY_LABEL,
  HISTORY_PATH,
  approvalHistoryMenuItem,
} from '../src/lib/leave-nav-items.js'
import { navSections } from '../src/lib/nav-config.js'
import { canOpenPath } from '../src/lib/route-access.js'

const PAGE = readFileSync(
  new URL('../src/pages/LeaveApprovalHistoryPage.vue', import.meta.url),
  'utf8'
)
const ROUTER = readFileSync(new URL('../src/router.js', import.meta.url), 'utf8')

describe('the default range', () => {
  it('is the current month in Bangkok', () => {
    expect(currentMonthRange('2026-11-06')).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    })
    expect(currentMonthRange('2026-02-10')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
    expect(currentMonthRange('2028-02-10')).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    })
    expect(currentMonthRange('2026-12-15')).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    })
  })

  it('is empty for an unusable date, never a shifted one', () => {
    expect(currentMonthRange('2026-02-30')).toEqual({ from: '', to: '' })
    expect(currentMonthRange('')).toEqual({ from: '', to: '' })
  })
})

describe('the query and pages', () => {
  it('asks for 50 rows and omits an all-decision filter', () => {
    const query = historyQuery({
      from: '2026-11-01',
      to: '2026-11-30',
      decision: 'all',
      search: '',
      page: 1,
    })
    const params = new URL(query, 'https://x').searchParams

    expect(query.startsWith('/api/leave/approvals/history?')).toBe(true)
    expect(HISTORY_PAGE_SIZE).toBe(50)
    expect(params.get('pageSize')).toBe('50')
    expect(params.get('page')).toBe('1')
    expect(params.get('decision')).toBeNull()
    expect(params.get('search')).toBeNull()
  })

  it('carries the decision, a trimmed search and the page', () => {
    const params = new URL(
      historyQuery({
        from: '2026-11-01',
        to: '2026-11-30',
        decision: 'rejected',
        search: '  สมชาย  ',
        page: 3,
      }),
      'https://x'
    ).searchParams

    expect(params.get('decision')).toBe('rejected')
    expect(params.get('search')).toBe('สมชาย')
    expect(params.get('page')).toBe('3')
    expect(params.get('from')).toBe('2026-11-01')
    expect(params.get('to')).toBe('2026-11-30')
  })

  it('appends a page without repeating a decision', () => {
    const merged = mergeHistoryPages(
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'b' }, { id: 'c' }]
    )
    expect(merged.map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(mergeHistoryPages(null, [{ id: 'a' }])).toHaveLength(1)
  })

  it('labels the two decisions in Thai', () => {
    expect(decisionLabel('approved')).toBe('อนุมัติ')
    expect(decisionLabel('rejected')).toBe('ไม่อนุมัติ')
    expect(decisionLabel('pending')).toBe('—')
  })

  it('formats the decided time in Bangkok', () => {
    const time = formatHistoryTime('2026-11-06T10:15:00.000Z')
    expect(time).toContain('17')
    expect(time).toContain('15')
    expect(formatHistoryTime('not-a-date')).toBe('—')
  })

  it('never exposes a reason through the list row view', () => {
    const view = historyRowView({
      id: 'a',
      decidedAt: '2026-11-06T10:15:00.000Z',
      employeeName: 'นาย ก',
      departmentName: 'ฝ่ายบุคคล',
      leaveTypeName: 'ลากิจ',
      startDate: '2026-11-05',
      endDate: '2026-11-06',
      days: 2,
      decision: 'approved',
      reason: 'ต้องไม่แสดง',
    })

    expect(view).not.toHaveProperty('reason')
    expect(JSON.stringify(view).includes('ต้องไม่แสดง')).toBe(false)
    expect(view.decisionLabel).toBe('อนุมัติ')
  })
})

describe('menu and route visibility', () => {
  it('shows the history item for an approver and for HR only', () => {
    expect(approvalHistoryMenuItem({ isApprover: false })).toBeNull()
    expect(approvalHistoryMenuItem({ isApprover: 'true', role: 'employee' })).toBeNull()

    expect(approvalHistoryMenuItem({ isApprover: true })).toMatchObject({
      label: HISTORY_LABEL,
      to: HISTORY_PATH,
      icon: 'history',
    })
    expect(approvalHistoryMenuItem({ role: 'hr' })).toMatchObject({
      label: 'ประวัติการอนุมัติ',
      to: '/leave/approvals/history',
    })
  })

  it('adds it to the approver section after the queue, and never to a tab bar', () => {
    const hr = navSections({ role: 'hr' }).find((section) => section.id === 'approver')
    expect(hr.items.map((item) => item.to)).toEqual(['/leave/approvals/history'])

    const approver = navSections({ role: 'employee', isApprover: true, pendingCount: 2 })
      .find((section) => section.id === 'approver')
    expect(approver.items.map((item) => item.to)).toEqual([
      '/leave/approvals',
      '/leave/approvals/history',
    ])
    expect(approver.items[0].badge).toBe(2)

    // A plain employee gets neither the section nor the item.
    expect(
      navSections({ role: 'employee' }).some((section) => section.id === 'approver')
    ).toBe(false)
  })

  it('opens the route for HR and an approver, not for anyone else', () => {
    expect(canOpenPath('hr', '/leave/approvals/history')).toBe(true)

    const approver = { role: 'employee', isApprover: true }
    expect(canOpenPath('employee', '/leave/approvals/history', approver)).toBe(true)
    expect(canOpenPath('employee', '/leave/approvals/history')).toBe(false)

    const meetingApprover = {
      role: 'meeting_controller',
      hasEmployee: true,
      isApprover: true,
    }
    expect(canOpenPath('meeting_controller', '/leave/approvals/history', meetingApprover)).toBe(
      true
    )
  })

  it('is registered in the router', () => {
    expect(ROUTER).toContain("path: '/leave/approvals/history'")
    expect(ROUTER).toContain('LeaveApprovalHistoryPage')
  })
})

describe('the page', () => {
  it('has the three filters and a load-more button', () => {
    expect(PAGE).toContain('ตั้งแต่วันที่')
    expect(PAGE).toContain('ถึงวันที่')
    expect(PAGE).toContain('การตัดสินใจ')
    expect(PAGE).toContain('ค้นหาชื่อ')
    expect(PAGE).toContain('โหลดเพิ่ม')
    expect(PAGE).toContain('historyQuery(')
    expect(PAGE).toContain('mergeHistoryPages(')
  })

  it('renders the read-only detail in a dialog, but no reason in the list', () => {
    expect(PAGE).toContain('LeaveRequestDetail')
    expect(PAGE).toContain('role="dialog"')
    expect(PAGE).toContain('aria-modal="true"')
    expect(PAGE).toContain('/api/leave/requests/')

    // The list row view and the page do not render a reason column.
    expect(PAGE).not.toContain('row.reason')
    const listStart = PAGE.indexOf('class="history-row"')
    const listEnd = PAGE.indexOf('</button>', listStart)
    expect(PAGE.slice(listStart, listEnd)).not.toContain('reason')
  })

  it('uses cards on phones and a seven-column list on desktop without scrolling', () => {
    const css = PAGE.slice(PAGE.indexOf('<style scoped>'))
    expect(css).toContain('grid-template-columns: 1fr 1fr')
    expect(css).toContain('@media (min-width: 768px)')
    expect(css).toContain('grid-template-columns: 120px 1.3fr')
    expect(PAGE).not.toContain('overflow-x')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain('prefers-reduced-motion: reduce')
  })
})
