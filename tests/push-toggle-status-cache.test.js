// @vitest-environment happy-dom
// The switch must keep what the user just turned on: the shared status read is
// cached for a minute, so a successful change has to update that cache or the
// next visit repaints the old value and shows the "updated" notice.

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/push.js', () => ({
  autoEnablePush: vi.fn(async () => ({ ok: false, reason: 'skipped' })),
  fetchNotificationStatus: vi.fn(async () => ({ enabled: false, subscribed: false })),
  iosNeedsInstall: () => false,
  pushSupported: () => true,
  requestAndSubscribe: vi.fn(async () => ({ ok: true })),
  unsubscribePush: vi.fn(async () => ({ ok: true })),
}))

import PushToggle from '../src/components/PushToggle.vue'
import { clearAll, peekCached, refreshCached } from '../src/lib/data-cache.js'
import { NOTIFICATION_TOGGLE_MESSAGES } from '../src/lib/notification-toggle.js'
import { DATA_KEYS } from '../src/lib/shared-data.js'

const SWITCH = 'button[role="switch"]'

async function settle() {
  await vi.advanceTimersByTimeAsync(500)
  await flushPromises()
}

describe('PushToggle status cache', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: async () => 'granted' })
    clearAll()
    // What the app shell leaves behind at sign-in: profile plus a "disabled" status.
    await refreshCached(DATA_KEYS.profile, () => ({ profile: { id: 'emp-1' } }))
    await refreshCached(DATA_KEYS.notificationStatus, () => ({ enabled: false, subscribed: false }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    clearAll()
  })

  it('stays on after a successful turn-on when the page is opened again', async () => {
    const first = mount(PushToggle)
    await flushPromises()
    await first.get(SWITCH).trigger('click')
    await settle()
    expect(first.get(SWITCH).attributes('aria-checked')).toBe('true')
    first.unmount()

    const second = mount(PushToggle)
    await settle()
    expect(second.get(SWITCH).attributes('aria-checked')).toBe('true')
    expect(second.text()).not.toContain(NOTIFICATION_TOGGLE_MESSAGES.updated)
    second.unmount()
  })

  it('stays off after a successful turn-off when the page is opened again', async () => {
    await refreshCached(DATA_KEYS.notificationStatus, () => ({ enabled: true, subscribed: true }))

    const first = mount(PushToggle)
    await settle()
    expect(first.get(SWITCH).attributes('aria-checked')).toBe('true')
    await first.get(SWITCH).trigger('click')
    await settle()
    expect(first.get(SWITCH).attributes('aria-checked')).toBe('false')
    first.unmount()

    const second = mount(PushToggle)
    await settle()
    expect(second.get(SWITCH).attributes('aria-checked')).toBe('false')
    second.unmount()
  })

  it('records the confirmed value in the shared status read', async () => {
    const wrapper = mount(PushToggle)
    await flushPromises()
    await wrapper.get(SWITCH).trigger('click')
    await settle()
    expect(peekCached(DATA_KEYS.notificationStatus).value.enabled).toBe(true)
    wrapper.unmount()
  })
})
