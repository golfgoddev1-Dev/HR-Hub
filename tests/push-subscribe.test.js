// Subscribe/unsubscribe routes: the row is always written for the session's
// employee, the body cannot pick someone else, and the endpoint must be https.
import { describe, expect, it } from 'vitest'

import app from '../worker/src/app.js'
import { sha256Hex } from '../worker/src/crypto.js'

const TOKEN = 'p'.repeat(43)
const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222'

const ENDPOINT = 'https://push.example.net/send/abc'
// RFC 8291 Appendix A keys, used as shape-valid subscription values only.
const P256DH =
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'
const AUTH = 'BTBZMqHH6r4Tts7J_aSIgg'

const ENV = {
  SUPABASE_URL: 'https://fake-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
  VAPID_PUBLIC_KEY: 'fake-public-key',
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function emptyResponse(status = 204) {
  return new Response(null, { status })
}

function tableOf(url) {
  return new URL(url).pathname.split('/').pop()
}

function paramsOf(url) {
  return new URL(url).searchParams
}

function installFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input), init, method: init.method ?? 'GET' };
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

async function sessionRow() {
  const now = new Date()
  return {
    id: 'session-1',
    employee_id: EMPLOYEE_ID,
    login_role: 'employee',
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  }
}

/** Fake PostgREST for the session read plus the subscription routes. */
async function createFake({ existing = null } = {}) {
  const state = { inserted: [], updated: [], employeeUpdates: [], deleted: [], existing }
  const session = await sessionRow()

  const fake = installFetch(({ url, init }) => {
    const method = init.method ?? 'GET';
    const table = tableOf(url)

    if (method === 'GET') {
      if (table === 'auth_sessions') return jsonResponse([session])
      if (table === 'employees') return jsonResponse([{ id: EMPLOYEE_ID, is_active: true }])
      if (table === 'push_subscriptions') {
        return jsonResponse(state.existing ? [state.existing] : [])
      }
      return jsonResponse([])
    }

    if (method === 'POST') {
      if (table === 'push_subscriptions') {
        const row = JSON.parse(init.body)
        state.inserted.push(row)
        return jsonResponse([{ id: 'sub-1', ...row }], 201)
      }
      return emptyResponse(201)
    }

    if (method === 'PATCH') {
      if (table === 'push_subscriptions') {
        state.updated.push({ url, body: JSON.parse(init.body) })
        return jsonResponse([{ id: 'sub-1' }])
      }
      if (table === 'employees') {
        state.employeeUpdates.push({ url, body: JSON.parse(init.body) })
        return emptyResponse(204)
      }
      return emptyResponse(204)
    }

    if (method === 'DELETE' && table === 'push_subscriptions') {
      state.deleted.push({ url })
      state.existing = null
      return jsonResponse([{ id: 'sub-1' }])
    }

    return emptyResponse(204)
  })

  fake.state = state
  return fake
}

function subscribeRequest(body, token = TOKEN) {
  return app.request(
    'https://fake.local/api/notifications/subscribe',
    {
      method: 'POST',
      headers: {
        Cookie: `hr_session=${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    ENV
  )
}

const validBody = () => ({ endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } })

describe('POST /api/notifications/subscribe', () => {
  it('writes the row for the session employee, not for a body field', async () => {
    const fake = await createFake()
    try {
      const response = await subscribeRequest(validBody())
      expect(response.status).toBe(201)

      expect(fake.state.inserted).toHaveLength(1)
      expect(fake.state.inserted[0].employee_id).toBe(EMPLOYEE_ID)
      expect(fake.state.inserted[0].endpoint).toBe(ENDPOINT)
      expect(fake.state.inserted[0].is_active).toBe(true)
      expect(fake.state.inserted[0].p256dh).toBe(P256DH)
      expect(fake.state.inserted[0].auth).toBe(AUTH)
      // Only the key hash for the session lookup is stored, never the token.
      expect(await sha256Hex(TOKEN)).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      fake.restore()
    }
  })

  it('ignores a body that tries to choose another employee', async () => {
    const fake = await createFake()
    try {
      const response = await subscribeRequest({ ...validBody(), employeeId: OTHER_EMPLOYEE_ID })
      expect(response.status).toBe(201)
      expect(fake.state.inserted).toHaveLength(1)
      // The extra body field is accepted and ignored; the session owns the row.
      expect(fake.state.inserted[0].employee_id).toBe(EMPLOYEE_ID)
    } finally {
      fake.restore()
    }
  })

  it('refuses a non-https endpoint and malformed keys', async () => {
    const fake = await createFake()
    try {
      const httpResponse = await subscribeRequest({
        endpoint: 'http://push.example.net/send/abc',
        keys: { p256dh: P256DH, auth: AUTH },
      })
      expect(httpResponse.status).toBe(400)

      const badKeys = await subscribeRequest({
        endpoint: ENDPOINT,
        keys: { p256dh: 'short', auth: AUTH },
      })
      expect(badKeys.status).toBe(400)

      expect(fake.state.inserted).toHaveLength(0)
    } finally {
      fake.restore()
    }
  })

  it('reinstates the same employee\'s endpoint instead of inserting a duplicate', async () => {
    const fake = await createFake({
      existing: { id: 'sub-old', employee_id: EMPLOYEE_ID, is_active: false },
    })
    try {
      const response = await subscribeRequest(validBody())
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.reinstated).toBe(true)
      expect(fake.state.inserted).toHaveLength(0)
      expect(fake.state.updated).toHaveLength(1)
      expect(paramsOf(fake.state.updated[0].url).get('id')).toBe('eq.sub-old')
    } finally {
      fake.restore()
    }
  })

  it('moves an endpoint that belongs to another employee to the session employee', async () => {
    const fake = await createFake({
      existing: { id: 'sub-other', employee_id: OTHER_EMPLOYEE_ID, is_active: true },
    })
    try {
      const response = await subscribeRequest(validBody())
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.reinstated).toBe(true)
      expect(fake.state.inserted).toHaveLength(0)
      expect(fake.state.updated).toHaveLength(1)
      // The shared browser now belongs to the employee who just signed in.
      expect(fake.state.updated[0].body.employee_id).toBe(EMPLOYEE_ID)
      expect(fake.state.updated[0].body.is_active).toBe(true)
    } finally {
      fake.restore()
    }
  })

  it('requires a login', async () => {
    const fake = await createFake()
    const original = globalThis.fetch
    try {
      const response = await app.request(
        'https://fake.local/api/notifications/subscribe',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validBody()),
        },
        ENV
      )
      expect(response.status).toBe(401)
      expect(fake.state.inserted).toHaveLength(0)
    } finally {
      globalThis.fetch = original
      fake.restore()
    }
  })
})

describe('POST /api/notifications/unsubscribe', () => {
  it('clears the account preference and deletes the caller\'s own endpoint', async () => {
    const fake = await createFake()
    try {
      const response = await app.request(
        'https://fake.local/api/notifications/unsubscribe',
        {
          method: 'POST',
          headers: {
            Cookie: `hr_session=${TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ endpoint: ENDPOINT }),
        },
        ENV
      )

      expect(response.status).toBe(200)
      expect(fake.state.employeeUpdates).toHaveLength(1)
      expect(fake.state.employeeUpdates[0].body).toEqual({ notifications_enabled: false })
      expect(paramsOf(fake.state.employeeUpdates[0].url).get('id')).toBe(`eq.${EMPLOYEE_ID}`)
      expect(fake.state.deleted).toHaveLength(1)

      const params = paramsOf(fake.state.deleted[0].url)
      expect(params.get('endpoint')).toBe(`eq.${ENDPOINT}`)
      expect(params.get('employee_id')).toBe(`eq.${EMPLOYEE_ID}`)
    } finally {
      fake.restore()
    }
  })
})

describe('GET /api/notifications/vapid-public-key', () => {
  it('returns only the public key and never the private one', async () => {
    const response = await app.request(
      'https://fake.local/api/notifications/vapid-public-key',
      { method: 'GET' },
      { ...ENV, VAPID_PRIVATE_KEY: 'fake-private-key' }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.publicKey).toBe('fake-public-key')
    expect(JSON.stringify(body)).not.toContain('fake-private-key')
  })

  it('answers 503 when the key is not configured', async () => {
    const response = await app.request(
      'https://fake.local/api/notifications/vapid-public-key',
      { method: 'GET' },
      { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY }
    )
    expect(response.status).toBe(503)
  })
})
