// @vitest-environment happy-dom
// The employee login must not pass through the development placeholder. The
// Worker still returns /pending?to=…, so the client unwraps that path before
// navigating, and PendingPage renders nothing while forwarding a real page.
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ postJson: vi.fn() }))

vi.mock('../src/api.js', () => api)
vi.mock('../src/lib/logout.js', () => ({ currentPushEndpoint: async () => null }))
vi.mock('../src/lib/push.js', () => ({ autoEnablePush: vi.fn() }))

import LoginPage from '../src/pages/LoginPage.vue'
import PendingPage from '../src/pages/PendingPage.vue'
import { clearAll } from '../src/lib/data-cache.js'
import { landingPathFromRedirect } from '../src/lib/landing-path.js'

const PLACEHOLDER = 'หน้านี้กำลังพัฒนา'
const LeaveStub = { template: '<main data-leave>ใบลาของฉัน</main>' }
const Host = { template: '<RouterView />' }

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginPage },
      { path: '/pending', component: PendingPage },
      { path: '/leave', component: LeaveStub },
      { path: '/:pathMatch(.*)*', component: PendingPage, meta: { catchAll: true } },
    ],
  })
}

async function mountAt(path, router = makeRouter()) {
  await router.push(path)
  await router.isReady()
  const wrapper = mount(Host, {
    global: {
      plugins: [router],
      stubs: { LockoutDialog: true, RouterLink: true },
    },
  })
  return { router, wrapper }
}

beforeEach(() => {
  clearAll()
  api.postJson.mockReset()
})

afterEach(() => {
  clearAll()
})

describe('employee login landing', () => {
  it('unwraps /pending?to= before the router navigates', () => {
    expect(landingPathFromRedirect('/pending?to=%2Fleave')).toBe('/leave')
    expect(landingPathFromRedirect('/pending?to=%2Fleave%2Fapprovals')).toBe('/leave/approvals')
    expect(landingPathFromRedirect('https://example.com')).toBeNull()
    expect(landingPathFromRedirect('//example.com')).toBeNull()
  })

  it('lands directly on the employee page without rendering the placeholder', async () => {
    api.postJson.mockResolvedValue({
      status: 200,
      data: {
        ok: true,
        redirectTo: '/pending?to=%2Fleave',
        mustChangePin: false,
      },
    })

    const { router, wrapper } = await mountAt('/login')

    await wrapper.find('input[type="radio"][value="employee"]').setValue()
    await wrapper.find('#citizenIdInput').setValue('1234567890123')
    await wrapper.find('#pinInput').setValue('123456')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/leave')
    expect(wrapper.text()).toContain('ใบลาของฉัน')
    expect(wrapper.text()).not.toContain(PLACEHOLDER)

    wrapper.unmount()
  })
})

describe('direct /pending visits', () => {
  it('forwards a valid destination without ever rendering the placeholder text', async () => {
    const { router, wrapper } = await mountAt('/pending?to=%2Fleave')

    // The first render is already empty: forwarding is decided during setup.
    expect(wrapper.text()).not.toContain(PLACEHOLDER)

    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/leave')
    expect(wrapper.text()).toContain('ใบลาของฉัน')
    expect(wrapper.text()).not.toContain(PLACEHOLDER)

    wrapper.unmount()
  })

  it('keeps the placeholder for an invalid destination', async () => {
    const { router, wrapper } = await mountAt('/pending?to=%2Fnot-a-page')

    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/pending?to=%2Fnot-a-page')
    expect(wrapper.text()).toContain(PLACEHOLDER)
    expect(wrapper.text()).toContain('ปลายทางของคุณ: /not-a-page')

    wrapper.unmount()
  })
})
