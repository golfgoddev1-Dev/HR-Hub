// Guards the UI contract: every UI change reads both design documents, and the
// rules themselves cannot quietly disappear.
//
//   node scripts/check-ui-skill.mjs
//
// Exits 1 when AGENTS.md or CLAUDE.md has lost the mandatory rule, when the
// hr-hub-ui-motion skill has lost one of its ten sections, when the plain
// Markdown copy is missing a section, or when docs/ai/frontend-design.md is
// missing, has frontmatter, or has lost / reordered one of its eight headings.
// `tests/ui-skill.test.js` runs the same checks in the suite.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSource } from '../tests/helpers/read-source.js'

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const AGENTS_FILE = 'AGENTS.md'
export const CLAUDE_FILE = 'CLAUDE.md'
export const SKILL_FILE = '.claude/skills/hr-hub-ui-motion/SKILL.md'
export const DESIGN_SKILL_FILE = '.claude/skills/hr-hub-frontend-design/SKILL.md'
export const UI_DOC_FILE = 'docs/ai/hr-hub-ui-motion.md'
export const DESIGN_DOC_FILE = 'docs/ai/frontend-design.md'

export const MANDATORY_RULE =
  'Before you change any file under src/pages, src/components, src/styles.css, src/lib/background-scene.js, src/lib/motion.js, or src/lib/background-quality.js, you MUST read docs/ai/hr-hub-ui-motion.md AND docs/ai/frontend-design.md and follow every rule in both. In your report, state which rules you checked. If a requested change conflicts with a rule, stop and ask instead of working around it.'

export const REPORT_RULE =
  'Report contrast ratios, tier used, and screenshot paths for every UI change.'

export const SECTION_COUNT = 10

export const DESIGN_HEADINGS = Object.freeze([
  'A. Visual direction',
  'B. Typography',
  'C. Colour tokens and contrast',
  'D. Layout and composition',
  'E. Motion design',
  'F. 3D and WebGL',
  'G. Performance budget',
  'H. Anti-patterns to avoid',
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
    if (!flat.includes(flatten(REPORT_RULE))) {
      problems.push(`${file} does not require contrast, tier and screenshot reporting`)
    }
  }

  const skill = readOrNull(read, at(SKILL_FILE))
  if (skill === null) {
    problems.push(`missing skill file ${SKILL_FILE}`)
  } else {
    for (let n = 1; n <= SECTION_COUNT; n += 1) {
      if (!sectionHeading(n).test(skill)) {
        problems.push(`${SKILL_FILE} is missing the section ${n} heading ("## ${n}. ...")`)
      }
    }
  }

  const uiDoc = readOrNull(read, at(UI_DOC_FILE))
  if (uiDoc === null) {
    problems.push(`missing ${UI_DOC_FILE}`)
  } else {
    for (let n = 1; n <= SECTION_COUNT; n += 1) {
      if (!sectionHeading(n).test(uiDoc)) {
        problems.push(`${UI_DOC_FILE} is missing the section ${n} heading ("## ${n}. ...")`)
      }
    }
    if (!flatten(uiDoc).includes('docs/ai/frontend-design.md sections A to H')) {
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
    let lastIndex = -1
    for (const heading of DESIGN_HEADINGS) {
      const index = designDoc.indexOf(`## ${heading}`)
      if (index === -1) {
        problems.push(`${DESIGN_DOC_FILE} is missing the heading "## ${heading}"`)
        continue
      }
      if (lastIndex !== -1 && index < lastIndex) {
        problems.push(`${DESIGN_DOC_FILE} has "## ${heading}" out of order`)
      }
      lastIndex = index
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
    `UI skill check passed: ${AGENTS_FILE} and ${CLAUDE_FILE} name both documents, ${UI_DOC_FILE} has sections 1-${SECTION_COUNT}, and ${DESIGN_DOC_FILE} has headings A-H in order.`
  )
}
