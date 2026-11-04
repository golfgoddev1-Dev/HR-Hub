// Approver rules: priority order, personal over department, skipping the
// applicant, priority normalisation, and deactivation that never deletes a row.
import { describe, expect, it } from 'vitest'

import {
  APPROVER_CANDIDATES,
  DEFAULT_PRIORITY,
  MAX_PRIORITY,
  MIN_PRIORITY,
  approverDeactivation,
  approverReactivation,
  normalizePriority,
  pickApprover,
  resolveApproverRow,
} from '../worker/src/leave-approvers.js'

const SELF = 'self-0000'
const PERSONAL = 'personal-approver'
const DEPARTMENT = 'department-approver'
const DEPARTMENT_ID = 'dept-0001'

describe('pickApprover', () => {
  it('takes the first row, which is the lowest priority number', () => {
    const rows = [
      { approver_id: PERSONAL, priority: 1 },
      { approver_id: 'second', priority: 2 },
    ]
    expect(pickApprover(rows, SELF, 'approver_id')).toBe(PERSONAL)
  })

  it('skips the applicant so nobody approves their own leave', () => {
    const rows = [
      { approver_id: SELF, priority: 1 },
      { approver_id: PERSONAL, priority: 2 },
    ]
    expect(pickApprover(rows, SELF, 'approver_id')).toBe(PERSONAL)
    expect(pickApprover([{ approver_id: SELF }], SELF, 'approver_id')).toBe(null)
  })

  it('accepts any member of an equal-priority group', () => {
    const rows = [
      { approver_id: 'a', priority: 5 },
      { approver_id: 'b', priority: 5 },
    ]
    expect(['a', 'b']).toContain(pickApprover(rows, SELF, 'approver_id'))
  })

  it('returns null for empty, missing or malformed rows', () => {
    expect(pickApprover([], SELF, 'approver_id')).toBe(null)
    expect(pickApprover(undefined, SELF, 'approver_id')).toBe(null)
    expect(pickApprover([{ approver_id: '' }], SELF, 'approver_id')).toBe(null)
    expect(pickApprover([{ approver_id: 42 }], SELF, 'approver_id')).toBe(null)
  })
})

describe('resolveApproverRow', () => {
  it('uses the personal approver before the department one', () => {
    expect(
      resolveApproverRow({
        personal: [{ approver_id: PERSONAL, priority: 200 }],
        department: [{ employee_id: DEPARTMENT, priority: 1 }],
        selfId: SELF,
        departmentId: DEPARTMENT_ID,
      })
    ).toEqual({ approverId: PERSONAL, source: 'employee' })
  })

  it('falls back to the department list when no personal approver exists', () => {
    expect(
      resolveApproverRow({
        personal: [],
        department: [{ employee_id: DEPARTMENT, priority: 10 }],
        selfId: SELF,
        departmentId: DEPARTMENT_ID,
      })
    ).toEqual({ approverId: DEPARTMENT, source: 'department' })
  })

  it('skips a department row that points at the applicant', () => {
    expect(
      resolveApproverRow({
        personal: [],
        department: [
          { employee_id: SELF, priority: 1 },
          { employee_id: DEPARTMENT, priority: 2 },
        ],
        selfId: SELF,
        departmentId: DEPARTMENT_ID,
      })
    ).toEqual({ approverId: DEPARTMENT, source: 'department' })
  })

  it('does not read the department list when the employee has no department', () => {
    expect(
      resolveApproverRow({
        personal: [],
        department: [{ employee_id: DEPARTMENT, priority: 1 }],
        selfId: SELF,
        departmentId: null,
      })
    ).toBe(null)
  })

  it('returns null when nothing is configured', () => {
    expect(
      resolveApproverRow({ personal: [], department: [], selfId: SELF, departmentId: DEPARTMENT_ID })
    ).toBe(null)
  })

  it('reads at most five candidates per list', () => {
    expect(APPROVER_CANDIDATES).toBe(5)
  })
})

describe('priority', () => {
  it('defaults to 100 when the field is absent', () => {
    expect(normalizePriority(undefined)).toBe(DEFAULT_PRIORITY)
    expect(normalizePriority(null)).toBe(DEFAULT_PRIORITY)
    expect(normalizePriority('')).toBe(DEFAULT_PRIORITY)
  })

  it('accepts integers inside 1..999, including numeric strings', () => {
    expect(normalizePriority(1)).toBe(1)
    expect(normalizePriority('25')).toBe(25)
    expect(normalizePriority(MAX_PRIORITY)).toBe(MAX_PRIORITY)
  })

  it('rejects out-of-range and non-integer values', () => {
    expect(normalizePriority(0)).toBe(null)
    expect(normalizePriority(MIN_PRIORITY - 1)).toBe(null)
    expect(normalizePriority(MAX_PRIORITY + 1)).toBe(null)
    expect(normalizePriority(1.5)).toBe(null)
    expect(normalizePriority('abc')).toBe(null)
  })
})

describe('deactivation', () => {
  it('only flips is_active and keeps the row even with pending leave', () => {
    const plan = approverDeactivation({ pendingCount: 3 })
    expect(plan).toEqual({ patch: { is_active: false }, keepRow: true, pendingCount: 3 })
    // Nothing in the plan can delete: no filter, no delete flag.
    expect(Object.keys(plan.patch)).toEqual(['is_active'])
    expect(plan.patch.is_active).toBe(false)
  })

  it('reports zero when the pending count is unknown', () => {
    expect(approverDeactivation({}).pendingCount).toBe(0)
    expect(approverDeactivation().pendingCount).toBe(0)
  })
})

describe('reactivation', () => {
  it('switches the kept row back on and deletes nothing', () => {
    const plan = approverReactivation()
    expect(plan).toEqual({ patch: { is_active: true }, keepRow: true })
    expect(Object.keys(plan.patch)).toEqual(['is_active'])
    expect(plan.patch.is_active).toBe(true)
  })

  it('undoes a deactivation exactly', () => {
    expect(approverReactivation().patch).toEqual({
      is_active: !approverDeactivation({}).patch.is_active,
    })
  })
})

describe('active approvers only', () => {
  const INACTIVE = 'inactive-approver'

  it('skips a candidate whose employee row is inactive', () => {
    expect(pickApprover([{ approver_id: INACTIVE }], SELF, 'approver_id', new Set())).toBe(null)
    expect(
      pickApprover(
        [{ approver_id: INACTIVE }, { approver_id: PERSONAL }],
        SELF,
        'approver_id',
        new Set([PERSONAL])
      )
    ).toBe(PERSONAL)
  })

  it('falls back to the department list when the personal approver is inactive', () => {
    expect(
      resolveApproverRow({
        personal: [{ approver_id: INACTIVE, priority: 1 }],
        department: [{ employee_id: DEPARTMENT, priority: 2 }],
        selfId: SELF,
        departmentId: DEPARTMENT_ID,
        activeIds: new Set([DEPARTMENT]),
      })
    ).toEqual({ approverId: DEPARTMENT, source: 'department' })
  })

  it('returns null when the only candidate is the applicant or inactive', () => {
    expect(
      resolveApproverRow({
        personal: [{ approver_id: SELF }],
        department: [{ employee_id: INACTIVE }],
        selfId: SELF,
        departmentId: DEPARTMENT_ID,
        activeIds: new Set([SELF]),
      })
    ).toBe(null)
  })

  it('keeps the old behaviour when no active list is supplied', () => {
    expect(
      resolveApproverRow({
        personal: [{ approver_id: PERSONAL }],
        department: [],
        selfId: SELF,
        departmentId: null,
      })
    ).toEqual({ approverId: PERSONAL, source: 'employee' })
  })
})
