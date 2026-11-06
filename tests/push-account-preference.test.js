// The push switch is on only when the browser subscription and the server row
// agree, while automatic re-subscribe is silent and click-only enabling is the
// only place permission is requested.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  notificationSwitchIsOn,
  shouldAutoSubscribe,
} from '../src/lib/push.js'

const PUSH_LIB = readFileSync(new URL('../src/lib/push.js', import.meta.url), 'utf8')
const PUSH_TOGGLE = readFileSync(
  new URL('../src/components/PushToggle.vue', import.meta.url),
  'utf8'
)
const PROFILE_PAGE = readFileSync(
  new URL('../src/pages/ProfilePage.vue', import.meta.url),
  'utf8'
)
const LOGIN_PAGE = readFileSync(
  new URL('../src/pages/LoginPage.vue', import.meta.url),
  'utf8'
)

describe('push switch state', () => {
  it('is on only when both the browser and the server have it', () => {
    expect(notificationSwitchIsOn({ browserSubscribed: true, serverSubscribed: true })).toBe(true)
    expect(notificationSwitchIsOn({ browserSubscribed: true, serverSubscribed: false })).toBe(false)
    expect(notificationSwitchIsOn({ browserSubscribed: false, serverSubscribed: true })).toBe(false)
    expect(notificationSwitchIsOn({ browserSubscribed: false, serverSubscribed: false })).toBe(false)
  })

  it('reads the real browser subscription and the server status', () => {
    expect(PUSH_TOGGLE).toContain('browserSubscription')
    expect(PUSH_TOGGLE).toContain('fetchNotificationStatus')
    expect(PUSH_TOGGLE).toContain('browserSubscribed')
    expect(PUSH_TOGGLE).toContain('serverSubscribed')
    expect(PUSH_TOGGLE).toContain('notificationSwitchIsOn')
  })

  it('is mounted on the profile page as well as the leave page', () => {
    expect(PROFILE_PAGE).toContain("import PushToggle from '../components/PushToggle.vue'")
    expect(PROFILE_PAGE).toContain('<PushToggle')
    expect(PROFILE_PAGE).toContain('v-model:active="pushOn"')
  })
})

describe('automatic re-subscribe', () => {
  it('requires the saved opt-in, granted permission, and no subscription', () => {
    expect(
      shouldAutoSubscribe({ enabled: true, permission: 'granted', hasSubscription: false })
    ).toBe(true)
    expect(
      shouldAutoSubscribe({ enabled: false, permission: 'granted', hasSubscription: false })
    ).toBe(false)
    expect(
      shouldAutoSubscribe({ enabled: true, permission: 'default', hasSubscription: false })
    ).toBe(false)
    expect(
      shouldAutoSubscribe({ enabled: true, permission: 'denied', hasSubscription: false })
    ).toBe(false)
    expect(
      shouldAutoSubscribe({ enabled: true, permission: 'granted', hasSubscription: true })
    ).toBe(false)
  })

  it('never asks for permission from the automatic path', () => {
    const start = PUSH_LIB.indexOf('export function autoEnablePush')
    const end = PUSH_LIB.indexOf('/** Server first')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const autoBlock = PUSH_LIB.slice(start, end)

    expect(autoBlock).not.toContain('requestPermission')
    expect(autoBlock).toContain("Notification.permission !== 'granted'")
  })

  it('is triggered after a successful login and on switch mount', () => {
    expect(LOGIN_PAGE).toContain('autoEnablePush')
    expect(LOGIN_PAGE).toContain('void autoEnablePush()')
    expect(PUSH_TOGGLE).toContain('await autoEnablePush()')
  })
})

describe('click-only permission and unsubscribe', () => {
  it('requests permission only through the toggle-on click path', () => {
    const enableStart = PUSH_TOGGLE.indexOf('async function enable()')
    const enableEnd = PUSH_TOGGLE.indexOf('async function disable()')
    const enableBlock = PUSH_TOGGLE.slice(enableStart, enableEnd)

    expect(enableBlock).toContain('requestAndSubscribe')
    expect(PUSH_TOGGLE).toContain('@toggle="togglePush"')
    const toggleStart = PUSH_TOGGLE.indexOf('function togglePush()')
    const toggleEnd = PUSH_TOGGLE.indexOf('onMounted(async')
    expect(PUSH_TOGGLE.slice(toggleStart, toggleEnd)).toContain('enable()')
    expect(PUSH_LIB).toContain('export async function requestAndSubscribe')
    expect(PUSH_LIB).toContain('Notification.requestPermission()')
  })

  it('uses the server-first unsubscribe path on toggle-off', () => {
    const disableStart = PUSH_TOGGLE.indexOf('async function disable()')
    const disableEnd = PUSH_TOGGLE.indexOf('onMounted(async')
    const disableBlock = PUSH_TOGGLE.slice(disableStart, disableEnd)

    expect(disableBlock).toContain('unsubscribePush')
    expect(PUSH_TOGGLE).toContain('@toggle="togglePush"')
    const toggleStart = PUSH_TOGGLE.indexOf('function togglePush()')
    const toggleEnd = PUSH_TOGGLE.indexOf('onMounted(async')
    expect(PUSH_TOGGLE.slice(toggleStart, toggleEnd)).toContain('disable()')
  })
})
