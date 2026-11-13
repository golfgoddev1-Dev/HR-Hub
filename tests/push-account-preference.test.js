// The push switch is on only when the browser subscription and the server row
// agree, while automatic re-subscribe is silent and click-only enabling is the
// only place permission is requested.

import { describe, expect, it } from 'vitest'

import {
  notificationSwitchIsOn,
  shouldAutoSubscribe,
} from '../src/lib/push.js'

import { readSource } from './helpers/read-source.js'

const PUSH_LIB = readSource(new URL('../src/lib/push.js', import.meta.url))
const PUSH_TOGGLE = readSource(
  new URL('../src/components/PushToggle.vue', import.meta.url)
)
const PROFILE_PAGE = readSource(
  new URL('../src/pages/ProfilePage.vue', import.meta.url)
)
const LOGIN_PAGE = readSource(
  new URL('../src/pages/LoginPage.vue', import.meta.url)
)

describe('push switch state', () => {
  it('is on only when both the browser and the server have it', () => {
    expect(notificationSwitchIsOn({ browserSubscribed: true, serverSubscribed: true })).toBe(true)
    expect(notificationSwitchIsOn({ browserSubscribed: true, serverSubscribed: false })).toBe(false)
    expect(notificationSwitchIsOn({ browserSubscribed: false, serverSubscribed: true })).toBe(false)
    expect(notificationSwitchIsOn({ browserSubscribed: false, serverSubscribed: false })).toBe(false)
  })

  it('reads the account value from the toggle helper and confirms it with the server', () => {
    expect(PUSH_TOGGLE).toContain('createNotificationToggle')
    expect(PUSH_TOGGLE).toContain('readNotificationState')
    expect(PUSH_TOGGLE).toContain('writeNotificationState')
    expect(PUSH_TOGGLE).toContain('loaders.notificationStatus')
  })

  it('is mounted on the profile page as well as the leave page', () => {
    expect(PROFILE_PAGE).toContain("import PushToggle from '../components/PushToggle.vue'")
    expect(PROFILE_PAGE).toContain('<PushToggle')
    expect(PROFILE_PAGE).toContain(':approver="isApprover"')
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
    // The mount fires it in the background too: nothing waits for the subscribe.
    expect(PUSH_TOGGLE).toContain('void autoEnablePush()')
  })
})

describe('click-only permission and unsubscribe', () => {
  it('requests permission only through the toggle-on tap path', () => {
    const start = PUSH_TOGGLE.indexOf('function togglePush()')
    const end = PUSH_TOGGLE.indexOf('onMounted(async')
    const block = PUSH_TOGGLE.slice(start, end)

    expect(block).toContain('toggle.request(next)')
    expect(block).toContain('permissionTask = requestPermissionNow()')
    expect(block.indexOf('toggle.request(next)')).toBeLessThan(
      block.indexOf('requestPermissionNow()')
    )
    expect(PUSH_TOGGLE).toContain('@toggle="togglePush"')
    expect(PUSH_LIB).toContain('export async function requestAndSubscribe')
    expect(PUSH_LIB).toContain('Notification.requestPermission()')
  })

  it('uses the server-first unsubscribe path on toggle-off', () => {
    const start = PUSH_TOGGLE.indexOf('async function syncNotificationState(desired)')
    const end = PUSH_TOGGLE.indexOf('onMounted(async')
    const block = PUSH_TOGGLE.slice(start, end)

    expect(block).toContain('unsubscribePush')
    expect(block).toContain('requestAndSubscribe')
    expect(PUSH_TOGGLE).toContain('@toggle="togglePush"')
  })
})
