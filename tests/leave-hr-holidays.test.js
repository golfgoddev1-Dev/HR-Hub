// HR holiday endpoints are keyed by holiday_date: the table is
// holidays (holiday_date primary key, name) with no `date` and no created_at.
import { describe, expect, it } from 'vitest'

import app from '../worker/src/app.js'

const TOKEN = 'h'.repeat(43)
const HR_ID = '33333333-3333-4333-8333-333333333333'

const ENV = {
  SUPABASE_URL: 'https://fake-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
}

const EXISTING = [{ holiday_date: '2026-12-31', name: 'หยุดสิ้นปี' }]

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function emptyResponse(status = 204) {
  return new Response(null, { status })
}

function tableOf(url) {
  return new URL(url).pathname.split('/').pop()
}

function installFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input), init, method: init.method ?? 'GET' }
    calls.push(call)
    return handler(call)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

function createFake({ holidays = EXISTING } = {}) {
  const state = { inserted: [], deleted: [] }
  const now = new Date()
  const session = {
    id: 'session-1',
    employee_id: HR_ID,
    login_role: 'hr',
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  }

  const fake = installFetch(({ url, init }) => {
    const method = init.method ?? 'GET'
    const table = tableOf(url)

    if (method === 'GET') {
      if (table === 'auth_sessions') return jsonResponse([session])
      if (table === 'hr_admins') return jsonResponse([{ employee_id: HR_ID }])
      if (table === 'employees') {
        return jsonResponse([
          { id: HR_ID, full_name: 'HR', is_active: true, department_id: null },
        ])
      }
      if (table === 'holidays') return jsonResponse(holidays)
      return jsonResponse([])
    }

    if (method === 'POST') {
      const body = init.body ? JSON.parse(init.body) : null
      state.inserted.push({ table, body })
      if (table === 'holidays') return jsonResponse([body], 201)
      return jsonResponse([], 201)
    }

    if (method === 'DELETE') {
      const params = new URL(url).searchParams
      const filter = params.get('holiday_date') ?? ''
      const wanted = filter.startsWith('eq.') ? filter.slice(3) : null
      const matched = holidays.filter((row) => row.holiday_date === wanted)
      state.deleted.push({ table, wanted })
      return jsonResponse(matched, 200)
    }

    if (method === 'PATCH') return emptyResponse(204)
    return emptyResponse(204)
  })

  fake.state = state
  return fake
}

function call(path, { method = 'GET', body } = {}) {
  return app.request(
    `https://fake.local${path}`,
    {
      method,
      headers: {
        Cookie: `hr_session=${TOKEN}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    ENV
  )
}

describe('GET /api/leave/hr/holidays', () => {
  it('reads and returns holiday_date, never date, id or created_at', async () => {
    const fake = createFake()
    try {
      const response = await call('/api/leave/hr/holidays')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.holidays).toEqual([{ holiday_date: '2026-12-31', name: 'หยุดสิ้นปี' }])
      expect(Object.keys(body.holidays[0])).toEqual(['holiday_date', 'name'])

      const selects = fake.calls
        .filter((item) => item.method === 'GET' && /\/rest\/v1\/holidays/.test(item.url))
        .map((item) => new URL(item.url).searchParams.get('select'))
      expect(selects).toContain('holiday_date,name')
      for (const select of selects) {
        expect(select).not.toContain('created_at')
        expect(select.split(',')).not.toContain('id')
      }
    } finally {
      fake.restore()
    }
  })

  it('filters a year on holiday_date', async () => {
    const fake = createFake()
    try {
      await call('/api/leave/hr/holidays?year=2026')
      const holidayUrls = fake.calls
        .filter((item) => /\/rest\/v1\/holidays/.test(item.url))
        .map((item) => new URL(item.url).searchParams)

      const withFilter = holidayUrls.find((params) => params.get('holiday_date') !== null)
      expect(withFilter.get('holiday_date')).toBe('gte.2026-01-01')
      expect(paramsOfDateRange(holidayUrls)).toBe('lte.2026-12-31')
      expect(holidayUrls.every((params) => params.get('date') === null)).toBe(true)
    } finally {
      fake.restore()
    }
  })
})

function paramsOfDateRange(list) {
  for (const params of list) {
    const value = params.getAll('holiday_date')
    if (value.length > 1) return value[1]
  }
  return null
}

describe('POST /api/leave/hr/holidays', () => {
  it('inserts holiday_date and name only', async () => {
    const fake = createFake()
    try {
      const response = await call('/api/leave/hr/holidays', {
        method: 'POST',
        body: { holiday_date: '2027-01-02', name: 'หยุดชดเชย' },
      })
      const body = await response.json()

      expect(response.status).toBe(201)
      expect(body.holiday).toEqual({ holiday_date: '2027-01-02', name: 'หยุดชดเชย' })

      const inserted = fake.state.inserted.filter((item) => item.table === 'holidays')
      expect(inserted).toHaveLength(1)
      expect(inserted[0].body).toEqual({ holiday_date: '2027-01-02', name: 'หยุดชดเชย' })
    } finally {
      fake.restore()
    }
  })

  it('rejects a malformed holiday_date and a body that uses the old key', async () => {
    const fake = createFake()
    try {
      const malformed = await call('/api/leave/hr/holidays', {
        method: 'POST',
        body: { holiday_date: '31-12-2026', name: 'ผิด' },
      })
      expect(malformed.status).toBe(400)

      const oldKey = await call('/api/leave/hr/holidays', {
        method: 'POST',
        body: { date: '2026-12-30', name: 'ผิด' },
      })
      expect(oldKey.status).toBe(400)
      expect(fake.state.inserted.filter((item) => item.table === 'holidays')).toHaveLength(0)
    } finally {
      fake.restore()
    }
  })
})

describe('POST /api/leave/hr/holidays/:holiday_date/delete', () => {
  it('deletes by holiday_date and reports it back', async () => {
    const fake = createFake()
    try {
      const response = await call('/api/leave/hr/holidays/2026-12-31/delete', {
        method: 'POST',
        body: {},
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.holiday_date).toBe('2026-12-31')
      expect(fake.state.deleted).toEqual([{ table: 'holidays', wanted: '2026-12-31' }])
    } finally {
      fake.restore()
    }
  })

  it('answers 404 for a date that is not a holiday', async () => {
    const fake = createFake()
    try {
      const response = await call('/api/leave/hr/holidays/2026-05-05/delete', {
        method: 'POST',
        body: {},
      })
      expect(response.status).toBe(404)
    } finally {
      fake.restore()
    }
  })

  it('rejects a key that is not a date without touching the table', async () => {
    const fake = createFake()
    try {
      const response = await call('/api/leave/hr/holidays/not-a-date/delete', {
        method: 'POST',
        body: {},
      })
      expect(response.status).toBe(400)
      expect(fake.state.deleted).toHaveLength(0)
    } finally {
      fake.restore()
    }
  })
})
