// Source checks for the single account-level leave-notification card: one
// heading, one switch, the exact copy, an approver-only line, and permission
// still requested only from a click path.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const PROFILE_PAGE = readFileSync(
  new URL('../src/pages/ProfilePage.vue', import.meta.url),
  'utf8'
)
const PUSH_TOGGLE = readFileSync(
  new URL('../src/components/PushToggle.vue', import.meta.url),
  'utf8'
)
const PUSH_LIB = readFileSync(new URL('../src/lib/push.js', import.meta.url), 'utf8')
const SWITCH = readFileSync(
  new URL('../src/components/NotificationSwitch.vue', import.meta.url),
  'utf8'
)

function collapse(value) {
  return value.replace(/\s+/g, ' ').trim()
}

describe('one notification card', () => {
  it('renders one PushToggle card and no second switch on the profile page', () => {
    expect(PROFILE_PAGE.match(/<PushToggle/g) ?? []).toHaveLength(1)
    expect(PROFILE_PAGE).not.toContain('<NotificationSwitch')
    expect(PROFILE_PAGE).not.toContain('notify_pending_on_logout')
    expect(PROFILE_PAGE).not.toContain('toggleNotifyPending')
    expect(PROFILE_PAGE).not.toContain('notifyPendingOnLogout')
  })

  it('has exactly one heading named การแจ้งเตือนใบลา and one shared switch', () => {
    expect(PUSH_TOGGLE.match(/การแจ้งเตือนใบลา<\/h2>/g) ?? []).toHaveLength(1)
    expect(PUSH_TOGGLE).not.toContain('<h3')
    expect(PUSH_TOGGLE.match(/<NotificationSwitch/g) ?? []).toHaveLength(1)
    expect(SWITCH).toContain('role="switch"')
    expect(SWITCH).toContain("checked ? 'เปิดอยู่' : 'ปิดอยู่'")
  })

  it('keeps the exact main and approver descriptions', () => {
    expect(collapse(PUSH_TOGGLE)).toContain(
      'เปิดเพื่อรับแจ้งเตือนเมื่อมีใบลารออนุมัติ หรือเมื่อใบลาของคุณได้รับการพิจารณา ไม่ส่งรายละเอียดการลาหรือเหตุผล'
    )
    expect(collapse(PUSH_TOGGLE)).toContain('v-if="approver" class="push-text"')
    expect(collapse(PUSH_TOGGLE)).toContain(
      'หากคุณเป็นผู้อนุมัติ ระบบจะส่งเฉพาะจำนวนรายการรออนุมัติแม้ออกจากระบบแล้ว โดยไม่มีชื่อหรือรายละเอียด'
    )
  })

  it('takes the approver flag from the session, not from a second row', () => {
    expect(PROFILE_PAGE).toContain('<PushToggle v-if="!loading && !loadError" :approver="isApprover" />')
    expect(PROFILE_PAGE).toContain('getSession')
    expect(PROFILE_PAGE).toContain('session?.isApprover === true')
    expect(PUSH_TOGGLE).toContain('approver: { type: Boolean, default: false }')
  })

  it('no longer renders a เปิด/ปิด text button', () => {
    expect(PROFILE_PAGE).not.toMatch(/\?\s*'เปิด'\s*:\s*'ปิด'/)
    expect(PROFILE_PAGE).not.toContain('>เปิด<')
    expect(PUSH_TOGGLE).not.toContain("'เปิดการแจ้งเตือน'")
    expect(PUSH_TOGGLE).not.toContain("'ยกเลิกการแจ้งเตือน'")
  })
})

describe('switch wiring', () => {
  it('flips optimistically and reads the account value from the helper', () => {
    expect(PUSH_TOGGLE).toContain('createNotificationToggle')
    expect(PUSH_TOGGLE).toContain('toggle.request(next)')
    expect(PUSH_TOGGLE).toContain('subscribed.value = value')
    // The pure rule is still the description of a settled switch.
    expect(PUSH_LIB).toContain('return Boolean(browserSubscribed && serverSubscribed)')
  })

  it('subscribes on click and unsubscribes on click', () => {
    const start = PUSH_TOGGLE.indexOf('async function syncNotificationState(desired)')
    const end = PUSH_TOGGLE.indexOf('onMounted(async')
    const block = PUSH_TOGGLE.slice(start, end)

    expect(PUSH_TOGGLE).toContain('@toggle="togglePush"')
    expect(PUSH_TOGGLE.indexOf('toggle.request(next)')).toBeLessThan(
      PUSH_TOGGLE.indexOf('permissionTask = requestPermissionNow()')
    )
    expect(block).toContain('requestAndSubscribe')
    expect(block).toContain('unsubscribePush')
    expect(SWITCH).toContain('@click="$emit(\'toggle\')"')
  })

  it('requests permission only from requestAndSubscribe on a click', () => {
    const autoStart = PUSH_LIB.indexOf('export function autoEnablePush')
    const autoEnd = PUSH_LIB.indexOf('/** Server first')
    const autoBlock = PUSH_LIB.slice(autoStart, autoEnd)

    const requestStart = PUSH_LIB.indexOf('export async function requestAndSubscribe')
    const requestEnd = PUSH_LIB.indexOf('\nexport async function', requestStart + 1)
    const requestBlock = PUSH_LIB.slice(requestStart, requestEnd)

    expect(autoBlock).not.toContain('requestPermission')
    expect((PUSH_LIB.match(/Notification\.requestPermission/g) ?? []).length).toBe(1)
    expect(requestBlock).toContain('Notification.requestPermission()')
  })
})
