// Employee submission with the certificate: multipart upload, the sick-leave
// threshold, and a refused calculation when the holidays cannot be read.
import { describe, expect, it } from 'vitest'

import app from '../worker/src/app.js'
import { MAX_ATTACHMENT_BYTES } from '../worker/src/leave-attachment.js'

const TOKEN = 'e'.repeat(43)
const EMP_ID = '11111111-1111-4111-8111-111111111111'
const APPROVER_ID = '22222222-2222-4222-8222-222222222222'
const TYPE_ID = '44444444-4444-4444-8444-444444444444'
const DEPT_ID = '66666666-6666-4666-8666-666666666666'

const ENV = {
  SUPABASE_URL: 'https://fake-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
}

const EMPLOYEES = {
  [EMP_ID]: { id: EMP_ID, full_name: 'พนักงาน', is_active: true, department_id: DEPT_ID },
  [APPROVER_ID]: { id: APPROVER_ID, full_name: 'ผู้อนุมัติ', is_active: true, department_id: DEPT_ID },
}

const SICK = {
  id: TYPE_ID,
  name: 'ลาป่วย',
  requires_attachment: true,
  is_active: true,
  attachment_required_from_days: 3,
}

const SHIFT = { code: 'DAY_FULL', label: 'เต็มวัน', is_half: false }

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function tableOf(url) {
  return new URL(url).pathname.split('/').pop()
}

function isStorageObject(url) {
  return /\/storage\/v1\/object\/leave-certificates\//.test(url)
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

function createFake({ holidaysFail = false, insertFail = false } = {}) {
  const state = { rows: [], uploads: [], deletes: [], audits: [] }
  const now = new Date()
  const session = {
    id: 'session-1',
    employee_id: EMP_ID,
    login_role: 'employee',
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  }

  const fake = installFetch(({ url, init }) => {
    const method = init.method ?? 'GET'
    const table = tableOf(url)

    if (method === 'GET') {
      if (table === 'auth_sessions') return jsonResponse([session])
      if (table === 'hr_admins' || table === 'meeting_admins' || table === 'system_admins') {
        return jsonResponse([])
      }
      if (table === 'employees') {
        return jsonResponse(Object.values(EMPLOYEES))
      }
      if (table === 'leave_types') return jsonResponse([SICK])
      if (table === 'shift_options') return jsonResponse([SHIFT])
      if (table === 'holidays') {
        return holidaysFail ? jsonResponse({ code: '42P01' }, 500) : jsonResponse([])
      }
      if (table === 'employee_approvers') {
        return jsonResponse([{ employee_id: EMP_ID, approver_id: APPROVER_ID, priority: 1, is_active: true }])
      }
      if (table === 'leave_requests') return jsonResponse([])
      return jsonResponse([])
    }

    if (method === 'POST') {
      if (isStorageObject(url)) {
        state.uploads.push(String(url))
        return jsonResponse({ Key: 'stored' }, 200)
      }
      const row = init.body ? JSON.parse(init.body) : null
      if (table === 'leave_requests') {
        if (insertFail) return jsonResponse({ code: '23503' }, 500)
        state.rows.push(row)
        return jsonResponse([{ id: 'leave-1', ...row }], 201)
      }
      if (table === 'audit_logs') {
        state.audits.push(row)
        return jsonResponse([], 201)
      }
      return jsonResponse([], 201)
    }

    if (method === 'DELETE') {
      if (isStorageObject(url)) {
        state.deletes.push(String(url))
        return new Response(null, { status: 200 })
      }
      return jsonResponse([], 200)
    }

    if (method === 'PATCH') return new Response(null, { status: 204 })
    return new Response(null, { status: 204 })
  })

  fake.state = state
  return fake
}

function submitRequest({ startDate, endDate, file = undefined } = {}) {
  const form = new FormData()
  form.append('leaveTypeId', TYPE_ID)
  form.append('shiftCode', SHIFT.code)
  form.append('startDate', startDate)
  form.append('endDate', endDate)
  if (file !== undefined) form.append('certificate', file)

  return app.request(
    'https://fake.local/api/leave/requests',
    {
      method: 'POST',
      headers: { Cookie: `hr_session=${TOKEN}` },
      body: form,
    },
    ENV
  )
}

const pngFile = (name = 'scan.png', type = 'image/png', bytes = PNG) =>
  new File([bytes], name, { type })

describe('POST /api/leave/requests with a certificate', () => {
  it('does not ask for a file on a two-day sick leave', async () => {
    const fake = createFake()
    try {
      const response = await submitRequest({ startDate: '2026-11-02', endDate: '2026-11-03' })
      expect(response.status).toBe(201)

      expect(fake.state.rows).toHaveLength(1)
      expect(fake.state.rows[0].medical_certificate_url).toBe(null)
      expect(fake.state.rows[0].has_medical_certificate).toBe(false)
      expect(fake.state.uploads).toHaveLength(0)
      expect(fake.state.audits[0].detail).toContain('"hasAttachment":false')
    } finally {
      fake.restore()
    }
  })

  it('refuses a three-day sick leave without the certificate', async () => {
    const fake = createFake()
    try {
      const response = await submitRequest({ startDate: '2026-11-02', endDate: '2026-11-04' })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.message).toContain('ใบรับรองแพทย์')
      expect(fake.state.rows).toHaveLength(0)
      expect(fake.state.uploads).toHaveLength(0)
    } finally {
      fake.restore()
    }
  })

  it('uploads to leave/<employee>/<request code>/ and stores the path, not a URL', async () => {
    const fake = createFake()
    try {
      const response = await submitRequest({
        startDate: '2026-11-02',
        endDate: '2026-11-04',
        file: pngFile(),
      })
      expect(response.status).toBe(201)

      const row = fake.state.rows[0]
      expect(row.request_code).toMatch(/^LV-\d{8}-\d{3}$/)
      expect(row.medical_certificate_url).toBe(`leave/${EMP_ID}/${row.request_code}/scan.png`)
      expect(row.medical_certificate_url.startsWith('http')).toBe(false)
      expect(row.has_medical_certificate).toBe(true)

      expect(fake.state.uploads).toHaveLength(1)
      expect(fake.state.uploads[0]).toContain(
        `/storage/v1/object/leave-certificates/leave/${EMP_ID}/${row.request_code}/scan.png`
      )

      const detail = JSON.parse(fake.state.audits[0].detail)
      expect(detail.requestCode).toBe(row.request_code)
      expect(detail.hasAttachment).toBe(true)
    } finally {
      fake.restore()
    }
  })

  it('deletes the uploaded object when the row cannot be saved', async () => {
    const fake = createFake({ insertFail: true })
    try {
      const response = await submitRequest({
        startDate: '2026-11-02',
        endDate: '2026-11-04',
        file: pngFile(),
      })
      expect(response.status).toBe(500)

      expect(fake.state.uploads).toHaveLength(1)
      expect(fake.state.deletes).toHaveLength(1)
      expect(fake.state.rows).toHaveLength(0)
    } finally {
      fake.restore()
    }
  })

  it('rejects an unsupported type, a renamed file and an oversized file', async () => {
    const fake = createFake()
    try {
      const wrongType = await submitRequest({
        startDate: '2026-11-02',
        endDate: '2026-11-04',
        file: pngFile('scan.exe', 'application/octet-stream'),
      })
      expect(wrongType.status).toBe(400)

      const renamed = await submitRequest({
        startDate: '2026-11-02',
        endDate: '2026-11-04',
        file: pngFile('scan.pdf', 'application/pdf'),
      })
      expect(renamed.status).toBe(400)
      expect((await renamed.json()).message).toContain('เนื้อหาไฟล์')

      const huge = await submitRequest({
        startDate: '2026-11-02',
        endDate: '2026-11-04',
        file: pngFile('big.png', 'image/png', new Uint8Array(MAX_ATTACHMENT_BYTES + 1)),
      })
      expect(huge.status).toBe(413)

      expect(fake.state.rows).toHaveLength(0)
      expect(fake.state.uploads).toHaveLength(0)
    } finally {
      fake.restore()
    }
  })
})

describe('holidays are required', () => {
  it('refuses the submission and does not calculate when the holidays fail', async () => {
    const fake = createFake({ holidaysFail: true })
    try {
      const response = await submitRequest({ startDate: '2026-11-02', endDate: '2026-11-03' })
      const body = await response.json()

      expect(response.status).toBe(503)
      expect(body.message).toBe('ระบบวันหยุดยังไม่พร้อม กรุณาติดต่อฝ่ายบุคคล')
      expect(fake.state.rows).toHaveLength(0)
      expect(fake.state.audits).toHaveLength(0)
    } finally {
      fake.restore()
    }
  })

  it('also refuses the holiday list read for the form', async () => {
    const fake = createFake({ holidaysFail: true })
    try {
      const response = await app.request(
        'https://fake.local/api/leave/holidays',
        { method: 'GET', headers: { Cookie: `hr_session=${TOKEN}` } },
        ENV
      )
      expect(response.status).toBe(503)
      expect((await response.json()).message).toBe('ระบบวันหยุดยังไม่พร้อม กรุณาติดต่อฝ่ายบุคคล')
    } finally {
      fake.restore()
    }
  })
})
