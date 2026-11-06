// The new-device banner after login: it decides silently, prompts only from its
// own button, remembers a dismissal for the session only, and never asks for
// permission while rendering.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { notificationBannerState } from '../src/lib/push.js'

const BANNER = readFileSync(
  new URL('../src/components/NotificationBanner.vue', import.meta.url),
  'utf8'
)
const APP_LAYOUT = readFileSync(
  new URL('../src/components/AppLayout.vue', import.meta.url),
  'utf8'
)
const CONTROLLER_LAYOUT = readFileSync(
  new URL('../src/components/ControllerLayout.vue', import.meta.url),
  'utf8'
)
const LOGIN_PAGE = readFileSync(
  new URL('../src/pages/LoginPage.vue', import.meta.url),
  'utf8'
)

function collapse(value) {
  return value.replace(/\s+/g, ' ').trim()
}

describe('banner state', () => {
  it('does nothing when the account setting is off or this browser already subscribed', () => {
    expect(
      notificationBannerState({ enabled: false, permission: 'default', hasSubscription: false })
    ).toBe('none')
    expect(
      notificationBannerState({ enabled: true, permission: 'default', hasSubscription: true })
    ).toBe('none')
  })

  it('resumes silently only with granted permission and no subscription', () => {
    expect(
      notificationBannerState({ enabled: true, permission: 'granted', hasSubscription: false })
    ).toBe('auto')
  })

  it('prompts only in the default state and reports a denied browser', () => {
    expect(
      notificationBannerState({ enabled: true, permission: 'default', hasSubscription: false })
    ).toBe('prompt')
    expect(
      notificationBannerState({ enabled: true, permission: 'denied', hasSubscription: false })
    ).toBe('denied')
  })
})

describe('banner component', () => {
  it('asks the helper and never requests permission while rendering', () => {
    expect(BANNER).toContain('notificationBannerState')
    expect(BANNER).toContain('await autoEnablePush()')
    expect(BANNER).not.toContain('requestPermission')

    const detectStart = BANNER.indexOf('async function detect()')
    const detectEnd = BANNER.indexOf('async function enable()')
    const detectBlock = BANNER.slice(detectStart, detectEnd)
    expect(detectBlock).not.toContain('requestAndSubscribe')
    expect(detectBlock).toContain('Notification.permission')
  })

  it('shows the exact prompt and enables only from that button', () => {
    expect(collapse(BANNER)).toContain(
      'บัญชีนี้เปิดการแจ้งเตือนใบลาไว้ เปิดบนเครื่องนี้ด้วยหรือไม่'
    )
    expect(collapse(BANNER)).toContain("'เปิดการแจ้งเตือน' }}")

    const enableStart = BANNER.indexOf('async function enable()')
    const enableEnd = BANNER.indexOf('function dismiss()')
    expect(BANNER.slice(enableStart, enableEnd)).toContain('requestAndSubscribe')
    expect(BANNER).toContain('@click="enable"')
  })

  it('explains a blocked browser without a permission button', () => {
    const deniedStart = BANNER.indexOf('<template v-else>')
    const deniedBlock = BANNER.slice(deniedStart)

    expect(collapse(deniedBlock)).toContain('เบราว์เซอร์นี้ปิดการแจ้งเตือนไว้')
    expect(collapse(deniedBlock)).toContain('การตั้งค่าเบราว์เซอร์')
    expect(deniedBlock).not.toContain('@click="enable"')
  })

  it('remembers a dismissal in sessionStorage only', () => {
    expect(BANNER).toContain('sessionStorage.getItem(DISMISS_KEY)')
    expect(BANNER).toContain('sessionStorage.setItem(DISMISS_KEY')
    expect(BANNER).toContain('hr-notification-banner-dismissed')
    expect(BANNER).not.toContain('localStorage')

    const dismissStart = BANNER.indexOf('function dismiss()')
    const dismissEnd = BANNER.indexOf('onMounted(detect)')
    const dismissBlock = BANNER.slice(dismissStart, dismissEnd)
    expect(dismissBlock).toContain('rememberDismissal()')
    expect(dismissBlock).toContain("state.value = 'none'")
    expect(dismissBlock).not.toContain('requestAndSubscribe')
  })

  it('is mounted on the role home page of both shells', () => {
    expect(APP_LAYOUT).toContain('NotificationBanner')
    expect(APP_LAYOUT).toContain('homePathByRole')
    expect(APP_LAYOUT).toContain('<NotificationBanner v-if="isHome" />')
    expect(CONTROLLER_LAYOUT).toContain('<NotificationBanner v-if="isHome" />')
    expect(CONTROLLER_LAYOUT).toContain('homePathByRole.meeting_controller')
  })
})

describe('login is not blocked', () => {
  it('fires the silent resume without awaiting it after navigation', () => {
    expect(LOGIN_PAGE).toContain('await router.replace(destination)')
    expect(LOGIN_PAGE).toContain('void autoEnablePush()')
    expect(LOGIN_PAGE).not.toContain('await autoEnablePush')
  })
})
