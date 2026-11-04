// Request codes: LV-YYYYMMDD-NNN with a per-day sequence, and the retry that
// takes a fresh number when the unique index rejects the insert.
import { describe, expect, it } from 'vitest'

import {
  highestSequence,
  insertWithRequestCode,
  nextRequestCode,
} from '../worker/src/leave-request-code.js'
import {
  requestCodeFor,
  requestCodePrefix,
  requestCodeSequence,
} from '../worker/src/leave-rules.js'

const NOW = new Date('2026-11-03T03:00:00.000Z') // 10:00 in Bangkok

describe('code format', () => {
  it('uses the Bangkok date and a three-digit sequence', () => {
    expect(requestCodePrefix(NOW)).toBe('LV-20261103-')
    expect(requestCodeFor('LV-20261103-', 1)).toBe('LV-20261103-001')
    expect(requestCodeFor('LV-20261103-', 42)).toBe('LV-20261103-042')
    expect(requestCodeFor('LV-20261103-', 1234)).toBe('LV-20261103-1234')
    expect(requestCodeFor('LV-20261103-', 0)).toBe('LV-20261103-001')
  })

  it('reads a sequence back, and ignores codes from another day', () => {
    const prefix = 'LV-20261103-'
    expect(requestCodeSequence('LV-20261103-007', prefix)).toBe(7)
    expect(requestCodeSequence('LV-20261102-007', prefix)).toBe(0)
    expect(requestCodeSequence('LV-20261103-ABCDEF', prefix)).toBe(0)
    expect(requestCodeSequence(null, prefix)).toBe(0)
    expect(highestSequence(['LV-20261103-003', 'LV-20261103-011', 'LV-20261102-099'], prefix)).toBe(
      11
    )
  })

  it('rolls past the random-suffix codes of the older format', () => {
    const prefix = 'LV-20261103-'
    expect(highestSequence(['LV-20261103-ZZZZZZ'], prefix)).toBe(0)
  })
})

function fakeCodeDb(codes) {
  const stored = [...codes]
  const queries = [];
  return {
    queries,
    stored,
    async select(table, options) {
      queries.push(options)
      return stored.map((request_code) => ({ request_code }))
    },
  }
}

describe('nextRequestCode', () => {
  it('continues from the highest code of the day', async () => {
    const db = fakeCodeDb(['LV-20261103-001', 'LV-20261103-004', 'LV-20261102-009'])
    expect(await nextRequestCode(db, NOW)).toBe('LV-20261103-005')

    const filter = db.queries[0].filters[0]
    expect(filter).toEqual(['request_code', 'like', 'LV-20261103-%'])
  })

  it('starts at 001 on a day with no codes', async () => {
    expect(await nextRequestCode(fakeCodeDb([]), NOW)).toBe('LV-20261103-001')
  })
})

describe('insertWithRequestCode', () => {
  it('retries with a fresh number after a unique violation', async () => {
    const inserted = []
    const codes = [];
    const db = {
      async select() {
        return codes.map((request_code) => ({ request_code }))
      },
      async insert(table, row) {
        if (inserted.length === 0) {
          inserted.push(row.request_code)
          codes.push(row.request_code);
          return { error: { code: '23505' } }
        }
        return { data: { id: 'leave-1', ...row }, error: null }
      },
    }

    const result = await insertWithRequestCode(db, (requestCode) => ({ request_code: requestCode }), {
      now: NOW,
    })

    expect(result.ok).toBe(true)
    expect(result.row.request_code).toBe('LV-20261103-002')
    expect(inserted).toEqual(['LV-20261103-001'])
  })

  it('gives up after three collisions', async () => {
    let attempts = 0
    const db = {
      async select() {
        return [{ request_code: 'LV-20261103-001' }]
      },
      async insert() {
        attempts += 1
        return { error: { code: '23505' } }
      },
    }

    const result = await insertWithRequestCode(db, (requestCode) => ({ request_code: requestCode }), {
      now: NOW,
    })

    expect(result.ok).toBe(false)
    expect(result.duplicate).toBe(true)
    expect(attempts).toBe(3)
  })

  it('rolls back the upload on a collision and on a real failure', async () => {
    const rolledBack = []

    const collisionDb = {
      async select() {
        return [{ request_code: 'LV-20261103-001' }]
      },
      async insert() {
        return { error: { code: '23505' } }
      },
    }

    const collision = await insertWithRequestCode(
      collisionDb,
      (requestCode) => ({ request_code: requestCode }),
      {
        now: NOW,
        beforeInsert: async () => ({ ok: true, rollback: async () => rolledBack.push('collision') }),
      }
    )
    expect(collision.duplicate).toBe(true)
    expect(rolledBack).toEqual(['collision', 'collision', 'collision'])

    const failingDb = {
      async select() {
        return []
      },
      async insert() {
        return { error: { code: '23503' } }
      },
    }

    const failed = await insertWithRequestCode(
      failingDb,
      (requestCode) => ({ request_code: requestCode }),
      {
        now: NOW,
        beforeInsert: async () => ({ ok: true, rollback: async () => rolledBack.push('failure') }),
      }
    )
    expect(failed.ok).toBe(false)
    expect(failed.duplicate).toBe(false)
    expect(rolledBack).toContain('failure')
  })

  it('stops when the preparation step fails', async () => {
    let inserted = 0
    const db = {
      async select() {
        return []
      },
      async insert() {
        inserted += 1
        return { data: { id: 'leave-1' }, error: null }
      },
    }

    const result = await insertWithRequestCode(db, (requestCode) => ({ request_code: requestCode }), {
      now: NOW,
      beforeInsert: async () => ({ ok: false, message: 'อัปโหลดไม่สำเร็จ', failed: true }),
    })

    expect(result.ok).toBe(false)
    expect(result.message).toBe('อัปโหลดไม่สำเร็จ')
    expect(inserted).toBe(0)
  })
})
