// PUT /api/profile/hr-menus: the HR home shortcut list, per person.
//
// One route, five rules: HR only, 1 to 5 entries, no duplicates, every entry an
// HR navigation route, saved in the order given. The allowlist lives in the
// Worker, so a client cannot store a route that is not a menu.
import { afterEach, describe, expect, it, vi } from 'vitest'

import app from '../worker/src/app.js'

const HR_ID = '33333333-3333-4333-8333-333333333333'
const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'a'.repeat(43)

const ENV = {
  SUPABASE_URL: 'https://fake-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
}

const PEOPLE = {
  [HR_ID]: { id: HR_ID, is_active: true },
  [EMPLOYEE_ID]: { id: EMPLOYEE_ID, is_active: true },
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

function createFake({ sessionEmployee = HR_ID, role = 'hr', saved = [] } = {}) {
  const state = { patches: [], audits: [], stored: [...saved] }
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
    const table = tableOf(url)
    const params = new URL(url).searchParams

    if (method === 'GET') {
      if (table === 'auth_sessions') return jsonResponse([session])
      if (table === 'hr_admins') {
        return jsonResponse(role === 'hr' ? [{ employee_id: sessionEmployee }] : [])
      }
      if (table === 'meeting_admins' || table === 'system_admins') return jsonResponse([])
      if (table === 'employee_credentials') return jsonResponse([])
      if (table === 'employees') {
        const wanted = params.get('id') ?? ''
        const id = wanted.startsWith('eq.') ? wanted.slice(3) : sessionEmployee
        const found = PEOPLE[id]
        return jsonResponse(
          found ? [{ ...found, hr_menu_shortcuts: state.stored }] : []
        )
      }
      return jsonResponse([])
    }

    if (method === 'PATCH' && table === 'employees') {
      const patch = init.body ? JSON.parse(init.body) : {}
      state.patches.push(patch)
      if (Array.isArray(patch.hr_menu_shortcuts)) state.stored = [...patch.hr_menu_shortcuts]
      return jsonResponse([{ hr_menu_shortcuts: state.stored }])
    }

    if (method === 'POST' && table === 'audit_logs') {
      state.audits.push(init.body ? JSON.parse(init.body) : null)
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

function putMenus(body) {
  return app.request(
    'https://fake.local/api/profile/hr-menus',
    {
      method: 'PUT',
      headers: { Cookie: `hr_session=${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    ENV
  )
}

function readProfile() {
  return app.request(
    'https://fake.local/api/profile/me',
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

describe('PUT /api/profile/hr-menus', () => {
  it('saves one menu', async () => {
    const fake = use()
    const response = await putMenus({ menus: ['/hr/leave'] })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, menus: ['/hr/leave'] })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(fake.state.stored).toEqual(['/hr/leave'])
    expect(fake.state.audits).toHaveLength(1)
    expect(fake.state.audits[0].action).toBe('hr_menu_shortcuts_updated')
    expect(fake.state.audits[0].actor_id).toBe(HR_ID)
    expect(JSON.parse(fake.state.audits[0].detail)).toEqual({ menus: ['/hr/leave'] })
  })

  it('saves five menus', async () => {
    const fake = use()
    const menus = ['/hr/leave', '/hr/employees', '/hr/leave/holidays', '/hr/leave/backdated', '/hr/employees/import']
    const response = await putMenus({ menus })

    expect(response.status).toBe(200)
    expect((await response.json()).menus).toEqual(menus)
    expect(fake.state.stored).toHaveLength(5)
  })

  it('keeps the order the person chose', async () => {
    const fake = use()
    const menus = ['/hr/leave/settings', '/hr/employees', '/hr/leave']
    const response = await putMenus({ menus })

    expect(response.status).toBe(200)
    expect((await response.json()).menus).toEqual(menus)
    expect(fake.state.patches[0].hr_menu_shortcuts).toEqual(menus)
  })

  it('rejects an empty list and a sixth menu', async () => {
    const fake = use()

    const none = await putMenus({ menus: [] })
    expect(none.status).toBe(400)
    expect((await none.json()).message).toBe('เลือกเมนูได้ 1 ถึง 5 เมนู')

    const six = await putMenus({
      menus: [
        '/hr',
        '/hr/leave',
        '/hr/employees',
        '/hr/leave/holidays',
        '/hr/leave/backdated',
        '/hr/leave/settings',
      ],
    })
    expect(six.status).toBe(400)
    expect((await six.json()).message).toBe('เลือกเมนูได้ 1 ถึง 5 เมนู')

    expect(fake.state.patches).toHaveLength(0)
    expect(fake.state.audits).toHaveLength(0)
  })

  it('rejects a duplicate and an unknown route', async () => {
    const fake = use()

    const duplicate = await putMenus({ menus: ['/hr/leave', '/hr/leave'] })
    expect(duplicate.status).toBe(400)
    expect((await duplicate.json()).message).toBe('มีเมนูซ้ำในรายการ กรุณาเลือกใหม่')

    const unknown = await putMenus({ menus: ['/hr/leave', '/leave/approvals'] })
    expect(unknown.status).toBe(400)
    expect((await unknown.json()).message).toBe('มีเมนูที่ไม่รู้จัก กรุณาเลือกจากเมนูของฝ่ายบุคคล')

    // A route that exists but belongs to another shell is not an HR menu either.
    const wrongShell = await putMenus({ menus: ['/meeting/controller'] })
    expect(wrongShell.status).toBe(400)

    const notAList = await putMenus({ menus: '/hr/leave' })
    expect(notAList.status).toBe(400)

    expect(fake.state.patches).toHaveLength(0)
  })

  it('refuses a caller who is not HR, and writes nothing', async () => {
    const fake = use({ sessionEmployee: EMPLOYEE_ID, role: 'employee' })
    const response = await putMenus({ menus: ['/hr/leave'] })

    expect(response.status).toBe(403)
    expect((await response.json()).message).toBe('ไม่มีสิทธิ์เข้าถึงส่วนนี้')
    expect(fake.state.patches).toHaveLength(0)
    expect(fake.state.audits).toHaveLength(0)
  })
})

describe('GET /api/profile/me', () => {
  it('returns the saved shortcuts with the rest of the profile', async () => {
    use({ saved: ['/hr/leave/holidays', '/hr/employees'] })
    const response = await readProfile()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.profile.hrMenuShortcuts).toEqual(['/hr/leave/holidays', '/hr/employees'])
  })
})
