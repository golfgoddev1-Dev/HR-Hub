// Guards the UI contract: every UI change reads both design documents, and the
// rules, wrappers and agent instructions cannot quietly disappear.
//
//   node scripts/check-ui-skill.mjs   (npm run check:ui-skill)
//
// Exits 1 when AGENTS.md or CLAUDE.md has lost the mandatory rule, when either
// document is missing or has lost / reordered a heading, when a wrapper is
// missing or points at the wrong file, or when the tint floor stops stating the
// measured 0.86 minimum. `tests/ui-skill.test.js` runs the same checks in the
// suite.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSource } from '../tests/helpers/read-source.js'

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const AGENTS_FILE = 'AGENTS.md'
export const CLAUDE_FILE = 'CLAUDE.md'
export const UI_DOC_FILE = 'docs/ai/hr-hub-ui-motion.md'
export const DESIGN_DOC_FILE = 'docs/ai/frontend-design.md'
export const SKILL_FILE = '.claude/skills/hr-hub-ui-motion/SKILL.md'
export const DESIGN_SKILL_FILE = '.claude/skills/hr-hub-frontend-design/SKILL.md'
export const FRONTEND_DESIGN_SKILL_FILE = '.claude/skills/frontend-design/SKILL.md'

export const MANDATORY_RULE =
  'Before changing any file under src/pages, src/components, src/styles.css, src/lib/background-scene.js, src/lib/motion.js, src/lib/background-quality.js, src/lib/dialog-focus.js, src/lib/lite-mode.js, or src/lib/dock-entrance.js, you MUST read docs/ai/hr-hub-ui-motion.md AND docs/ai/frontend-design.md and follow every rule in both. In your final report, list which sections you checked. If a requested change conflicts with a rule, stop and ask instead of working around it.'

export const DESIGN_PLAN_RULE =
  'Before coding any UI change, write the design plan described in docs/ai/frontend-design.md section I, and include it in your report.'

export const REPORT_RULE =
  'Report contrast ratios, tier used, and screenshot paths for every UI change.'

export const GUARDED_FILES = Object.freeze([
  'src/pages',
  'src/components',
  'src/styles.css',
  'src/lib/background-scene.js',
  'src/lib/motion.js',
  'src/lib/background-quality.js',
  'src/lib/dialog-focus.js',
  'src/lib/lite-mode.js',
  'src/lib/dock-entrance.js',
])

export const UI_SECTIONS = Object.freeze(Array.from({ length: 10 }, (_, i) => i + 1))

export const DESIGN_HEADINGS = Object.freeze([
  'A. Visual direction',
  'B. Typography',
  'C. Colour tokens and contrast',
  'D. Layout and composition',
  'E. Motion design',
  'F. 3D and WebGL',
  'G. Performance budget',
  'H. Anti-patterns to avoid',
  'I. Design process',
  'J. Copy and writing',
])

// Markdown wraps at the author's whim; compare on collapsed whitespace so a
// re-wrapped paragraph still counts as the rule.
export function flatten(text) {
  return String(text).replace(/\s+/g, ' ').trim()
}

export function sectionHeading(n) {
  return new RegExp(`^## ${n}\\. `, 'm')
}

function readOrNull(read, file) {
  try {
    return read(file)
  } catch {
    return null
  }
}

function checkHeadings(problems, file, text, headings) {
  let lastIndex = -1
  for (const heading of headings) {
    const index = text.indexOf(`## ${heading}`)
    if (index === -1) {
      problems.push(`${file} is missing the heading "## ${heading}"`)
      continue
    }
    if (lastIndex !== -1 && index < lastIndex) {
      problems.push(`${file} has "## ${heading}" out of order`)
    }
    lastIndex = index
  }
}

/**
 * @param {(file: string) => string} read file reader, injectable for tests
 * @param {string} root project root the files are resolved against
 * @returns {string[]} human-readable problems; empty means the guard passed
 */
export function checkUiSkill(read = readSource, root = projectRoot) {
  const problems = []
  const at = (file) => path.join(root, file)

  for (const file of [AGENTS_FILE, CLAUDE_FILE]) {
    const text = readOrNull(read, at(file))
    if (text === null) {
      problems.push(`missing ${file} at the repo root`)
      continue
    }
    const flat = flatten(text)
    if (!flat.includes(flatten(MANDATORY_RULE))) {
      problems.push(`${file} does not contain the mandatory UI rule naming both documents`)
    }
    if (!flat.includes('docs/ai/hr-hub-ui-motion.md')) {
      problems.push(`${file} does not name docs/ai/hr-hub-ui-motion.md`)
    }
    if (!flat.includes('docs/ai/frontend-design.md')) {
      problems.push(`${file} does not name docs/ai/frontend-design.md`)
    }
    for (const file of GUARDED_FILES) {
      if (!flat.includes(file)) problems.push(`${AGENTS_FILE}/${CLAUDE_FILE} rule does not list ${file}`)
    }
    if (!flat.includes(flatten(DESIGN_PLAN_RULE))) {
      problems.push(`${file} does not require the section I design plan in the report`)
    }
    if (!flat.includes(flatten(REPORT_RULE))) {
      problems.push(`${file} does not require contrast, tier and screenshot reporting`)
    }
  }

  const uiDoc = readOrNull(read, at(UI_DOC_FILE))
  if (uiDoc === null) {
    problems.push(`missing ${UI_DOC_FILE}`)
  } else {
    if (uiDoc.trimStart().startsWith('---')) {
      problems.push(`${UI_DOC_FILE} starts with frontmatter; it must be plain Markdown`)
    }
    checkHeadings(problems, UI_DOC_FILE, uiDoc, UI_SECTIONS.map((n) => `${n}.`))
    const flat = flatten(uiDoc)
    if (!flat.includes('0.86')) {
      problems.push(`${UI_DOC_FILE} does not state the 0.86 tint floor`)
    }
    if (!flat.includes('its own contrast measurement')) {
      problems.push(`${UI_DOC_FILE} does not require a page at 0.86 to carry its own contrast measurement`)
    }
    if (!flat.includes('docs/ai/frontend-design.md sections A to H')) {
      problems.push(`${UI_DOC_FILE} section 8 does not point at docs/ai/frontend-design.md sections A to H`)
    }
  }

  const designDoc = readOrNull(read, at(DESIGN_DOC_FILE))
  if (designDoc === null) {
    problems.push(`missing ${DESIGN_DOC_FILE}`)
  } else {
    if (designDoc.trimStart().startsWith('---')) {
      problems.push(`${DESIGN_DOC_FILE} starts with frontmatter; it must be plain Markdown`)
    }
    checkHeadings(problems, DESIGN_DOC_FILE, designDoc, DESIGN_HEADINGS)
  }

  const wrappers = [
    { file: SKILL_FILE, name: 'hr-hub-ui-motion', doc: UI_DOC_FILE },
    { file: DESIGN_SKILL_FILE, name: 'hr-hub-frontend-design', doc: DESIGN_DOC_FILE },
    { file: FRONTEND_DESIGN_SKILL_FILE, name: 'frontend-design', doc: DESIGN_DOC_FILE },
  ]
  for (const wrapper of wrappers) {
    const text = readOrNull(read, at(wrapper.file))
    if (text === null) {
      problems.push(`missing wrapper ${wrapper.file}`)
      continue
    }
    if (!new RegExp(`^name: ${wrapper.name}$`, 'm').test(text)) {
      problems.push(`${wrapper.file} does not declare "name: ${wrapper.name}"`)
    }
    if (!text.includes(wrapper.doc)) {
      problems.push(`${wrapper.file} does not point at ${wrapper.doc}`)
    }
    if (!/\bfollow\b/i.test(text)) {
      problems.push(`${wrapper.file} does not tell the reader to follow the document`)
    }
  }

  return problems
}

const invokedDirectly = (() => {
  const arg = process.argv[1]
  if (!arg) return false
  try {
    return path.resolve(arg).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  const problems = checkUiSkill()
  if (problems.length > 0) {
    console.error('UI skill check failed:')
    for (const problem of problems) console.error(` - ${problem}`)
    process.exit(1)
  }
  console.log(
    `UI skill check passed: ${AGENTS_FILE} and ${CLAUDE_FILE} name both documents and require the section I plan, ${UI_DOC_FILE} has sections 1-10 in order, ${DESIGN_DOC_FILE} has headings A-J in order, and all three wrappers point at their document.`
  )
}
