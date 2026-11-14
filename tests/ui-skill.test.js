import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  AGENTS_FILE,
  CLAUDE_FILE,
  DESIGN_DOC_FILE,
  DESIGN_HEADINGS,
  DESIGN_SKILL_FILE,
  MANDATORY_RULE,
  REPORT_RULE,
  SECTION_COUNT,
  SKILL_FILE,
  UI_DOC_FILE,
  checkUiSkill,
  sectionHeading,
} from '../scripts/check-ui-skill.mjs'
import { readSource } from './helpers/read-source.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (file) => readSource(join(root, file))

const agents = read(AGENTS_FILE)
const claude = read(CLAUDE_FILE)
const skill = read(SKILL_FILE)
const uiDoc = read(UI_DOC_FILE)
const designDoc = read(DESIGN_DOC_FILE)
const designSkill = read(DESIGN_SKILL_FILE)

const files = {
  'AGENTS.md': agents,
  'CLAUDE.md': claude,
  'hr-hub-ui-motion/SKILL.md': skill,
  'hr-hub-ui-motion.md': uiDoc,
  'frontend-design.md': designDoc,
}

function fixtureReader(overrides = {}) {
  return (file) => {
    const key = Object.keys(files).find((name) => file.endsWith(name))
    if (!key) throw new Error(`unexpected read: ${file}`)
    return key in overrides ? overrides[key] : files[key]
  }
}

describe('UI skill guard', () => {
  it('passes on this repository', () => {
    expect(checkUiSkill()).toEqual([])
  })

  it('AGENTS.md and CLAUDE.md both make both documents mandatory', () => {
    for (const text of [agents, claude]) {
      const flat = text.replace(/\s+/g, ' ')
      expect(flat).toContain(MANDATORY_RULE.replace(/\s+/g, ' '))
      expect(flat).toContain('docs/ai/hr-hub-ui-motion.md')
      expect(flat).toContain('docs/ai/frontend-design.md')
      expect(flat).toContain(REPORT_RULE.replace(/\s+/g, ' '))
    }

    const firstSection = claude.match(/^##\s+(.+)$/m)
    expect(firstSection).not.toBeNull()
    expect(firstSection[1]).toMatch(/UI/)
    expect(claude.indexOf(firstSection[0])).toBeLessThan(claude.indexOf('Before you change any file'))
  })

  it('the skill is named, says when it applies, and has all ten sections', () => {
    expect(skill.startsWith('---\n')).toBe(true)
    expect(skill).toMatch(/^name: hr-hub-ui-motion$/m)
    expect(skill).toMatch(/^description: .*src\/pages.*src\/components.*src\/styles\.css/m)

    for (let n = 1; n <= SECTION_COUNT; n += 1) {
      expect(sectionHeading(n).test(skill), `skill section ${n}`).toBe(true)
    }

    // A bare heading is not a section: every one of them must carry rules.
    const bodies = skill.split(/^## /m).slice(1)
    expect(bodies).toHaveLength(SECTION_COUNT)
    for (const body of bodies) {
      expect(body.length).toBeGreaterThan(400)
    }
  })

  it('the plain Markdown copy is complete and points at the design document', () => {
    expect(uiDoc.startsWith('---')).toBe(false)
    for (let n = 1; n <= SECTION_COUNT; n += 1) {
      expect(sectionHeading(n).test(uiDoc), `doc section ${n}`).toBe(true)
    }
    expect(uiDoc.replace(/\s+/g, ' ')).toContain(
      'Check the change against docs/ai/frontend-design.md sections A to H and list any section that you could not meet.'
    )
  })

  it('the frontend design document is plain Markdown with A-H in order', () => {
    expect(designDoc.startsWith('---')).toBe(false)
    let last = -1
    for (const heading of DESIGN_HEADINGS) {
      const index = designDoc.indexOf(`## ${heading}`)
      expect(index, `heading ${heading}`).toBeGreaterThan(-1)
      expect(index, `order of ${heading}`).toBeGreaterThan(last)
      last = index
    }
  })

  it('the second wrapper loads the design document', () => {
    expect(designSkill.startsWith('---\n')).toBe(true)
    expect(designSkill).toMatch(/^name: hr-hub-frontend-design$/m)
    expect(designSkill).toMatch(/^description: .*(design|typography|colour|motion).*/m)
    expect(designSkill).toContain('docs/ai/frontend-design.md')
  })

  it('fails when AGENTS.md loses the mandatory rule', () => {
    const withoutRule = agents.replace(MANDATORY_RULE, 'Make it look nice.')
    const problems = checkUiSkill(fixtureReader({ 'AGENTS.md': withoutRule }))
    expect(problems.join('\n')).toMatch(/AGENTS\.md does not contain the mandatory UI rule/)
  })

  it('fails when a design document heading goes missing', () => {
    const withoutHeading = designDoc.replace('## G. Performance budget\n', '')
    const problems = checkUiSkill(fixtureReader({ 'frontend-design.md': withoutHeading }))
    expect(problems.join('\n')).toMatch(/missing the heading "## G\. Performance budget"/)
  })

  it('fails when the plain Markdown copy loses a section', () => {
    const withoutSectionSeven = uiDoc.replace(/^## 7\. .+$/m, '')
    const problems = checkUiSkill(fixtureReader({ 'hr-hub-ui-motion.md': withoutSectionSeven }))
    expect(problems.join('\n')).toMatch(/hr-hub-ui-motion\.md is missing the section 7 heading/)
  })

  it('the CLI exits 0 on this repository', () => {
    const output = execFileSync(process.execPath, ['scripts/check-ui-skill.mjs'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(output).toContain('UI skill check passed')
  })
})
