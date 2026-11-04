// GET /api/leave/requests/:id/attachment: only the owner, the approver of that
// request and HR get a signed URL, and it is never the public object URL.
import { describe, expect, it } from 'vitest'

import app from '../worker/src/app.js'

const OWNER_ID = '11111111-1111-4111-8111-111111111111'
const APPROVER_ID = '22222222-2222-4222-8222-222222222222'
const HR_ID = '33333333-3333-4333-8333-333333333333'
const STRANGER_ID = '44444444-4444-4444-8444-444444444444'
const REQUEST_ID = '55555555-5555-4555-8555-555555555555'
const TOKEN = 'a'.repeat(43)

const ENV = {
  SUPABASE_URL: 'https://fake-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
}

const STORED_PATH = `leave/${OWNER_ID}/LV-20261103-001/cert.pdf`;

const EMPLOYEES = {
  [OWNER_ID]: { id: OWNER_ID, is_active: true },
  [APPROVER_ID]: { id: APPROVER_ID, is_active: true },
  [HR_ID]: { id: HR_ID, is_active: true },
  [STRANGER_ID]: { id: STRANGER_ID, is_active: true },
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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

function createFake({
  sessionEmployee = OWNER_ID,
  role = 'employee',
  attachment = STORED_PATH,
  hasCertificate = attachment !== null,
} = {}) {
  const state = { signed: [] }
  const now = new Date()
  const session = {
    id: 'session-1',
    employee_id: sessionEmployee,
    login_role: role,
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  }

  const fake = installFetch(({ url, init }) => {
    const method = init.method ?? 'GET'
    const params = new URL(url).searchParams
    const table = tableOf(url)

    if (method === 'GET') {
      if (table === 'auth_sessions') return jsonResponse([session])
      if (table === 'hr_admins') {
        return jsonResponse(role === 'hr' ? [{ employee_id: sessionEmployee }] : [])
      }
      if (table === 'meeting_admins' || table === 'system_admins') return jsonResponse([])
      if (table === 'employees') {
        const wanted = params.get('id') ?? ''
        const id = wanted.startsWith('eq.') ? wanted.slice(3) : null
        const found = id ? EMPLOYEES[id] : null
        return jsonResponse(found ? [found] : [])
      }
      if (table === 'leave_requests') {
        return jsonResponse([
          {
            id: REQUEST_ID,
            employee_id: OWNER_ID,
            approver_id: APPROVER_ID,
            has_medical_certificate: hasCertificate,
            medical_certificate_url: attachment,
          },
        ])
      }
      return jsonResponse([])
    }

    if (method === 'POST') {
      if (/\/storage\/v1\/object\/sign\//.test(url)) {
        state.signed.push(String(url))
        return jsonResponse({
          signedURL: `/object/sign/leave-certificates/${STORED_PATH}?token=abc.def`,
        })
      }
      return jsonResponse([], 201)
    }

    return new Response(null, { status: 204 })
  })

  fake.state = state
  return fake
}

function requestAttachment(id = REQUEST_ID) {
  return app.request(
    `https://fake.local/api/leave/requests/${id}/attachment`,
    { method: 'GET', headers: { Cookie: `hr_session=${TOKEN}` } },
    ENV
  )
}

describe('GET /api/leave/requests/:id/attachment', () => {
  it('gives the owner a signed URL that expires in 60 seconds', async () => {
    const fake = createFake()
    try {
      const response = await requestAttachment()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.expiresIn).toBe(60)
      expect(body.url).toBe(
        `${ENV.SUPABASE_URL}/storage/v1/object/sign/leave-certificates/${STORED_PATH}?token=abc.def`
      )
      expect(body.url).toContain('token=')
      expect(body.url).not.toContain('/object/public/')

      expect(fake.state.signed).toHaveLength(1)
      expect(fake.state.signed[0]).toContain(
        `/storage/v1/object/sign/leave-certificates/${STORED_PATH}`
      )
      expect(fake.state.signed[0]).not.toContain('/object/public/')
    } finally {
      fake.restore()
    }
  })

  it('lets the approver of that request open it', async () => {
    const fake = createFake({ sessionEmployee: APPROVER_ID })
    try {
      expect((await requestAttachment()).status).toBe(200)
    } finally {
      fake.restore()
    }
  })

  it('lets HR open it', async () => {
    const fake = createFake({ sessionEmployee: HR_ID, role: 'hr' })
    try {
      expect((await requestAttachment()).status).toBe(200)
    } finally {
      fake.restore()
    }
  })

  it('refuses another employee', async () => {
    const fake = createFake({ sessionEmployee: STRANGER_ID })
    try {
      const response = await requestAttachment()
      expect(response.status).toBe(403)
      expect(fake.state.signed).toHaveLength(0)
    } finally {
      fake.restore()
    }
  })

  it('answers 404 for a certificate recorded without a file', async () => {
    const fake = createFake({ attachment: null, hasCertificate: true })
    try {
      const response = await requestAttachment()
      expect(response.status).toBe(404)
      expect(fake.state.signed).toHaveLength(0)
    } finally {
      fake.restore()
    }
  })

  it('answers 404 when there is no certificate, or it is not an object path', async () => {
    const none = createFake({ attachment: null })
    try {
      expect((await requestAttachment()).status).toBe(404)
      expect(none.state.signed).toHaveLength(0)
    } finally {
      none.restore()
    }

    const external = createFake({ attachment: 'https://cdn.example.test/cert.pdf' })
    try {
      const response = await requestAttachment()
      expect(response.status).toBe(404)
      expect((await response.json()).message).toContain('ไม่ได้เก็บในระบบ')
      expect(external.state.signed).toHaveLength(0)
    } finally {
      external.restore()
    }
  })
})
