// @vitest-environment happy-dom
// The 3D background is the signed-in shell's backdrop. A visitor without a
// session must never reach it: the public routes have no shell, and the one
// public route that lives under RoleShell (the anonymous meeting registration)
// renders the bare RouterView instead of AppLayout.
//
// Every assertion reads project source through tests/helpers/read-source.js, so
// a CRLF checkout cannot change the result. No routing, shell or layout file is
// touched by this test.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { readSource } from './helpers/read-source.js'

const ROUTER = readSource('src/router.js')
const SHELL = readSource('src/components/RoleShell.vue')
const LAYOUT = readSource('src/components/AppLayout.vue')
const BACKGROUND = readSource('src/components/AppBackground3D.vue')

const PUBLIC_PAGES = [
  { path: '/login', page: 'src/pages/LoginPage.vue', routerImport: './pages/LoginPage.vue' },
  { path: '/pending', page: 'src/pages/PendingPage.vue', routerImport: './pages/PendingPage.vue' },
  { path: '/set-pin', page: 'src/pages/SetPinPage.vue', routerImport: './pages/SetPinPage.vue' },
  {
    path: '/approve/:token',
    page: 'src/pages/ApproveLinkPage.vue',
    routerImport: './pages/ApproveLinkPage.vue',
  },
  {
    path: '/meeting/register',
    page: 'src/pages/RegisterPage.vue',
    routerImport: './pages/RegisterPage.vue',
  },
]

// The four that sit at the top level, outside every shell.
const TOP_LEVEL = PUBLIC_PAGES.slice(0, 4)

/** Every .vue/.js file under src, with forward slashes on every platform. */
function sourceFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(full))
    else if (/\.(vue|js)$/.test(entry.name)) files.push(full.replace(/\\/g, '/'))
  }
  return files
}

/** The `children: [...]` block of the RouteShell route in src/router.js. */
function shellChildren() {
  const shell = ROUTER.indexOf('component: RoleShell')
  const open = ROUTER.indexOf('children: [', shell)
  if (shell === -1 || open === -1) return ''
  let depth = 0
  for (let index = open; index < ROUTER.length; index += 1) {
    if (ROUTER[index] === '[') depth += 1
    if (ROUTER[index] === ']') {
      depth -= 1
      if (depth === 0) return ROUTER.slice(open, index + 1)
    }
  }
  return ''
}

const CHILDREN = shellChildren()

/** One route object, from its opening brace to the matching one. */
function routeObject(source, path) {
  const at = source.indexOf(`path: '${path}'`)
  if (at === -1) return ''
  const start = source.lastIndexOf('{', at)
  if (start === -1) return ''
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return ''
}

describe('visitors without a session never reach the 3D background', () => {
  it('imports AppBackground3D in AppLayout.vue only', () => {
    const importsBackground = /(?:import\(|from\s+)['"][^'"]*AppBackground3D(?:\.vue)?['"]/
    const importers = sourceFiles('src')
      .filter((file) => file !== 'src/components/AppBackground3D.vue')
      .filter((file) => importsBackground.test(readSource(file)))

    expect(importers).toEqual(['src/components/AppLayout.vue'])
  })

  it('mounts the background from AppLayout.vue as a lazy component', () => {
    expect(LAYOUT).toContain("import('./AppBackground3D.vue')")
    expect(LAYOUT).toMatch(/<AppBackground\s*\/>/)
    // The scene module itself is the only place Three.js is imported.
    expect(BACKGROUND).toContain('TresBackdrop')
  })

  it('keeps the four top-level public routes outside RoleShell and AppLayout', () => {
    const shellIndex = ROUTER.indexOf('component: RoleShell')
    expect(shellIndex).toBeGreaterThan(-1)

    for (const route of TOP_LEVEL) {
      const index = ROUTER.indexOf(`path: '${route.path}'`)
      expect(index, route.path).toBeGreaterThan(-1)
      expect(index, `${route.path} is declared before the shell`).toBeLessThan(shellIndex)

      const block = routeObject(ROUTER, route.path)
      expect(block, route.path).toContain(route.routerImport)
      expect(block, route.path).not.toContain('RoleShell')
      expect(block, route.path).not.toContain('AppLayout')

      // And they are not children of the shell either.
      expect(CHILDREN, `${route.path} is not a shell child`).not.toContain(`path: '${route.path}'`)
    }
  })

  it('keeps the anonymous registration inside RoleShell with its bare flag', () => {
    expect(CHILDREN.indexOf("path: '/meeting/register'")).toBeGreaterThan(-1)

    const block = routeObject(CHILDREN, '/meeting/register')
    expect(block).toContain('./pages/RegisterPage.vue')
    expect(block).toContain('cleanShellWhenAnonymous: true')
    expect(block).not.toContain('requiresAuth')
  })

  it('sets bareRegistration true exactly when no session is present', () => {
    const flat = SHELL.replace(/\s+/g, ' ')
    expect(flat).toContain('const bareRegistration = computed(')
    expect(flat).toContain('route.meta.cleanShellWhenAnonymous === true && !session.value')
  })

  it('renders the bare RouterView before ControllerShell and AppLayout', () => {
    const bare = SHELL.indexOf('<RouterView v-if="bareRegistration" />')
    const controller = SHELL.indexOf('<ControllerShell v-else-if=')
    const layout = SHELL.indexOf('<AppLayout v-else')

    expect(bare).toBeGreaterThan(-1)
    expect(controller).toBeGreaterThan(bare)
    expect(layout).toBeGreaterThan(controller)
    // AppLayout is only ever the final fallback.
    expect(SHELL).toContain('<AppLayout v-else')
  })

  it('never imports TresBackdrop, TresBackdropScene or three from a public page', () => {
    for (const route of PUBLIC_PAGES) {
      const source = readSource(route.page)
      expect(source, route.page).not.toMatch(/TresBackdrop/)
      expect(source, route.page).not.toMatch(/TresBackdropScene/)
      expect(source, route.page).not.toMatch(/from\s+['"]three['"]/)
      expect(source, route.page).not.toMatch(/import\(\s*['"]three['"]\s*\)/)
    }
  })
})
