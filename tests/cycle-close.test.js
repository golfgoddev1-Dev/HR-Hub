import { describe, expect, it } from 'vitest'
import {
  absentRows,
  closeAuditDetail,
  closeCycle,
  isCloseCycleBody,
  isCutoffPassed,
  missingEmployeeIds,
} from '../server/cycle-close.js'

// Tuesday 10 November 2026, 10:00 Asia/Bangkok.
const NOW = new Date('2026-11-10T03:00:00.000Z')
const TODAY = '2026-11-10'

const ROSTER = [
  { employeeId: 'emp-a', departmentId: 'dept-1', positionId: 'pos-1' },
  { employeeId: 'emp-b', departmentId: 'dept-1', positionId: 'pos-2' },
  { employeeId: 'emp-c', departmentId: 'dept-2', positionId: null },
]

const SESSION = {
  id: 'session-1',
  session_date: '2026-11-03',
  meeting_type_id: 'type-sup',
  cutoff_time: '12:00',
}

/** Wires closeCycle to in-memory loaders and records every write. */
function harness({ sessions = [SESSION], roster = ROSTER, existing = [], failWith = null } = {}) {
  const inserts = []
  const audits = []
  const calls = { sessions: 0, roster: 0, attendance: 0 }

  async function run(body, now = NOW) {
    const outcome = await closeCycle({
      body,
      now,
      actorId: 'actor-1',
      loadSessions: async (args) => {
        calls.sessions += 1
        if (failWith) throw failWith
        return typeof sessions === 'function' ? sessions(args) : sessions
      },
      loadRoster: async () => {
        calls.roster += 1
        return roster
      },
      loadAttendance: async () => {
        calls.attendance += 1
        return existing
      },
      insertAbsent: async (rows) => {
        inserts.push(rows)
        return rows.length
      },
      writeAudit: async (args) => {
        audits.push(args)
      },
    })
    return outcome
  }

  return { run, inserts, audits, calls }
}

const VALID_BODY = { code: 'sup', cycle: '2026-11-03' }

describe('isCutoffPassed', () => {
  it('compares a same-day cutoff against Bangkok wall-clock time', () => {
    expect(isCutoffPassed({ now: NOW, sessionDate: TODAY, cutoffTime: '12:00' })).toBe(false)
    expect(isCutoffPassed({ now: NOW, sessionDate: TODAY, cutoffTime: '10:00' })).toBe(true)
    expect(isCutoffPassed({ now: NOW, sessionDate: TODAY, cutoffTime: '10:01' })).toBe(false)
  })

  it('passes any earlier session and refuses a future one', () => {
    expect(isCutoffPassed({ now: NOW, sessionDate: '2026-11-09', cutoffTime: '23:59' })).toBe(true)
    expect(isCutoffPassed({ now: NOW, sessionDate: '2026-11-11', cutoffTime: '00:01' })).toBe(false)
  })

  it('uses the Bangkok day across UTC midnight', () => {
    // 2026-11-10T17:30Z is already 00:30 on 11 November in Bangkok.
    const lateUtc = new Date('2026-11-10T17:30:00.000Z')
    expect(isCutoffPassed({ now: lateUtc, sessionDate: TODAY, cutoffTime: '23:00' })).toBe(true)
    expect(isCutoffPassed({ now: lateUtc, sessionDate: '2026-11-11', cutoffTime: '00:45' })).toBe(false)
  })

  it('answers null when the date or the cutoff cannot be read', () => {
    expect(isCutoffPassed({ now: NOW, sessionDate: '2026-11-10', cutoffTime: null })).toBeNull()
    expect(isCutoffPassed({ now: NOW, sessionDate: '2026-11-10', cutoffTime: '9:00' })).toBeNull()
    expect(isCutoffPassed({ now: NOW, sessionDate: '', cutoffTime: '12:00' })).toBeNull()
  })
})

describe('missingEmployeeIds', () => {
  it('keeps roster order and drops members that already have a row', () => {
    expect(missingEmployeeIds(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c'])
  })

  it('ignores empty ids and duplicates', () => {
    expect(missingEmployeeIds(['a', '', null, 'a', 'b'], [])).toEqual(['a', 'b'])
  })
})

describe('absentRows', () => {
  it('writes the absent status with null reason and shift at the click time', () => {
    const rows = absentRows(['emp-a', 'emp-c'], {
      sessionId: 'session-1',
      registeredAt: NOW.toISOString(),
      memberById: new Map(ROSTER.map((member) => [member.employeeId, member])),
    })
    expect(rows).toEqual([
      {
        session_id: 'session-1',
        employee_id: 'emp-a',
        status_code: 'not_attended',
        reason: null,
        shift: null,
        department_id: 'dept-1',
        position_id: 'pos-1',
        registered_at: '2026-11-10T03:00:00.000Z',
      },
      {
        session_id: 'session-1',
        employee_id: 'emp-c',
        status_code: 'not_attended',
        reason: null,
        shift: null,
        department_id: 'dept-2',
        position_id: null,
        registered_at: '2026-11-10T03:00:00.000Z',
      },
    ])
  })
})

describe('isCloseCycleBody', () => {
  it('accepts exactly code + cycle in the /registrants form', () => {
    expect(isCloseCycleBody({ code: 'sup', cycle: '2026-11-03' })).toBe(true)
    expect(isCloseCycleBody({ code: 'monthly', cycle: '2026-11' })).toBe(true)
  })

  it('rejects extra keys, a missing field, a bad code and a bad cycle', () => {
    expect(isCloseCycleBody({ code: 'sup', cycle: '2026-11-03', extra: 1 })).toBe(false)
    expect(isCloseCycleBody({ code: 'sup' })).toBe(false)
    expect(isCloseCycleBody({ code: 'hr', cycle: '2026-11-03' })).toBe(false)
    expect(isCloseCycleBody({ code: 'sup', cycle: '2026-11-3' })).toBe(false)
    // The /registrants cycle form allows a month key for either code; a sup
    // month key simply finds no session and answers 404.
    expect(isCloseCycleBody({ code: 'sup', cycle: '2026-11' })).toBe(true)
    expect(isCloseCycleBody(null)).toBe(false)
    expect(isCloseCycleBody([])).toBe(false)
  })
})

describe('closeAuditDetail', () => {
  it('keeps only the inserted count', () => {
    expect(closeAuditDetail(3)).toBe('{"inserted":3}')
    expect(closeAuditDetail('4')).toBe('{"inserted":4}')
    expect(closeAuditDetail(undefined)).toBe('{"inserted":0}')
  })
})

describe('closeCycle', () => {
  it('inserts only the roster members with no row', async () => {
    const store = harness({ existing: [{ employee_id: 'emp-b' }] })
    const outcome = await store.run(VALID_BODY)

    expect(outcome).toEqual({ status: 200, body: { ok: true, inserted: 2 } })
    expect(store.inserts).toHaveLength(1)
    expect(store.inserts[0].map((row) => row.employee_id)).toEqual(['emp-a', 'emp-c'])
    expect(store.inserts[0].every((row) => row.status_code === 'not_attended')).toBe(true)
    expect(store.inserts[0].every((row) => row.reason === null && row.shift === null)).toBe(true)
    expect(store.inserts[0].every((row) => row.registered_at === NOW.toISOString())).toBe(true)

    expect(store.audits).toHaveLength(1)
    expect(store.audits[0]).toEqual({
      actorId: 'actor-1',
      entityId: 'session-1',
      detail: '{"inserted":2}',
    })
  })

  it('is a safe no-op on the second click: nothing inserted, audit still written', async () => {
    const store = harness()
    const first = await store.run(VALID_BODY)
    expect(first.body).toEqual({ ok: true, inserted: 3 })

    // The rows written by the first click are what the second click now sees.
    store.inserts.length = 0
    const onlyExisting = [
      { employee_id: 'emp-a' },
      { employee_id: 'emp-b' },
      { employee_id: 'emp-c' },
    ]
    const second = await harness({ existing: onlyExisting }).run(VALID_BODY)
    expect(second).toEqual({ status: 200, body: { ok: true, inserted: 0 } })

    const noop = harness({ existing: onlyExisting })
    const outcome = await noop.run(VALID_BODY)
    expect(outcome.body).toEqual({ ok: true, inserted: 0 })
    expect(noop.inserts).toHaveLength(0)
    expect(noop.audits).toHaveLength(1)
    expect(noop.audits[0].detail).toBe('{"inserted":0}')
  })

  it('answers 400 with the Thai cutoff message before the cutoff', async () => {
    const store = harness({
      sessions: [{ ...SESSION, session_date: TODAY, cutoff_time: '12:00' }],
    })
    const outcome = await store.run({ code: 'sup', cycle: TODAY })

    expect(outcome).toEqual({
      status: 400,
      body: { ok: false, message: 'ยังไม่ถึงเวลาปิดลงทะเบียน' },
    })
    expect(store.inserts).toHaveLength(0)
    expect(store.audits).toHaveLength(0)
  })

  it('answers 404 when the cycle has no session', async () => {
    const store = harness({ sessions: [] })
    const outcome = await store.run(VALID_BODY)

    expect(outcome).toEqual({ status: 404, body: { ok: false, message: 'ไม่พบรอบประชุมนี้' } })
    expect(store.inserts).toHaveLength(0)
    expect(store.audits).toHaveLength(0)
  })

  it('refuses a cycle that resolves to several sessions', async () => {
    const store = harness({ sessions: [SESSION, { ...SESSION, id: 'session-2' }] })
    const outcome = await store.run({ code: 'monthly', cycle: '2026-11' })

    expect(outcome).toEqual({ status: 400, body: { ok: false, message: 'ข้อมูลไม่ถูกต้อง' } })
    expect(store.inserts).toHaveLength(0)
    expect(store.audits).toHaveLength(0)
  })

  it('validates the body before reading anything', async () => {
    const store = harness()
    for (const body of [null, {}, { code: 'sup' }, { code: 'sup', cycle: 'x', extra: 1 }]) {
      const outcome = await store.run(body)
      expect(outcome).toEqual({ status: 400, body: { ok: false, message: 'ข้อมูลไม่ถูกต้อง' } })
    }
    expect(store.calls).toEqual({ sessions: 0, roster: 0, attendance: 0 })
  })

  it('answers 500 without leaking the failure when a read fails', async () => {
    const store = harness({ failWith: Object.assign(new Error('boom'), { code: 'fake' }) })
    const outcome = await store.run(VALID_BODY)

    expect(outcome).toEqual({
      status: 500,
      body: { ok: false, message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง' },
    })
    expect(store.inserts).toHaveLength(0)
  })
})
