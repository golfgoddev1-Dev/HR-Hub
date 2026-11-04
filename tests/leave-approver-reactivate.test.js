// POST /api/leave/hr/approvers/:id/reactivate
// - role hr plus a fresh hr_admins row is required (403 otherwise);
// - an unknown row answers 404 and writes nothing;
// - success flips is_active back on, keeps the row and adds an audit row that
//   holds ids only (no names, no raw request body).
import { describe, expect, it } from 'vitest'

import app from '../worker/src/app.js'

const TOKEN = 'h'.repeat(43)
const HR_ID = '33333333-3333-4333-8333-333333333333'
const APPROVER_ID = '22222222-2222-4222-8222-222222222222'
const ROW_ID = '77777777-7777-4777-8777-777777777777'
const DEPARTMENT_ID = '66666666-6666-4666-8666-666666666666'

const ENV = {
  SUPABASE_URL: 'https://fake-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function emptyResponse(status = 204) {
  return new Response(null, { status })
}

function createFake({ role = 'hr', hrAdmin = true, departmentRows = [], employeeRows = [] } = {}) {
  const calls = []
  const patches = []
  const inserts = []
  const now = new Date()
  const session = {
    id: 'session-1',
    employee_id: HR_ID,
    login_role: role,
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  }

  const original = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const method = init.method ?? 'GET'
    const url = new URL(String(input))
    const table = url.pathname.split('/').pop()
    calls.push({ method, table, url: url.toString() })

    if (method === 'GET') {
      if (table === 'auth_sessions') return jsonResponse([session])
      if (table === 'employees') return jsonResponse([{ id: HR_ID, full_name: 'HR', is_active: true }])
      if (table === 'hr_admins') return jsonResponse(hrAdmin ? [{ employee_id: HR_ID }] : [])
      if (table === 'employee_credentials') return jsonResponse([])
      if (table === 'department_approvers') return jsonResponse(departmentRows)
      if (table === 'employee_approvers') return jsonResponse(employeeRows)
      return jsonResponse([])
    }

    if (method === 'PATCH') {
      // readSession refreshes last_active_at on every call; that is not a toggle.
      if (table === 'auth_sessions') return emptyResponse(204)
      const patch = JSON.parse(init.body)
      patches.push({ table, patch })
      const id = (url.searchParams.get('id') ?? '').replace(/^eq\./, '')
      const known = [...departmentRows, ...employeeRows].some((row) => row.id === id)
      return known ? jsonResponse([{ id, ...patch }]) : jsonResponse([])
    }

    if (method === 'POST') {
      inserts.push({ table, row: JSON.parse(init.body) })
      return jsonResponse([], 201)
    }

    return emptyResponse(204)
  }

  return {
    calls,
    patches,
    inserts,
    restore() {
      globalThis.fetch = original
    },
  }
}

function reactivate({ id = ROW_ID, scope = 'employee' } = {}) {
  return app.request(
    `https://fake.local/api/leave/hr/approvers/${id}/reactivate?scope=${scope}`,
    { method: 'POST', headers: { Cookie: `hr_session=${TOKEN}` } },
    ENV
  )
}

const EMPLOYEE_SCOPE_ROW = {
  id: ROW_ID,
  employee_id: 'applicant-1',
  approver_id: APPROVER_ID,
  priority: 10,
  is_active: false,
}

const DEPARTMENT_SCOPE_ROW = {
  id: ROW_ID,
  department_id: DEPARTMENT_ID,
  employee_id: APPROVER_ID,
  priority: 10,
  is_active: false,
}

describe('POST /api/leave/hr/approvers/:id/reactivate', () => {
  it('switches a personal approver back on and audits ids only', async () => {
    const fake = createFake({ employeeRows: [EMPLOYEE_SCOPE_ROW] })
    try {
      const response = await reactivate()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toMatchObject({ ok: true, id: ROW_ID, scope: 'employee', isActive: true })
      expect(fake.patches).toEqual([{ table: 'employee_approvers', patch: { is_active: true } }])

      const audit = fake.inserts.filter((item) => item.table === 'audit_logs')
      expect(audit).toHaveLength(1)
      expect(audit[0].row.action).toBe('leave_approver_reactivated')
      expect(audit[0].row.entity).toBe('leave_approver')
      expect(audit[0].row.entity_id).toBe(ROW_ID)
      expect(audit[0].row.actor_id).toBe(HR_ID)

      // Ids and a flag only: no name, no request body, no leave data.
      const detail = JSON.parse(audit[0].row.detail)
      expect(Object.keys(detail).sort()).toEqual(['approverId', 'rowKept', 'scope'])
      expect(detail).toEqual({ scope: 'employee', approverId: APPROVER_ID, rowKept: true })
      expect(audit[0].row.detail).not.toContain('full_name')
      expect(audit[0].row.detail).not.toContain('@')
    } finally {
      fake.restore()
    }
  })

  it('works on a department row and deletes nothing anywhere', async () => {
    const fake = createFake({ departmentRows: [DEPARTMENT_SCOPE_ROW] })
    try {
      const response = await reactivate({ scope: 'department' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.scope).toBe('department')
      expect(fake.patches).toEqual([{ table: 'department_approvers', patch: { is_active: true } }])

      // The row is switched on, never removed, and no leave request is touched.
      expect(fake.calls.filter((call) => call.method === 'DELETE')).toEqual([])
      expect(fake.calls.filter((call) => call.table === 'leave_requests')).toEqual([])
      expect(fake.inserts.filter((item) => item.table === 'leave_requests')).toEqual([])
    } finally {
      fake.restore()
    }
  })

  it('answers 403 for a signed-in employee role', async () => {
    const fake = createFake({ role: 'employee', hrAdmin: false, employeeRows: [EMPLOYEE_SCOPE_ROW] })
    try {
      const response = await reactivate()
      expect(response.status).toBe(403)
      expect((await response.json()).ok).toBe(false)
      expect(fake.patches).toEqual([])
      expect(fake.inserts).toEqual([])
    } finally {
      fake.restore()
    }
  })

  it('refuses a role hr session that is no longer in hr_admins', async () => {
    // readSession re-reads the admin tables, so the session itself is no longer
    // allowed and the guard never runs. Either way nothing is written.
    const fake = createFake({ hrAdmin: false, employeeRows: [EMPLOYEE_SCOPE_ROW] })
    try {
      const response = await reactivate()
      expect([401, 403]).toContain(response.status)
      expect(fake.patches).toEqual([])
      expect(fake.inserts).toEqual([])
    } finally {
      fake.restore()
    }
  })

  it('answers 404 for an unknown row and writes nothing', async () => {
    const fake = createFake()
    try {
      const response = await reactivate({ id: '99999999-9999-4999-8999-999999999999' })
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body.message).toBe('ไม่พบรายการผู้อนุมัตินี้')
      expect(fake.patches).toEqual([])
      expect(fake.inserts).toEqual([])
    } finally {
      fake.restore()
    }
  })

  it('answers 400 for a non-uuid id', async () => {
    const fake = createFake({ employeeRows: [EMPLOYEE_SCOPE_ROW] })
    try {
      const response = await reactivate({ id: 'not-a-uuid' })
      expect(response.status).toBe(400)
      expect(fake.patches).toEqual([])
    } finally {
      fake.restore()
    }
  })
})
