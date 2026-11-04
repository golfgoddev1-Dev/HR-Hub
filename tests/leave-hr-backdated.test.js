// HR backdated entry guards, phase 2 fix-up:
// - the chosen approver must really approve that employee (422 otherwise);
// - a pending/approved request in the same range blocks the entry (409 with the
//   blocking request code), while rejected/cancelled rows do not;
// - a successful entry still queues the phase 3 notification.
import { describe, expect, it } from 'vitest'

import app from '../worker/src/app.js'
import { findOverlappingRequest } from '../worker/src/leave-overlap.js'

const TOKEN = 'h'.repeat(43)
const HR_ID = '33333333-3333-4333-8333-333333333333'
const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111'
const APPROVER_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ID = '44444444-4444-4444-8444-444444444444'
const TYPE_ID = '55555555-5555-4555-8555-555555555555'
const DEPARTMENT_ID = '66666666-6666-4666-8666-666666666666'

const ENV = {
  SUPABASE_URL: 'https://fake-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
}

const EMPLOYEES = {
  [HR_ID]: { id: HR_ID, full_name: 'HR', is_active: true, department_id: null },
  [EMPLOYEE_ID]: {
    id: EMPLOYEE_ID,
    employee_code: 'EMP-001',
    full_name: 'พนักงาน',
    is_active: true,
    department_id: DEPARTMENT_ID,
  },
  [APPROVER_ID]: {
    id: APPROVER_ID,
    full_name: 'ผู้อนุมัติ',
    is_active: true,
    department_id: DEPARTMENT_ID,
  },
  [OTHER_ID]: { id: OTHER_ID, full_name: 'คนอื่น', is_active: true, department_id: null },
}

const LEAVE_TYPE = {
  id: TYPE_ID,
  name: 'ลากิจ',
  requires_attachment: false,
  is_active: true,
  attachment_required_from_days: 3,
}

const SHIFT = { code: 'DAY_FULL', label: 'เต็มวัน', is_half: false }

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

/** Fake PostgREST for the session, the guard and the backdated route. */
/** Applies the simple `column=eq.value` filters the route sends. */
function filterRows(rows, params) {
  return rows.filter((row) =>
    Object.keys(row).every((key) => {
      const raw = params.get(key)
      if (!raw || raw.startsWith('eq.') === false) return true
      const wanted = raw.slice(3)
      if (wanted === 'true') return row[key] === true
      if (wanted === 'false') return row[key] === false
      return String(row[key]) === wanted
    })
  )
}

function createFake({
  personalApprovers = [],
  departmentApprovers = [],
  conflicts = [],
} = {}) {
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
    const params = new URL(url).searchParams
    const table = tableOf(url)

    if (method === 'GET') {
      if (table === 'auth_sessions') return jsonResponse([session])
      if (table === 'hr_admins') return jsonResponse([{ employee_id: HR_ID }])
      if (table === 'meeting_admins' || table === 'system_admins') return jsonResponse([])
      if (table === 'employees') {
        const idParam = params.get('id')
        if (idParam && idParam.startsWith('eq.')) {
          const found = EMPLOYEES[idParam.slice(3)]
          return jsonResponse(found ? [found] : [])
        }
        if (idParam && idParam.startsWith('in.(')) {
          const ids = idParam.slice(4, -1).split(',').map((id) => decodeURIComponent(id))
          return jsonResponse(ids.map((id) => EMPLOYEES[id]).filter(Boolean))
        }
        return jsonResponse(Object.values(EMPLOYEES))
      }
      if (table === 'leave_types') return jsonResponse([LEAVE_TYPE])
      if (table === 'shift_options') return jsonResponse([SHIFT])
      if (table === 'holidays') return jsonResponse([])
      if (table === 'employee_approvers') {
        return jsonResponse(filterRows(personalApprovers, params))
      }
      if (table === 'department_approvers') {
        return jsonResponse(filterRows(departmentApprovers, params))
      }
      if (table === 'leave_requests') return jsonResponse(conflicts)
      return jsonResponse([])
    }

    if (method === 'POST') {
      const row = init.body ? JSON.parse(init.body) : null
      state.inserted.push({ table, row })
      if (table === 'leave_requests') return jsonResponse([{ id: 'leave-new', ...row }], 201)
      return jsonResponse([], 201)
    }

    if (method === 'PATCH') return emptyResponse(204)
    if (method === 'DELETE') return jsonResponse([], 200)
    return emptyResponse(204)
  })

  fake.state = state
  return fake
}

function backdatedRequest(overrides = {}) {
  return app.request(
    'https://fake.local/api/leave/hr/requests',
    {
      method: 'POST',
      headers: { Cookie: `hr_session=${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: EMPLOYEE_ID,
        leaveTypeId: TYPE_ID,
        shiftCode: SHIFT.code,
        startDate: '2026-10-28',
        endDate: '2026-10-29',
        approverId: APPROVER_ID,
        ...overrides,
      }),
    },
    ENV
  )
}

function rowsOf(state, table) {
  return state.inserted.filter((item) => item.table === table).map((item) => item.row)
}

describe('POST /api/leave/hr/requests approver guard', () => {
  it('answers 422 when the approver has no active row for this employee', async () => {
    const fake = createFake()
    try {
      const response = await backdatedRequest()
      const body = await response.json()

      expect(response.status).toBe(422)
      expect(body.message).toContain('ผู้อนุมัติ')
      expect(rowsOf(fake.state, 'leave_requests')).toHaveLength(0)
      expect(rowsOf(fake.state, 'notification_queue')).toHaveLength(0)
    } finally {
      fake.restore()
    }
  })

  it('answers 422 when the only matching row is inactive', async () => {
    const fake = createFake({
      personalApprovers: [{ approver_id: APPROVER_ID, is_active: false }],
      departmentApprovers: [
        { department_id: DEPARTMENT_ID, employee_id: APPROVER_ID, is_active: false },
      ],
    })
    try {
      const response = await backdatedRequest()
      expect(response.status).toBe(422)
      expect(rowsOf(fake.state, 'leave_requests')).toHaveLength(0)
    } finally {
      fake.restore()
    }
  })

  it('accepts the department approver of the employee and queues the push', async () => {
    const fake = createFake({
      departmentApprovers: [
        { department_id: DEPARTMENT_ID, employee_id: APPROVER_ID, is_active: true },
      ],
    })
    try {
      const response = await backdatedRequest()
      expect(response.status).toBe(201)

      const requests = rowsOf(fake.state, 'leave_requests')
      expect(requests).toHaveLength(1)
      expect(requests[0].employee_id).toBe(EMPLOYEE_ID)
      expect(requests[0].approver_id).toBe(APPROVER_ID)
      expect(requests[0].source).toBe('hr_backdated')
      expect(requests[0].status).toBe('approved')

      // Phase 3 enqueue must survive the phase 2 changes.
      const queued = rowsOf(fake.state, 'notification_queue')
      expect(queued).toHaveLength(1)
      expect(queued[0].kind).toBe('leave_backdated')
      expect(queued[0].employee_id).toBe(EMPLOYEE_ID)
      expect(rowsOf(fake.state, 'audit_logs')).toHaveLength(1)
    } finally {
      fake.restore()
    }
  })
})

describe('POST /api/leave/hr/requests date overlap', () => {
  const personal = [{ approver_id: APPROVER_ID, is_active: true }]

  it('answers 409 with the blocking request code', async () => {
    const fake = createFake({
      personalApprovers: personal,
      conflicts: [
        {
          id: 'leave-old',
          request_code: 'LV-20261020-ABCDEF',
          start_date: '2026-10-27',
          end_date: '2026-10-28',
          status: 'pending',
        },
      ],
    })
    try {
      const response = await backdatedRequest()
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.conflictRequestCode).toBe('LV-20261020-ABCDEF')
      expect(body.message).toContain('LV-20261020-ABCDEF')
      expect(rowsOf(fake.state, 'leave_requests')).toHaveLength(0)
    } finally {
      fake.restore()
    }
  })

  it('blocks an approved request too', async () => {
    const fake = createFake({
      personalApprovers: personal,
      conflicts: [
        {
          id: 'leave-approved',
          request_code: 'LV-20261010-APPROV',
          start_date: '2026-10-29',
          end_date: '2026-10-30',
          status: 'approved',
        },
      ],
    })
    try {
      const response = await backdatedRequest()
      expect(response.status).toBe(409)
      expect((await response.json()).conflictRequestCode).toBe('LV-20261010-APPROV')
    } finally {
      fake.restore()
    }
  })

  it('lets the entry through when the other requests are rejected or cancelled', async () => {
    const fake = createFake({
      personalApprovers: personal,
      conflicts: [
        {
          id: 'leave-rejected',
          request_code: 'LV-20261001-REJECT',
          start_date: '2026-10-28',
          end_date: '2026-10-29',
          status: 'rejected',
        },
        {
          id: 'leave-cancelled',
          request_code: 'LV-20261002-CANCEL',
          start_date: '2026-10-28',
          end_date: '2026-10-29',
          status: 'cancelled',
        },
      ],
    })
    try {
      const response = await backdatedRequest()
      expect(response.status).toBe(201)
      expect(rowsOf(fake.state, 'leave_requests')).toHaveLength(1)
    } finally {
      fake.restore()
    }
  })
})

describe('POST /api/leave/hr/requests certificate checkbox', () => {
  const personal = [{ approver_id: APPROVER_ID, is_active: true }]

  it('stores the checkbox and always a null link', async () => {
    const unticked = createFake({ personalApprovers: personal })
    try {
      const response = await backdatedRequest()
      expect(response.status).toBe(201)
      const row = rowsOf(unticked.state, 'leave_requests')[0]
      expect(row.has_medical_certificate).toBe(false)
      expect(row.medical_certificate_url).toBe(null)
      expect((await response.json()).request.hasMedicalCertificate).toBe(false)
    } finally {
      unticked.restore()
    }

    const ticked = createFake({ personalApprovers: personal })
    try {
      const response = await backdatedRequest({ hasMedicalCertificate: true })
      expect(response.status).toBe(201)
      const row = rowsOf(ticked.state, 'leave_requests')[0]
      expect(row.has_medical_certificate).toBe(true)
      expect(row.medical_certificate_url).toBe(null)
      expect((await response.json()).request.hasMedicalCertificate).toBe(true)
    } finally {
      ticked.restore()
    }
  })

  it('answers 400 when the link is sent', async () => {
    const fake = createFake({ personalApprovers: personal })
    try {
      const response = await backdatedRequest({
        medicalCertificateUrl: 'https://example.test/cert.pdf',
      })
      expect(response.status).toBe(400)
      expect(rowsOf(fake.state, 'leave_requests')).toHaveLength(0)
    } finally {
      fake.restore()
    }
  })

  it('answers 400 when a file is uploaded instead', async () => {
    const fake = createFake({ personalApprovers: personal })
    try {
      const form = new FormData()
      form.append('employeeId', EMPLOYEE_ID)
      form.append('leaveTypeId', TYPE_ID)
      form.append('shiftCode', SHIFT.code)
      form.append('startDate', '2026-10-28')
      form.append('endDate', '2026-10-29')
      form.append('approverId', APPROVER_ID)
      form.append(
        'certificate',
        new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'scan.png', {
          type: 'image/png',
        })
      )

      const response = await app.request(
        'https://fake.local/api/leave/hr/requests',
        { method: 'POST', headers: { Cookie: `hr_session=${TOKEN}` }, body: form },
        ENV
      )
      expect(response.status).toBe(400)
      expect(rowsOf(fake.state, 'leave_requests')).toHaveLength(0)
    } finally {
      fake.restore()
    }
  })
})

describe('findOverlappingRequest', () => {
  const span = { startDate: '2026-10-28', endDate: '2026-10-29' }

  it('treats touching days as an overlap', () => {
    expect(
      findOverlappingRequest(
        [{ id: 'a', request_code: 'LV-A', start_date: '2026-10-29', end_date: '2026-10-31', status: 'approved' }],
        span
      )?.requestCode
    ).toBe('LV-A')

    expect(
      findOverlappingRequest(
        [{ id: 'b', request_code: 'LV-B', start_date: '2026-10-26', end_date: '2026-10-28', status: 'pending' }],
        span
      )?.requestCode
    ).toBe('LV-B')
  })

  it('ignores rejected, cancelled and non-overlapping rows', () => {
    expect(
      findOverlappingRequest(
        [
          { id: 'r', request_code: 'LV-R', start_date: '2026-10-28', end_date: '2026-10-28', status: 'rejected' },
          { id: 'c', request_code: 'LV-C', start_date: '2026-10-28', end_date: '2026-10-28', status: 'cancelled' },
          { id: 'f', request_code: 'LV-F', start_date: '2026-11-02', end_date: '2026-11-03', status: 'approved' },
        ],
        span
      )
    ).toBe(null)
  })

  it('returns null for unusable input instead of throwing', () => {
    expect(findOverlappingRequest(null, span)).toBe(null)
    expect(findOverlappingRequest([], { startDate: 'x', endDate: 'y' })).toBe(null)
    expect(findOverlappingRequest([{ start_date: null, end_date: null, status: 'pending' }], span)).toBe(null)
  })
})
