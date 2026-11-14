// Guards the UI contract: every UI change must load and follow the
// hr-hub-ui-motion skill, and CLAUDE.md has to say so as its first section.
//
//   node scripts/check-ui-skill.mjs
//
// Exits 1 when CLAUDE.md is missing the mandatory rule, or when the skill file
// is missing or has lost any of its ten numbered sections. `tests/ui-skill.test.js`
// runs the same checks in the suite.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSource } from '../tests/helpers/read-source.js'

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const CLAUDE_FILE = 'CLAUDE.md'
export const SKILL_FILE = '.claude/skills/hr-hub-ui-motion/SKILL.md'

export const MANDATORY_RULE =
  'Before you change any file under src/pages, src/components, src/styles.css, src/lib/background-scene.js, src/lib/motion.js, or src/lib/background-quality.js, you MUST load the skill `hr-hub-ui-motion` (.claude/skills/hr-hub-ui-motion/SKILL.md) and follow every rule in it. In your report, state which rules you checked. If a requested change conflicts with a rule, stop and ask instead of working around it.'

export const REPORT_RULE =
  'Report contrast ratios, tier used, and screenshot paths for every UI change.'

export const SECTION_COUNT = 10

// Markdown wraps at the author's whim; compare on collapsed whitespace so a
// re-wrapped paragraph still counts as the rule.
export function flatten(text) {
  return String(text).replace(/\s+/g, ' ').trim()
}

export function sectionHeading(n) {
  return new RegExp(`^## ${n}\\. `, 'm')
}

/**
 * @param {(file: string) => string} read file reader, injectable for tests
 * @param {string} root project root the two files are resolved against
 * @returns {string[]} human-readable problems; empty means the guard passed
 */
export function checkUiSkill(read = readSource, root = projectRoot) {
  const problems = []

  let claude
  try {
    claude = read(path.join(root, CLAUDE_FILE))
  } catch {
    problems.push(`missing ${CLAUDE_FILE} at the repo root`)
  }
  if (claude !== undefined) {
    const flat = flatten(claude)
    if (!flat.includes(flatten(MANDATORY_RULE))) {
      problems.push(`${CLAUDE_FILE} does not contain the mandatory UI skill rule`)
    }
    if (!flat.includes(flatten(REPORT_RULE))) {
      problems.push(`${CLAUDE_FILE} does not require contrast, tier and screenshot reporting`)
    }
  }

  let skill
  try {
    skill = read(path.join(root, SKILL_FILE))
  } catch {
    problems.push(`missing skill file ${SKILL_FILE}`)
  }
  if (skill !== undefined) {
    for (let n = 1; n <= SECTION_COUNT; n += 1) {
      if (!sectionHeading(n).test(skill)) {
        problems.push(`${SKILL_FILE} is missing the section ${n} heading ("## ${n}. ...")`)
      }
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
    `UI skill check passed: ${CLAUDE_FILE} makes the skill mandatory, and ${SKILL_FILE} has sections 1-${SECTION_COUNT}.`
  )
}
