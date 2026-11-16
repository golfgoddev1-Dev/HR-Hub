// Worker routes for leave quotas: HR reads and saves one year per employee, and
// an employee reads only their own balance. The balance is built from the stored
// leave_requests.days, so a half day counts as 0.5 in both places.
import { afterEach, describe, expect, it } from 'vitest'

import app from '../worker/src/app.js'

const TOKEN = 'q'.repeat(43)
const HR_ID = '99999999-9999-4999-8999-999999999999'
const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '88888888-8888-4888-8888-888888888888'

const TYPE_SICK = '22222222-2222-4222-8222-222222222222'
const TYPE_PERSONAL = '33333333-3333-4333-8333-333333333333'
const TYPE_INACTIVE = '44444444-4444-4444-8444-444444444444'

const ENV = {
  SUPABASE_URL: 'https://fake-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
}

const TYPES = [
  { id: TYPE_SICK, name: 'ลาป่วย', is_active: true },
  { id: TYPE_PERSONAL, name: 'ลากิจ', is_active: true },
  { id: TYPE_INACTIVE, name: 'ลาเลิกใช้', is_active: false },
]

const REQUESTS = [
  { leave_type_id: TYPE_SICK, status: 'approved', days: 2 },
  { leave_type_id: TYPE_SICK, status: 'pending', days: 0.5 },
  { leave_type_id: TYPE_PERSONAL, status: 'approved', days: 1 },
]

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function emptyResponse(status = 204) {
  return new Response(null, { status })
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

function queryValue(url, name) {
  const raw = new URL(url).searchParams.get(name) ?? ''
  return raw.startsWith('eq.') ? raw.slice(3) : raw
}

/**
 * One fake database: sessions, credentials, employees, leave types, stored
 * quotas and stored requests, keyed by table name. Writes mutate the quota list
 * so the route's own re-read returns what was saved.
 */
function createFake({
  role = 'hr',
  sessionEmployeeId = HR_ID,
  quotas = [],
  requests = REQUESTS,
} = {}) {
  const state = { saves: [], deletes: [], audits: [], calls: [] }
  const stored = quotas.map((row) => ({ ...row }))
  const now = new Date()
  const session = {
    id: 'session-1',
    employee_id: sessionEmployeeId,
    login_role: role,
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  }

  const fake = installFetch(({ url, init }) => {
    const method = init.method ?? 'GET'
    const parsed = new URL(url)
    const table = parsed.pathname.split('/').pop()
    state.calls.push({ url, method })

    if (method === 'GET') {
      if (table === 'auth_sessions') return jsonResponse([session])
      if (table === 'employee_credentials') {
        return jsonResponse([{ employee_id: sessionEmployeeId, must_change_pin: false }])
      }
      if (table === 'hr_admins') {
        return jsonResponse(role === 'hr' ? [{ employee_id: sessionEmployeeId }] : [])
      }
      if (table === 'employees') {
        return jsonResponse([
          {
            id: sessionEmployeeId,
            employee_code: 'E001',
            full_name: 'พนักงาน',
            is_active: true,
            department_id: null,
          },
        ])
      }
      if (table === 'leave_types') return jsonResponse(TYPES)
      if (table === 'employee_leave_quotas') {
        const year = Number(queryValue(url, 'year'))
        const employeeId = queryValue(url, 'employee_id')
        return jsonResponse(
          stored.filter((row) => row.year === year && row.employee_id === employeeId)
        )
      }
      if (table === 'leave_requests') return jsonResponse(requests)
      return jsonResponse([])
    }

    if (method === 'POST') {
      const body = init.body ? JSON.parse(init.body) : null
      if (table === 'employee_leave_quotas') {
        state.saves.push(body)
        const existing = stored.findIndex(
          (row) =>
            row.employee_id === body.employee_id &&
            row.leave_type_id === body.leave_type_id &&
            row.year === body.year
        )
        if (existing >= 0) stored.splice(existing, 1)
        stored.push({
          employee_id: body.employee_id,
          leave_type_id: body.leave_type_id,
          year: body.year,
          quota_days: body.quota_days,
        })
        return emptyResponse(201)
      }
      if (table === 'audit_logs') {
        state.audits.push(body)
        return jsonResponse([], 201)
      }
      return jsonResponse([], 201)
    }

    if (method === 'DELETE') {
      state.deletes.push({ url })
      if (table === 'employee_leave_quotas') {
        const employeeId = queryValue(url, 'employee_id')
        const leaveTypeId = queryValue(url, 'leave_type_id')
        const year = Number(queryValue(url, 'year'))
        for (let index = stored.length - 1; index >= 0; index -= 1) {
          const row = stored[index]
          if (
            row.employee_id === employeeId &&
            row.leave_type_id === leaveTypeId &&
            row.year === year
          ) {
            stored.splice(index, 1)
          }
        }
      }
      return emptyResponse(204)
    }

    return emptyResponse(204)
  })

  fake.state = state
  return fake
}

function call(path, { cookie = `hr_session=${TOKEN}`, method = 'GET', body } = {}) {
  return app.request(
    `https://fake.local${path}`,
    {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    ENV
  )
}

describe('GET /api/leave/balance', () => {
  let fake

  afterEach(() => {
    fake?.restore()
    fake = null
  })

  it('returns only the caller’s own numbers and ignores an employee id in the query', async () => {
    fake = createFake({
      role: 'employee',
      sessionEmployeeId: EMPLOYEE_ID,
      quotas: [
        { employee_id: EMPLOYEE_ID, leave_type_id: TYPE_SICK, year: 2026, quota_days: 10 },
        { employee_id: OTHER_ID, leave_type_id: TYPE_SICK, year: 2026, quota_days: 99 },
      ],
    })

    const response = await call(`/api/leave/balance?year=2026&employeeId=${OTHER_ID}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')

    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.year).toBe(2026)
    // The inactive type is not part of the balance at all.
    expect(data.results.map((row) => row.leaveTypeId)).toEqual([TYPE_SICK, TYPE_PERSONAL])

    const sick = data.results.find((row) => row.leaveTypeId === TYPE_SICK)
    // 10 quota - 2 approved - 0.5 waiting = 7.5 left.
    expect(sick).toMatchObject({ quota: 10, used: 2, pending: 0.5, remaining: 7.5 })

    // Every read was scoped to the session employee, never to the query value.
    // The session read also touches leave_requests (approver_id); the balance
    // read is the one filtered by employee_id.
    const scoped = fake.calls.filter(
      (entry) => entry.url.includes('leave_requests') && entry.url.includes('employee_id')
    )
    expect(scoped.length).toBeGreaterThan(0)
    for (const entry of scoped) {
      expect(entry.url).toContain(`employee_id=eq.${EMPLOYEE_ID}`)
      expect(entry.url).not.toContain(OTHER_ID)
    }
    const quotaCalls = fake.calls.filter((entry) => entry.url.includes('employee_leave_quotas'))
    for (const entry of quotaCalls) {
      expect(entry.url).toContain(`employee_id=eq.${EMPLOYEE_ID}`)
    }
  })

  it('keeps remaining null for a type with no quota', async () => {
    fake = createFake({ role: 'employee', sessionEmployeeId: EMPLOYEE_ID })
    const data = await (await call('/api/leave/balance?year=2026')).json()

    const personal = data.results.find((row) => row.leaveTypeId === TYPE_PERSONAL)
    expect(personal).toEqual({
      leaveTypeId: TYPE_PERSONAL,
      name: 'ลากิจ',
      quota: null,
      used: 1,
      pending: 0,
      remaining: null,
    })
  })

  it('refuses a caller with no session', async () => {
    fake = createFake({ role: 'employee', sessionEmployeeId: EMPLOYEE_ID })
    const response = await call('/api/leave/balance?year=2026', { cookie: '' })
    expect(response.status).toBe(401)
    expect((await response.json()).ok).toBe(false)
  })

  it('answers 400 with the Thai year message for a bad year', async () => {
    fake = createFake({ role: 'employee', sessionEmployeeId: EMPLOYEE_ID })
    const response = await call('/api/leave/balance?year=26')
    expect(response.status).toBe(400)
    expect((await response.json()).message).toContain('ปีไม่ถูกต้อง')
  })
})

describe('GET /api/hr/employees/:id/leave-quotas', () => {
  let fake

  afterEach(() => {
    fake?.restore()
    fake = null
  })

  it('returns one row per active leave type with the quota or null', async () => {
    fake = createFake({
      quotas: [
        { employee_id: EMPLOYEE_ID, leave_type_id: TYPE_SICK, year: 2026, quota_days: 10 },
      ],
    })

    const response = await call(`/api/hr/employees/${EMPLOYEE_ID}/leave-quotas?year=2026`)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.results).toEqual([
      { leaveTypeId: TYPE_SICK, name: 'ลาป่วย', quota: 10 },
      { leaveTypeId: TYPE_PERSONAL, name: 'ลากิจ', quota: null },
    ])
  })

  it('refuses a caller who is not HR', async () => {
    fake = createFake({ role: 'employee', sessionEmployeeId: EMPLOYEE_ID })
    const response = await call(`/api/hr/employees/${EMPLOYEE_ID}/leave-quotas?year=2026`)
    expect(response.status).toBe(403)
  })

  it('refuses a request with no session', async () => {
    fake = createFake()
    const response = await call(`/api/hr/employees/${EMPLOYEE_ID}/leave-quotas?year=2026`, {
      cookie: '',
    })
    expect(response.status).toBe(401)
  })
})

describe('PUT /api/hr/employees/:id/leave-quotas', () => {
  let fake

  afterEach(() => {
    fake?.restore()
    fake = null
  })

  const PATH = `/api/hr/employees/${EMPLOYEE_ID}/leave-quotas`

  it('saves a quota, clears an empty one, and audits the write', async () => {
    fake = createFake({
      quotas: [
        { employee_id: EMPLOYEE_ID, leave_type_id: TYPE_PERSONAL, year: 2026, quota_days: 6 },
      ],
    })

    const response = await call(PATH, {
      method: 'PUT',
      body: {
        year: 2026,
        quotas: [
          { leaveTypeId: TYPE_SICK, days: 10 },
          { leaveTypeId: TYPE_PERSONAL, days: null },
        ],
      },
    })

    expect(response.status).toBe(200)
    expect(fake.state.saves).toHaveLength(1)
    expect(fake.state.saves[0]).toMatchObject({
      employee_id: EMPLOYEE_ID,
      leave_type_id: TYPE_SICK,
      year: 2026,
      quota_days: 10,
      updated_by: HR_ID,
    })
    // The empty value deleted the personal row instead of storing zero.
    expect(fake.state.deletes).toHaveLength(1)
    expect(fake.state.deletes[0].url).toContain(`leave_type_id=eq.${TYPE_PERSONAL}`)

    expect(fake.state.audits).toHaveLength(1)
    expect(fake.state.audits[0]).toMatchObject({
      actor_id: HR_ID,
      action: 'employee_leave_quotas_updated',
      entity: 'employee',
      entity_id: EMPLOYEE_ID,
    })

    const data = await response.json()
    expect(data.results).toEqual([
      { leaveTypeId: TYPE_SICK, name: 'ลาป่วย', quota: 10 },
      { leaveTypeId: TYPE_PERSONAL, name: 'ลากิจ', quota: null },
    ])
  })

  it('refuses a caller who is not HR', async () => {
    fake = createFake({ role: 'employee', sessionEmployeeId: EMPLOYEE_ID })
    const response = await call(PATH, {
      method: 'PUT',
      body: { year: 2026, quotas: [] },
    })
    expect(response.status).toBe(403)
  })

  it.each([
    ['a year out of range', { year: 1999, quotas: [] }, 'ปีไม่ถูกต้อง'],
    [
      'more days than the range allows',
      { year: 2026, quotas: [{ leaveTypeId: TYPE_SICK, days: 400 }] },
      'จำนวนวันไม่ถูกต้อง',
    ],
    [
      'a fraction that is not a half day',
      { year: 2026, quotas: [{ leaveTypeId: TYPE_SICK, days: 0.3 }] },
      'จำนวนวันไม่ถูกต้อง',
    ],
    [
      'a leave type that is not active',
      { year: 2026, quotas: [{ leaveTypeId: TYPE_INACTIVE, days: 5 }] },
      'ไม่พบประเภทลาที่เลือก',
    ],
    [
      'the same leave type twice',
      {
        year: 2026,
        quotas: [
          { leaveTypeId: TYPE_SICK, days: 5 },
          { leaveTypeId: TYPE_SICK, days: 6 },
        ],
      },
      'มีประเภทลาซ้ำ',
    ],
    [
      'a leave type id that is not an id',
      { year: 2026, quotas: [{ leaveTypeId: 'not-a-uuid', days: 5 }] },
      'ไม่พบประเภทลาที่เลือก',
    ],
  ])('answers 400 with a Thai message for %s', async (_label, body, message) => {
    fake = createFake()
    const response = await call(PATH, { method: 'PUT', body })

    expect(response.status).toBe(400)
    expect((await response.json()).message).toContain(message)
    expect(fake.state.saves).toHaveLength(0)
    expect(fake.state.audits).toHaveLength(0)
  })
})
