// Source checks for the merged notification card: one heading, one shared
// switch style, an approver-only signed-out row gated by the main push state,
// and permission still requested only from the main switch click path.
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

describe('merged notification card', () => {
  it('has exactly one card heading named การแจ้งเตือน', () => {
    const headings = PROFILE_PAGE.match(/<h2[^>]*>\s*การแจ้งเตือน\s*<\/h2>/g) ?? []
    expect(headings).toHaveLength(1)
  })

  it('uses one shared switch component for both rows', () => {
    expect(PUSH_TOGGLE).toContain('<NotificationSwitch')
    expect(PROFILE_PAGE).toContain('<NotificationSwitch')
    expect(SWITCH).toContain('role="switch"')
    expect(SWITCH).toContain("checked ? 'เปิดอยู่' : 'ปิดอยู่'")
  })

  it('keeps the exact main and approver descriptions', () => {
    expect(collapse(PUSH_TOGGLE)).toContain(
      'เปิดเพื่อรับแจ้งเตือนเมื่อมีใบลารออนุมัติ หรือเมื่อใบลาของคุณได้รับการพิจารณา (ไม่ส่งรายละเอียดการลาหรือเหตุผล)'
    )
    expect(collapse(PROFILE_PAGE)).toContain(
      'ใช้สำหรับผู้อนุมัติเท่านั้น: ระบบจะส่งเฉพาะจำนวนรายการที่รอคุณอนุมัติ โดยไม่มีชื่อ ประเภทการลา วันที่ หรือเหตุผล'
    )
  })

  it('wraps the signed-out row in an approver-only condition', () => {
    const gate = PROFILE_PAGE.indexOf('v-if="isApprover"')
    const label = PROFILE_PAGE.indexOf('รับแจ้งเตือนรายการรออนุมัติแม้ออกจากระบบ')
    const switchTag = PROFILE_PAGE.indexOf('<NotificationSwitch', label)
    const toggle = PROFILE_PAGE.indexOf('@toggle="toggleNotifyPending"', switchTag)

    expect(gate).toBeGreaterThan(-1)
    expect(label).toBeGreaterThan(gate)
    expect(switchTag).toBeGreaterThan(label)
    expect(toggle).toBeGreaterThan(switchTag)
    expect(PROFILE_PAGE).toContain('getSession')
    expect(PROFILE_PAGE).toContain('session?.isApprover === true')
  })

  it('disables the signed-out row from the main switch state', () => {
    const start = PROFILE_PAGE.indexOf('const notifyDisabled = computed')
    const end = PROFILE_PAGE.indexOf('\n\n', start)
    const block = PROFILE_PAGE.slice(start, end)

    expect(block).toContain('!pushOn.value')
    expect(PROFILE_PAGE).toContain(':disabled="notifyDisabled"')
    expect(PROFILE_PAGE).toContain('v-if="!pushOn"')
    expect(PROFILE_PAGE).toContain('เปิดแจ้งเตือนใบลาก่อน')
  })

  it('no longer renders a เปิด/ปิด text button', () => {
    expect(PROFILE_PAGE).not.toMatch(/\?\s*'เปิด'\s*:\s*'ปิด'/)
    expect(PROFILE_PAGE).not.toContain('>เปิด<')
    expect(PUSH_TOGGLE).not.toContain("'เปิดการแจ้งเตือน'")
    expect(PUSH_TOGGLE).not.toContain("'ยกเลิกการแจ้งเตือน'")
  })
})

describe('main switch wiring', () => {
  it('calls the existing subscribe and unsubscribe functions', () => {
    const toggleStart = PUSH_TOGGLE.indexOf('function togglePush()')
    const toggleEnd = PUSH_TOGGLE.indexOf('onMounted(async')
    const toggleBlock = PUSH_TOGGLE.slice(toggleStart, toggleEnd)

    const enableStart = PUSH_TOGGLE.indexOf('async function enable()')
    const enableEnd = PUSH_TOGGLE.indexOf('async function disable()')
    const enableBlock = PUSH_TOGGLE.slice(enableStart, enableEnd)

    const disableStart = PUSH_TOGGLE.indexOf('async function disable()')
    const disableEnd = PUSH_TOGGLE.indexOf('function togglePush()')
    const disableBlock = PUSH_TOGGLE.slice(disableStart, disableEnd)

    expect(PUSH_TOGGLE).toContain('@toggle="togglePush"')
    expect(toggleBlock).toContain('enable()')
    expect(toggleBlock).toContain('disable()')
    expect(enableBlock).toContain('requestAndSubscribe')
    expect(disableBlock).toContain('unsubscribePush')
  })

  it('requests permission only from the switch click path', () => {
    const autoStart = PUSH_LIB.indexOf('export function autoEnablePush')
    const autoEnd = PUSH_LIB.indexOf('/** Server first')
    const autoBlock = PUSH_LIB.slice(autoStart, autoEnd)

    const requestStart = PUSH_LIB.indexOf('export async function requestAndSubscribe')
    const requestEnd = PUSH_LIB.indexOf('\nexport async function', requestStart + 1)
    const requestBlock = PUSH_LIB.slice(requestStart, requestEnd)

    expect(autoBlock).not.toContain('requestPermission')
    expect((PUSH_LIB.match(/Notification\.requestPermission/g) ?? []).length).toBe(1)
    expect(requestBlock).toContain('Notification.requestPermission()')
    expect(SWITCH).toContain('@click="$emit(\'toggle\')"')
    expect(PUSH_TOGGLE).toContain('@toggle="togglePush"')
  })
})
