// GET /api/leave/requests/:id/attachment: a certificate is streamed to the
// owning employee only, for a sick-leave request with a stored object path.
// Approvers, shift leads, HR and other employees are refused. Nothing is signed.
import { afterEach, describe, expect, it, vi } from 'vitest'

import app from '../worker/src/app.js'

const OWNER_ID = '11111111-1111-4111-8111-111111111111'
const APPROVER_ID = '22222222-2222-4222-8222-222222222222'
const HR_ID = '33333333-3333-4333-8333-333333333333'
const STRANGER_ID = '44444444-4444-4444-8444-444444444444'
const REQUEST_ID = '55555555-5555-4555-8555-555555555555'
const SICK_TYPE_ID = '66666666-6666-4666-8666-666666666666'
const PERSONAL_TYPE_ID = '77777777-7777-4777-8777-777777777777'
const TOKEN = 'a'.repeat(43)

const ENV = {
  SUPABASE_URL: 'https://fake-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
}

const STORED_PATH = `leave/${OWNER_ID}/LV-20261103-001/cert.pdf`

const EMPLOYEES = {
  [OWNER_ID]: { id: OWNER_ID, is_active: true },
  [APPROVER_ID]: { id: APPROVER_ID, is_active: true },
  [HR_ID]: { id: HR_ID, is_active: true },
  [STRANGER_ID]: { id: STRANGER_ID, is_active: true },
}

const TYPES = [
  { id: SICK_TYPE_ID, name: 'ลาป่วย' },
  { id: PERSONAL_TYPE_ID, name: 'ลากิจ' },
]

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function tableOf(url) {
  return new URL(url).pathname.split('/').pop()
}

function createFake({
  sessionEmployee = OWNER_ID,
  role = 'employee',
  attachment = STORED_PATH,
  leaveTypeId = SICK_TYPE_ID,
  failAudit = false,
} = {}) {
  const state = { signed: [], audits: [], failAudit, storageStatus: 200 }
  const now = new Date()
  const session = {
    id: 'session-1',
    employee_id: sessionEmployee,
    login_role: role,
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  }

  const original = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    const params = new URL(url).searchParams
    const table = tableOf(url)

    if (url.includes('/storage/v1/object/leave-certificates/')) {
      if (state.storageStatus !== 200) {
        return new Response(null, { status: state.storageStatus })
      }
      return new Response(PDF_BYTES, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      })
    }

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
      if (table === 'leave_types') {
        const wanted = params.get('id') ?? ''
        const id = wanted.startsWith('eq.') ? wanted.slice(3) : null
        const found = id ? TYPES.filter((type) => type.id === id) : TYPES
        return jsonResponse(found)
      }
      if (table === 'leave_requests') {
        return jsonResponse([
          {
            id: REQUEST_ID,
            employee_id: OWNER_ID,
            approver_id: APPROVER_ID,
            leave_type_id: leaveTypeId,
            has_medical_certificate: attachment !== null,
            medical_certificate_url: attachment,
          },
        ])
      }
      return jsonResponse([])
    }

    if (method === 'POST') {
      if (table === 'audit_logs') {
        if (state.failAudit) return jsonResponse({ code: '42501' }, 500)
        state.audits.push(init.body ? JSON.parse(init.body) : null)
        return jsonResponse([], 201)
      }
      return jsonResponse([], 201)
    }

    return new Response(null, { status: 204 })
  }

  return {
    state,
    restore() {
      globalThis.fetch = original
    },
  }
}

function requestAttachment(id = REQUEST_ID) {
  return app.request(
    `https://fake.local/api/leave/requests/${id}/attachment`,
    { method: 'GET', headers: { Cookie: `hr_session=${TOKEN}` } },
    ENV
  )
}

let current = null

function use(options) {
  current = createFake(options)
  return current
}

afterEach(() => {
  if (current) {
    current.restore()
    current = null
  }
  vi.unstubAllGlobals()
})

describe('GET /api/leave/requests/:id/attachment', () => {
  it('streams the certificate to its owner with the required headers', async () => {
    const fake = use()
    const response = await requestAttachment()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Disposition')).toBe('inline')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
    expect(await response.text()).toBe('%PDF-1')
    expect(fake.state.signed).toHaveLength(0)
    expect(fake.state.audits).toHaveLength(1)
  })

  it('refuses the request approver', async () => {
    const fake = use({ sessionEmployee: APPROVER_ID })
    const response = await requestAttachment()

    expect(response.status).toBe(403)
    expect(fake.state.audits).toHaveLength(0)
  })

  it('refuses HR on the employee route', async () => {
    const fake = use({ sessionEmployee: HR_ID, role: 'hr' })
    expect((await requestAttachment()).status).toBe(403)
    expect(fake.state.audits).toHaveLength(0)
  })

  it('refuses another employee', async () => {
    const fake = use({ sessionEmployee: STRANGER_ID })
    expect((await requestAttachment()).status).toBe(403)
    expect(fake.state.audits).toHaveLength(0)
  })

  it('refuses the owner when the leave type is not sick leave', async () => {
    const fake = use({ leaveTypeId: PERSONAL_TYPE_ID })
    expect((await requestAttachment()).status).toBe(403)
    expect(fake.state.audits).toHaveLength(0)
  })

  it('answers 404 when no certificate is stored', async () => {
    const fake = use({ attachment: null })
    expect((await requestAttachment()).status).toBe(404)
    expect(fake.state.audits).toHaveLength(0)
  })

  it('answers 404 for a non-object attachment path', async () => {
    const fake = use({ attachment: 'https://cdn.example.test/cert.pdf' })
    const response = await requestAttachment()

    expect(response.status).toBe(404)
    expect((await response.json()).message).toContain('ไม่ได้เก็บในระบบ')
    expect(fake.state.audits).toHaveLength(0)
  })

  it('writes an audit row with ids only, never a path or a name', async () => {
    const fake = use()
    await requestAttachment()

    const [row] = fake.state.audits
    expect(row.actor_id).toBe(OWNER_ID)
    expect(row.action).toBe('view_medical_cert')
    expect(row.entity).toBe('leave_request')
    expect(row.entity_id).toBe(REQUEST_ID)
    expect(row.detail).toBe(null)
    const text = JSON.stringify(row)
    expect(text.includes(STORED_PATH)).toBe(false)
    expect(text.includes('cert.pdf')).toBe(false)
    expect(text.includes('สมชาย')).toBe(false)
    expect(text.includes('/storage/')).toBe(false)
  })

  it('still streams when the audit write fails', async () => {
    const fake = use({ failAudit: true })
    const response = await requestAttachment()

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('%PDF-1')
    expect(fake.state.audits).toHaveLength(0)
  })
})
