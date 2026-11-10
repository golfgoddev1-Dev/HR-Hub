// Delivery checks for the /hr performance work: pages are their own chunks while
// the shell stays in the entry, no component imports a font from a CDN, the head
// carries the description and the noindex rule, robots.txt refuses every path,
// and source maps are not published.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROUTER = readFileSync(new URL('../src/router.js', import.meta.url), 'utf8')
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const ROBOTS = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8')
const VITE = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8')
const PAGE_LOADING = readFileSync(
  new URL('../src/components/PageLoading.vue', import.meta.url),
  'utf8'
)
const SRC = fileURLToPath(new URL('../src', import.meta.url))

function vueFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return vueFiles(full)
    return entry.endsWith('.vue') ? [full] : []
  })
}

const LAZY_PAGES = [
  ...ROUTER.matchAll(/component: page\(\(\) => import\('\.\/pages\/([^']+)\.vue'\)\)/g),
].map((match) => match[1])

describe('route-level splitting', () => {
  it('keeps the shell static and every routed page in its own chunk', () => {
    expect(ROUTER).toContain("import RoleShell from './components/RoleShell.vue'")
    expect(ROUTER).toContain("import PageLoading from './components/PageLoading.vue'")
    expect(ROUTER).toContain('defineAsyncComponent')

    // No page is pulled into the entry bundle.
    expect(ROUTER).not.toMatch(/import \w*Page from '\.\/pages\//)
    expect(ROUTER).not.toMatch(/^import .* from '\.\/pages\//m)

    // PendingPage is both /pending and the catch-all, so count distinct files.
    expect(new Set(LAZY_PAGES).size).toBeGreaterThanOrEqual(30)
    expect(LAZY_PAGES.length).toBeGreaterThanOrEqual(30)
    for (const name of [
      'LoginPage',
      'HrHomePage',
      'LeaveHomePage',
      'LeaveCalendarPage',
      'MeetingBackfillImportPage',
      'ControllerOverviewPage',
      'AdminPage',
      'HrLeavePrintPage',
      'PendingPage',
    ]) {
      expect(LAZY_PAGES, name).toContain(name)
    }
  })

  it('renders a content-area placeholder while a chunk loads, never a blank shell', () => {
    expect(ROUTER).toContain('loadingComponent: PageLoading')
    expect(ROUTER).toContain('delay: 0')
    expect(PAGE_LOADING).toContain('role="status"')
    expect(PAGE_LOADING).toContain('กำลังโหลด')
    // The shell components never become part of a lazy chunk.
    expect(ROUTER).not.toMatch(
      /import\('\.\/components\/(RoleShell|AppLayout|ControllerShell|AppDock|AdminNav|ControllerNav|NotificationBanner)/
    )
  })

  it('leaves the session and role guards exactly as they were', () => {
    expect(ROUTER).toContain('const session = await getSession()')
    expect(ROUTER).toContain('canOpenPath(session.role, to.path, session)')
    expect(ROUTER).toContain("meta: { requiresAuth: true, role: 'system_admin' }")
    expect(ROUTER).toContain("if (to.path === '/change-pin') {")
    expect(ROUTER).toContain("session.role === 'system_admin' || session.mustChangePin === true")
  })
})

describe('fonts', () => {
  it('has no per-component Google Fonts import left', () => {
    const offenders = vueFiles(SRC).filter((file) =>
      readFileSync(file, 'utf8').includes('fonts.googleapis.com')
    )

    expect(offenders).toEqual([])
  })

  it('loads the icon font once from index.html', () => {
    const fontLinks = [
      ...INDEX.matchAll(/<link\b[^>]*fonts\.googleapis\.com\/css2[^>]*>/g),
    ].map((match) => match[0])

    expect(fontLinks).toHaveLength(1)
    expect(fontLinks[0]).toContain('Material+Symbols+Outlined:wght,FILL@100..700,0..1')
    expect(fontLinks[0]).toContain('display=swap')
    // The same families the component styles ask for.
    for (const family of ['Prompt', 'Sarabun', 'IBM+Plex+Sans']) {
      expect(fontLinks[0], family).toContain(family)
    }
    expect(INDEX).toContain('<link rel="preconnect" href="https://fonts.googleapis.com" />')
    expect(INDEX).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />')
  })
})

describe('SEO and robots', () => {
  it('describes the system and refuses indexing', () => {
    expect(INDEX).toContain(
      '<meta name="description" content="ระบบบริการงานบุคคลและสวัสดิการพนักงาน" />'
    )
    expect(INDEX).toContain('<meta name="robots" content="noindex, nofollow" />')
  })

  it('ships a robots.txt that disallows every path', () => {
    expect(ROBOTS).toContain('User-agent: *')
    expect(ROBOTS).toContain('Disallow: /')
    expect(ROBOTS).not.toContain('Allow:')
  })
})

describe('source maps', () => {
  it('does not publish source maps', () => {
    expect(VITE).not.toMatch(/sourcemap:\s*(true|'inline'|"inline")/)
    expect(VITE).not.toContain('build: {')
  })
})
