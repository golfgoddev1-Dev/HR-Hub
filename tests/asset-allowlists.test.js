// Automated guards for the trimmed frontend assets.
//
// Material Symbols is loaded with an explicit icon_names list in index.html.
// A name outside that list renders as text, so every icon source in src/ is
// checked here. Vuetify utility CSS is trimmed to the classes in
// src/vuetify-utilities.css; a class outside that file silently loses styling.
//
// Exclusion rules:
// - Only icon contexts are read: material-symbols-outlined spans, icon="" props,
//   icon: fields, :icon/:brand-icon bindings, and the explicit dynamic binding
//   map below. Thai copy, comments, ordinary prose and CSS are ignored.
// - Only class="" and :class="" attributes in .vue files are read. A class is
//   treated as a Vuetify utility only when it matches the utility grammar in
//   isVuetifyUtilityClass(). App-specific classes such as "card", "is-empty",
//   "statusClass(...)" and template-prefix classes such as `phase-${...}` are
//   therefore ignored.
// - A dynamic class produced entirely by application code is not a Vuetify
//   utility allowlist entry; the guard does not guess its runtime value.
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ICON_TOKEN = /^[a-z][a-z0-9_]*$/
const LINE_SPLIT = /\r?\n/
const normalize = (value) => value.replace(/\s+/g, ' ').trim()

function toPosix(file) {
  return file.split(sep).join('/')
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(?:vue|js)$/.test(entry.name) ? [full] : []
  })
}

const ALL_SOURCES = sourceFiles(join(ROOT, 'src')).map((absolute) => ({
  file: toPosix(relative(ROOT, absolute)),
  source: readFileSync(absolute, 'utf8'),
}))
const VUE_SOURCES = ALL_SOURCES.filter(({ file }) => file.endsWith('.vue'))

function readProjectFile(file) {
  return readFileSync(join(ROOT, file), 'utf8')
}

const HTML = readProjectFile('index.html')
const UTILITY_CSS = readProjectFile('src/vuetify-utilities.css')

function parseIconAllowlist() {
  const match = HTML.match(/icon_names=([^&"']+)/)
  if (!match) throw new Error('index.html is missing the Material Symbols icon_names parameter')
  return new Set(match[1].split(',').map((name) => name.trim()).filter(Boolean))
}

function parseUtilityAllowlist() {
  // The allowlist lives inside the Vuetify utilities layer. Ignore the layer
  // name itself and collect only the declared class selectors.
  const start = UTILITY_CSS.indexOf('@layer vuetify-utilities.helpers')
  const body = start === -1 ? UTILITY_CSS : UTILITY_CSS.slice(start)
  return new Set(
    [...body.matchAll(/^\s*\.([a-z][\w-]*)\s*\{/gm)].map((match) => match[1])
  )
}

const ICON_ALLOWLIST = parseIconAllowlist()
const UTILITY_ALLOWLIST = parseUtilityAllowlist()

// The menu/config icon names. These are the values behind the `item.icon`
// bindings in AppDock, AdminNav and ControllerNav.
const ITEM_ICONS = [
  'badge',
  'calendar_month',
  'dashboard',
  'edit',
  'edit_calendar',
  'event_busy',
  'event_note',
  'fact_check',
  'groups',
  'history',
  'home',
  'how_to_reg',
  'insights',
  'manage_accounts',
  'medical_information',
  'password',
  'person',
  'qr_code_2',
  'settings',
  'space_dashboard',
  'upload_file',
]

// Explicit exceptions for values that are not literal icon names at the
// binding site. Key = file relative to the project root + normalized expression.
// `count` makes a new occurrence of a known expression fail until it is
// reviewed; a new expression in a new file fails as unrecognized.
const DYNAMIC_ICON_BINDINGS = {
  'src/components/AdminNav.vue|item.icon': { count: 2, icons: ITEM_ICONS },
  'src/components/AppDock.vue|brandIcon': { count: 2, icons: ['groups', 'beach_access'] },
  'src/components/AppDock.vue|item.icon': { count: 3, icons: ITEM_ICONS },
  'src/components/AppDock.vue|leaving ? \'sync\' : \'logout\'': {
    count: 2,
    icons: ['sync', 'logout'],
  },
  'src/components/ControllerNav.vue|item.icon': { count: 2, icons: ITEM_ICONS },
  'src/components/AppLayout.vue|brand.icon': { count: 1, icons: ['groups', 'beach_access'] },
  'src/pages/AdminPage.vue|stat.icon': {
    count: 1,
    icons: ['groups', 'pending_actions', 'how_to_reg', 'event_busy'],
  },
  'src/pages/AdminPage.vue|item.icon': {
    count: 1,
    icons: ['event_note', 'how_to_reg', 'groups', 'event_busy'],
  },
  'src/pages/AdminPermissionsPage.vue|field.icon': {
    count: 1,
    icons: ['badge', 'groups', 'shield_person', 'fact_check'],
  },
  'src/pages/ControllerDashboardPage.vue|STATUS_ICON[label] ?? \'circle\'': {
    count: 1,
    icons: ['check_circle', 'cancel', 'engineering', 'event_busy', 'circle'],
  },
  'src/pages/HrHomePage.vue|card.icon': { count: 1, icons: ['groups', 'upload_file', 'edit'] },
  'src/pages/LoginPage.vue|option.icon': {
    count: 1,
    icons: ['badge', 'groups', 'qr_code', 'settings_suggest'],
  },
  'src/pages/LoginPage.vue|pinVisible ? \'visibility_off\' : \'visibility\'': {
    count: 1,
    icons: ['visibility_off', 'visibility'],
  },
  'src/pages/SetPinPage.vue|pinVisible ? \'visibility_off\' : \'visibility\'': {
    count: 1,
    icons: ['visibility_off', 'visibility'],
  },
  'src/pages/SetPinPage.vue|pinMatches ? \'check_circle\' : \'cancel\'': {
    count: 1,
    icons: ['check_circle', 'cancel'],
  },
  'src/pages/SetPinPage.vue|confirmVisible ? \'visibility_off\' : \'visibility\'': {
    count: 1,
    icons: ['visibility_off', 'visibility'],
  },
  'src/lib/leave-nav-items.js|APPROVALS_ICON': { count: 1, icons: ['fact_check'] },
  'src/lib/leave-nav-items.js|HISTORY_ICON': { count: 1, icons: ['history'] },
}

function lineAt(source, index) {
  return source.slice(0, index).split(LINE_SPLIT).length
}

function problem(file, line, message) {
  return `${message} (${file}:${line})`
}

function attributeClassTokens(value) {
  return value.split(/\s+/).filter(Boolean)
}

function literalExpressionTokens(expression) {
  // Object/array/ternary class literals are quoted strings. A fully computed
  // value such as `statusClass(item.status)` has no literal and is not guessed.
  return [...expression.matchAll(/(['"`])([^'"`]*)\1/g)]
    .map((match) => match[2])
    .filter((value) => !value.includes('${'))
    .flatMap(attributeClassTokens)
}

const UTILITY_PATTERNS = [
  /^[mp][trblxy]?-(?:auto|0|[1-9]\d*)$/,
  /^d-(?:none|inline|inline-block|block|table|table-row|table-cell|flex|inline-flex|grid|inline-grid)$/,
  /^text-(?:h[1-6]|subtitle-[12]|body-[12]|button|caption|overline|left|right|center|justify|start|end|error|primary|secondary|success|warning|info|surface|on-surface|disabled|medium-emphasis|high-emphasis|low-emphasis|no-wrap|truncate|break|capitalize|lowercase|uppercase|none|wrap|mono)$/,
  /^bg-[\w-]+$/,
  /^font-(?:weight-[\w-]+|italic)$/,
  /^justify-(?:start|end|center|space-between|space-around|space-evenly)$/,
  /^align-(?:start|end|center|baseline|stretch)$/,
  /^align-self-(?:auto|start|end|center|baseline|stretch)$/,
  /^flex-(?:row|column|row-reverse|column-reverse|grow-\d|shrink-\d|wrap|nowrap|wrap-reverse|fill)$/,
  /^(?:ga|gap)-\d+$/,
  /^rounded(?:-[\w-]+)?$/,
  /^elevation-\d+$/,
  /^opacity-\d+$/,
  /^overflow(?:-[xy])?-[\w-]+$/,
  /^position-(?:static|relative|absolute|fixed|sticky)$/,
  /^[wh]-\d+$/,
  /^min-[wh]-\d+$/,
  /^border(?:-[\w-]+)?$/,
  /^float-(?:left|right|none|start|end)$/,
  /^order-(?:\d+|first|last)$/,
  /^(?:text-decoration-(?:none|underline|line-through)|user-select-none|pointer-events-(?:none|auto)|cursor-(?:pointer|default|not-allowed)|fill-height)$/,
]

function isVuetifyUtilityClass(name) {
  return UTILITY_PATTERNS.some((pattern) => pattern.test(name))
}

function scanIconLiterals(sources, allowlist) {
  const problems = []

  for (const { file, source } of sources) {
    // Icons written directly inside a Material Symbols span, or a mustache
    // handled separately by scanDynamicIcons().
    for (const match of source.matchAll(
      /<span\b[^>]*\bclass=(?:"((?:[^"]*\s)?material-symbols-outlined(?:\s[^"]*)?)"|'((?:[^']*\s)?material-symbols-outlined(?:\s[^']*)?)')[^>]*>([\s\S]*?)<\/span>/g
    )) {
      const content = match[3].trim()
      const line = lineAt(source, match.index)
      if (/\{\{[\s\S]*\}\}/.test(content)) continue
      if (ICON_TOKEN.test(content)) {
        if (!allowlist.has(content)) {
          problems.push(
            problem(
              file,
              line,
              `Icon "${content}" is not in icon_names in index.html; add the exact name there`
            )
          )
        }
        continue
      }
      if (content) {
        problems.push(
          problem(
            file,
            line,
            `Unrecognized icon value "${normalize(content)}" in a material-symbols-outlined span`
          )
        )
      }
    }

    // Static icon="" props, including <v-icon icon="...">.
    for (const match of source.matchAll(/(?:^|\s)icon\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const value = match[1] ?? match[2] ?? ''
      if (!value) continue
      if (!ICON_TOKEN.test(value)) {
        problems.push(
          problem(file, lineAt(source, match.index), `Unrecognized icon prop value "${value}"`)
        )
        continue
      }
      if (!allowlist.has(value)) {
        problems.push(
          problem(
            file,
            lineAt(source, match.index),
            `Icon "${value}" is not in icon_names in index.html; add the exact name there`
          )
        )
      }
    }

    // Object fields such as { icon: 'groups' }. A bare identifier is
    // deliberately left to the dynamic binding map, not guessed here.
    for (const match of source.matchAll(
      /\bicon\s*:\s*(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))/g
    )) {
      if (match[2]) {
        const value = match[2]
        if (!allowlist.has(value)) {
          problems.push(
            problem(
              file,
              lineAt(source, match.index),
              `Icon "${value}" is not in icon_names in index.html; add the exact name there`
            )
          )
        }
      }
    }
  }

  return problems
}

function scanDynamicIcons(sources, allowlist, bindings) {
  const problems = []
  const occurrences = new Map()

  for (const { file, source } of sources) {
    const add = (expression, index) => {
      const key = `${file}|${normalize(expression)}`
      const entry = bindings[key]
      if (!entry) {
        problems.push(
          problem(
            file,
            lineAt(source, index),
            `Unrecognized dynamic icon binding "${normalize(expression)}"; add it to DYNAMIC_ICON_BINDINGS with its possible icon names`
          )
        )
        return
      }
      occurrences.set(key, (occurrences.get(key) ?? 0) + 1)
    }

    for (const match of source.matchAll(
      /<span\b[^>]*\bclass=(?:"((?:[^"]*\s)?material-symbols-outlined(?:\s[^"]*)?)"|'((?:[^']*\s)?material-symbols-outlined(?:\s[^']*)?)')[^>]*>([\s\S]*?)<\/span>/g
    )) {
      const content = match[3].trim()
      const mustache = content.match(/^\{\{([\s\S]*)\}\}$/)
      if (mustache) add(mustache[1], match.index)
    }

    for (const match of source.matchAll(
      /\bicon\s*:\s*([A-Za-z_$][\w$]*)/g
    )) {
      add(match[1], match.index)
    }

    for (const match of source.matchAll(/\s:(?:[A-Za-z-]*icon)\s*=\s*"([^"]+)"/g)) {
      add(match[1], match.index)
    }
  }

  for (const [key, expected] of Object.entries(bindings)) {
    const [file] = key.split('|')
    const found = occurrences.get(key) ?? 0
    if (found !== expected.count) {
      problems.push(
        `${key}: expected ${expected.count} dynamic icon binding(s), found ${found}; review the source and update DYNAMIC_ICON_BINDINGS`
      )
    }
    for (const icon of expected.icons) {
      if (!allowlist.has(icon)) {
        problems.push(
          `${file}: dynamic icon binding allows "${icon}", but it is not in icon_names in index.html`
        )
      }
    }
  }

  return problems
}

function scanNamedIconSources(sources, allowlist) {
  const problems = []

  for (const { file, source } of sources) {
    // Constants such as APPROVALS_ICON and HISTORY_ICON are used by icon:
    // fields, so validate the value at its definition too.
    for (const match of source.matchAll(/\b[A-Z][A-Z0-9_]*ICON\s*=\s*['"]([^'"]+)['"]/g)) {
      const icon = match[1]
      if (!allowlist.has(icon)) {
        problems.push(
          problem(
            file,
            lineAt(source, match.index),
            `Icon constant value "${icon}" is not in icon_names in index.html`
          )
        )
      }
    }

    // STATUS_ICON is a label-keyed object rather than icon: fields. Validate
    // every icon it can return; the dynamic expression itself stays pinned in
    // DYNAMIC_ICON_BINDINGS.
    for (const match of source.matchAll(/\bSTATUS_ICON\s*=\s*\{([\s\S]*?)\}/g)) {
      for (const literal of match[1].matchAll(/(['"])([^'"]+)\1/g)) {
        const icon = literal[2]
        if (!ICON_TOKEN.test(icon) || allowlist.has(icon)) continue
        problems.push(
          problem(
            file,
            lineAt(source, match.index),
            `Icon "${icon}" in STATUS_ICON is not in icon_names in index.html`
          )
        )
      }
    }
  }

  return problems
}

function scanUtilities(sources, allowlist) {
  const problems = []

  for (const { file, source } of sources) {
    for (const match of source.matchAll(
      /(?:^|\s)(:?class)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    )) {
      const directive = match[1]
      const value = match[2] ?? match[3] ?? ''
      const tokens =
        directive === 'class' ? attributeClassTokens(value) : literalExpressionTokens(value)

      for (const token of tokens) {
        if (!isVuetifyUtilityClass(token) || allowlist.has(token)) continue
        problems.push(
          problem(
            file,
            lineAt(source, match.index),
            `Vuetify utility class "${token}" is missing from src/vuetify-utilities.css; add its rule there`
          )
        )
      }
    }
  }

  return problems
}

function formatProblems(problems) {
  return problems.join('\n')
}

describe('trimmed asset allowlists', () => {
  it('parses the 61 icon names and the utility allowlist', () => {
    expect(ICON_ALLOWLIST.size).toBe(61)
    expect(UTILITY_ALLOWLIST).toEqual(
      new Set(['mt-4', 'mb-3', 'mb-4'])
    )
  })

  it('uses only icons present in index.html icon_names', () => {
    expect(formatProblems(scanIconLiterals(ALL_SOURCES, ICON_ALLOWLIST))).toBe('')
    expect(
      formatProblems(scanDynamicIcons(ALL_SOURCES, ICON_ALLOWLIST, DYNAMIC_ICON_BINDINGS))
    ).toBe('')
    expect(formatProblems(scanNamedIconSources(ALL_SOURCES, ICON_ALLOWLIST))).toBe('')
  })

  it('uses only Vuetify utility classes present in src/vuetify-utilities.css', () => {
    expect(formatProblems(scanUtilities(VUE_SOURCES, UTILITY_ALLOWLIST))).toBe('')
  })

  it('catches a fake icon name in a fixture', () => {
    const fixture = [
      {
        file: 'fixture.vue',
        source: '<span class="material-symbols-outlined">qr_code_missing</span>',
      },
    ]
    const problems = scanIconLiterals(fixture, ICON_ALLOWLIST)

    expect(formatProblems(problems)).toContain('qr_code_missing')
    expect(formatProblems(problems)).toContain('fixture.vue:1')
  })

  it('catches a fake icon behind a dynamic source', () => {
    const fixture = [
      {
        file: 'fixture.js',
        source: "export const APPROVALS_ICON = 'qr_code_missing'",
      },
    ]
    const problems = scanNamedIconSources(fixture, ICON_ALLOWLIST)

    expect(formatProblems(problems)).toContain('qr_code_missing')
    expect(formatProblems(problems)).toContain('fixture.js:1')
  })

  it('catches a fake utility class in a fixture', () => {
    const fixture = [
      {
        file: 'fixture.vue',
        source: '<template><div class="mt-999"></div></template>',
      },
    ]
    const problems = scanUtilities(fixture, UTILITY_ALLOWLIST)

    expect(formatProblems(problems)).toContain('mt-999')
    expect(formatProblems(problems)).toContain('fixture.vue:1')
  })

  it('catches an unknown dynamic icon binding in a fixture', () => {
    const fixture = [
      {
        file: 'fixture.vue',
        source: '<span class="material-symbols-outlined">{{ mysteryIcon }}</span>',
      },
    ]
    const problems = scanDynamicIcons(fixture, ICON_ALLOWLIST, DYNAMIC_ICON_BINDINGS)

    expect(formatProblems(problems)).toContain('mysteryIcon')
    expect(formatProblems(problems)).toContain('fixture.vue:1')
  })
})
