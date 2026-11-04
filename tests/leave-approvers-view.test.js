// Approver toggle on the HR screen: the label each state offers, the endpoint
// the click calls, and the in-place row update that follows a success.
import { describe, expect, it } from 'vitest'

import {
  APPROVER_DEACTIVATE_LABEL,
  APPROVER_REACTIVATE_LABEL,
  applyApproverToggle,
  approverRows,
  approverStatusText,
  approverToggleAction,
  approverToggleLabel,
  approverToggleNotice,
  approverTogglePath,
} from '../src/lib/leave-approvers-view.js'

const ROW_ID = '77777777-7777-4777-8777-777777777777'

describe('button label', () => {
  it('offers ปิดใช้งาน while the approver is active', () => {
    expect(approverToggleLabel(true)).toBe(APPROVER_DEACTIVATE_LABEL)
    expect(approverToggleLabel(true)).toBe('ปิดใช้งาน')
    expect(approverStatusText(true)).toBe('ใช้งานอยู่')
  })

  it('offers เปิดใช้งาน once the approver is switched off', () => {
    expect(approverToggleLabel(false)).toBe(APPROVER_REACTIVATE_LABEL)
    expect(approverToggleLabel(false)).toBe('เปิดใช้งาน')
    expect(approverStatusText(false)).toBe('ปิดใช้งานแล้ว')
  })

  it('treats a missing flag as switched off, so the button can only open it', () => {
    expect(approverToggleLabel(undefined)).toBe('เปิดใช้งาน')
    expect(approverToggleAction(undefined)).toBe('reactivate')
  })
})

describe('toggle endpoint', () => {
  it('calls deactivate for an active row and reactivate for an inactive one', () => {
    expect(approverTogglePath(ROW_ID, 'department', true)).toBe(
      `/api/leave/hr/approvers/${ROW_ID}/deactivate?scope=department`
    )
    expect(approverTogglePath(ROW_ID, 'employee', false)).toBe(
      `/api/leave/hr/approvers/${ROW_ID}/reactivate?scope=employee`
    )
  })

  it('encodes the id and the scope', () => {
    expect(approverTogglePath('a/b', 'employee', false)).toBe(
      '/api/leave/hr/approvers/a%2Fb/reactivate?scope=employee'
    )
  })
})

describe('applyApproverToggle', () => {
  it('flips the row and keeps the pending count the reply reports', () => {
    const row = { id: ROW_ID, isActive: true, pendingCount: 2 }
    expect(applyApproverToggle(row, { ok: true, isActive: false, pendingCount: 4 })).toBe(true)
    expect(row.isActive).toBe(false)
    expect(row.pendingCount).toBe(4)
  })

  it('switches an inactive row back on', () => {
    const row = { id: ROW_ID, isActive: false, pendingCount: 1 }
    expect(applyApproverToggle(row, { ok: true, isActive: true })).toBe(true)
    expect(row.isActive).toBe(true)
    expect(row.pendingCount).toBe(1)
  })

  it('leaves the row untouched when the reply is unusable', () => {
    const row = { id: ROW_ID, isActive: true, pendingCount: 2 }
    expect(applyApproverToggle(row, { ok: false, message: 'x' })).toBe(false)
    expect(applyApproverToggle(row, { ok: true })).toBe(false)
    expect(applyApproverToggle(row, { ok: true, isActive: 'false' })).toBe(false)
    expect(applyApproverToggle(row, null)).toBe(false)
    expect(applyApproverToggle(null, { ok: true, isActive: false })).toBe(false)
    expect(row.isActive).toBe(true)
    expect(row.pendingCount).toBe(2)
  })
})

describe('approverRows', () => {
  it('keeps inactive approvers on the list', () => {
    const rows = approverRows([
      { id: 'a', isActive: true },
      { id: 'b', isActive: false },
    ])
    expect(rows.map((row) => row.id)).toEqual(['a', 'b'])
    expect(rows[1].isActive).toBe(false)
  })

  it('drops entries without an id and non-arrays', () => {
    expect(approverRows([null, { id: 'a' }, { isActive: false }, 'x']).map((row) => row.id)).toEqual([
      'a',
    ])
    expect(approverRows(undefined)).toEqual([])
    expect(approverRows({})).toEqual([])
  })
})

describe('success notice', () => {
  it('says the approver was switched on', () => {
    expect(approverToggleNotice(true, 0)).toBe('เปิดใช้งานแล้ว')
  })

  it('reports the pending leave a deactivation leaves behind', () => {
    expect(approverToggleNotice(false, 2)).toBe(
      'ปิดใช้งานแล้ว · ยังมีใบลาค้าง 2 ใบ (เก็บแถวไว้ ไม่ลบ)'
    )
    expect(approverToggleNotice(false, 0)).toBe('ปิดใช้งานแล้ว')
    expect(approverToggleNotice(false, undefined)).toBe('ปิดใช้งานแล้ว')
  })
})
