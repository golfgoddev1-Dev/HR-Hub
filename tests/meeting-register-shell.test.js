// @vitest-environment happy-dom
// The public QR registration page is the one shell route that must render
// without navigation for an anonymous visitor. A signed-in employee keeps the
// same dock every other employee page uses.
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const H = vi.hoisted(() => ({ session: null }))

vi.mock('../src/api.js', () => ({
  getSession: async () => H.session,
  verifySession: async () => H.session,
  postLogout: vi.fn(),
  putJson: vi.fn(),
  postJson: vi.fn(),
}))

import RoleShell from '../src/components/RoleShell.vue'
import { clearAll } from '../src/lib/data-cache.js'
import { router as appRouter } from '../src/router.js'

const REGISTER = appRouter.getRoutes().find((record) => record.path === '/meeting/register')
const REGISTER_META = REGISTER?.meta ?? {}
const Host = { template: '<RouterView />' }
const RegisterStub = {
  name: 'RegisterPageStub',
  template: '<main data-register-content><h1>ลงทะเบียนเข้าประชุม</h1></main>',
}

async function openRegister() {
  // Use the real route meta with a small memory router, so the test exercises
  // RoleShell without waiting for the production page's lazy chunk.
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: RoleShell,
        children: [
          {
            path: '/meeting/register',
            component: RegisterStub,
            meta: REGISTER_META,
          },
          // AppDock's real RouterLinks resolve against these in the test.
          ...['/leave', '/leave/new', '/leave/calendar', '/profile', '/change-pin'].map(
            (path) => ({ path, component: RegisterStub })
          ),
        ],
      },
    ],
  })

  await router.push('/meeting/register?t=test-token')
  await router.isReady()

  const wrapper = mount(Host, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

const CHROME_LABELS = [
  'ระบบใบลา',
  'ใบลาของฉัน',
  'ยื่นใบลา',
  'ข้อมูลส่วนตัว',
  'ออกจากระบบ',
  'เมนูหลัก',
]

beforeEach(() => {
  H.session = null
  clearAll()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('/meeting/register shell', () => {
  it('is marked for the anonymous clean shell without becoming protected', () => {
    expect(REGISTER_META.cleanShellWhenAnonymous).toBe(true)
    expect(REGISTER_META.requiresAuth).toBeUndefined()
  })

  it('renders no app chrome for an anonymous visitor', async () => {
    const { wrapper } = await openRegister()

    expect(wrapper.find('[data-register-content]').exists()).toBe(true)
    expect(wrapper.find('[data-dock]').exists()).toBe(false)
    expect(wrapper.find('.dock-tabs').exists()).toBe(false)

    for (const label of CHROME_LABELS) {
      expect(wrapper.text(), label).not.toContain(label)
    }
    expect(wrapper.html()).not.toContain('href="/leave"')

    wrapper.unmount()
  })

  it('keeps the normal employee dock for a signed-in employee', async () => {
    H.session = { role: 'employee', isApprover: false }
    const { wrapper } = await openRegister()

    expect(wrapper.find('[data-register-content]').exists()).toBe(true)
    expect(wrapper.find('[data-dock]').exists()).toBe(true)

    for (const label of [
      'ระบบใบลา',
      'ใบลาของฉัน',
      'ยื่นใบลา',
      'ข้อมูลส่วนตัว',
      'ออกจากระบบ',
    ]) {
      expect(wrapper.text(), label).toContain(label)
    }

    wrapper.unmount()
  })
})
