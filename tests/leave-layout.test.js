// Every page that shows the leave menu must put that menu inside the shared
// outer layout. Otherwise the page brings its own padding and the bar lands at a
// different x/y, which is exactly the jump this guards against.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const LAYOUT = join(SRC, 'components', 'LeaveLayout.vue')
const APP_LAYOUT = join(SRC, 'components', 'AppLayout.vue')
const LAYOUT_SOURCE = readFileSync(LAYOUT, 'utf8')

/** Pages that show the leave menu, whichever shared layout they name. */
const MENU_PAGES = [
  'ChangePinPage.vue',
  'LeaveApprovalsPage.vue',
  'LeaveCalendarPage.vue',
  'LeaveHomePage.vue',
  'LeaveRequestPage.vue',
  'ProfilePage.vue',
]

/** Pages that still name LeaveLayout; LeaveCalendarPage picks its menu instead. */
const LEAVE_LAYOUT_PAGES = [
  'ChangePinPage.vue',
  'LeaveApprovalsPage.vue',
  'LeaveHomePage.vue',
  'LeaveRequestPage.vue',
  'ProfilePage.vue',
]

function vueFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return vueFiles(full)
    return entry.endsWith('.vue') ? [full] : []
  })
}

const ALL_VUE = vueFiles(SRC)
const PAGES = ALL_VUE.filter((file) => file.startsWith(join(SRC, 'pages')))
const source = (file) => readFileSync(file, 'utf8')
const pageName = (file) => relative(join(SRC, 'pages'), file).split('\\').join('/')

/** Anything outside the two layouts that still pulls the menu in on its own. */
const DIRECT_NAV = ALL_VUE.filter(
  (file) => file !== LAYOUT && file !== APP_LAYOUT && /<LeaveNav|import LeaveNav\b/.test(source(file))
)

describe('shared leave layout', () => {
  it('delegates positioning to the shared app layout', () => {
    expect(LAYOUT_SOURCE).toContain('<AppLayout nav="leave">')
    expect(LAYOUT_SOURCE).toContain('<slot />')
    expect(LAYOUT_SOURCE).not.toContain('<LeaveNav')
  })

  it('leaves the leave menu import to AppLayout alone', () => {
    const offenders = DIRECT_NAV.map((file) => relative(SRC, file).split('\\').join('/'))
    expect(offenders).toEqual([])
  })

  it('is used by every page that shows the leave menu', () => {
    const using = PAGES.filter((file) => /<LeaveLayout/.test(source(file))).map(pageName).sort()
    expect(using).toEqual(LEAVE_LAYOUT_PAGES.sort())

    for (const name of MENU_PAGES) {
      expect(/<LeaveLayout|<AppLayout/.test(source(join(SRC, 'pages', name))), name).toBe(true)
    }
  })
})
