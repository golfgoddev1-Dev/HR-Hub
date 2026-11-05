// Every page that shows the leave menu must put LeaveNav inside the shared
// LeaveLayout. Otherwise the page brings its own padding and the bar lands at a
// different x/y, which is exactly the jump this guards against.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const LAYOUT = join(SRC, 'components', 'LeaveLayout.vue')
const LAYOUT_SOURCE = readFileSync(LAYOUT, 'utf8')

const MENU_PAGES = [
  'ChangePinPage.vue',
  'LeaveApprovalsPage.vue',
  'LeaveCalendarPage.vue',
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
const source = (file) => readFileSync(file, 'utf8')

/** Pages that show the leave menu at all, via the shared layout. */
const USING_LAYOUT = ALL_VUE.filter((file) => source(file).includes('<LeaveLayout'))

/** Anything outside LeaveLayout that still pulls the nav in on its own. */
const DIRECT_NAV = ALL_VUE.filter(
  (file) => file !== LAYOUT && /<LeaveNav|import LeaveNav\b/.test(source(file))
)

describe('shared leave layout', () => {
  it('positions the nav once: 1120px wide, centred, one padding', () => {
    expect(LAYOUT_SOURCE).toContain('<LeaveNav />')
    expect(LAYOUT_SOURCE).toContain('<slot />')
    expect(LAYOUT_SOURCE).toContain('max-width: 1120px')
    expect(LAYOUT_SOURCE).toContain('margin: 0 auto')
    expect(LAYOUT_SOURCE).toContain('padding: 16px 20px 0')
  })

  it('is the only place that imports LeaveNav', () => {
    const offenders = DIRECT_NAV.map((file) => relative(SRC, file).split('\\').join('/'))
    expect(offenders).toEqual([])
  })

  it('is used by every page that shows the leave menu', () => {
    const names = USING_LAYOUT.map((file) => relative(join(SRC, 'pages'), file).split('\\').join('/'))
    expect(names.sort()).toEqual(MENU_PAGES.sort())
  })
})
