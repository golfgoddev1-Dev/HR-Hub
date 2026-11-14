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
  GUARDED_FILES,
  MANDATORY_RULE,
  REPORT_RULE,
  SKILL_FILE,
  UI_DOC_FILE,
  checkUiSkill,
} from '../scripts/check-ui-skill.mjs'
import { readSource } from './helpers/read-source.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (file) => readSource(join(root, file))

const agents = read(AGENTS_FILE)
const claude = read(CLAUDE_FILE)
const uiDoc = read(UI_DOC_FILE)
const designDoc = read(DESIGN_DOC_FILE)
const uiWrapper = read(SKILL_FILE)
const designWrapper = read(DESIGN_SKILL_FILE)

const files = {
  'AGENTS.md': agents,
  'CLAUDE.md': claude,
  'docs/ai/hr-hub-ui-motion.md': uiDoc,
  'docs/ai/frontend-design.md': designDoc,
  'hr-hub-ui-motion/SKILL.md': uiWrapper,
  'hr-hub-frontend-design/SKILL.md': designWrapper,
}

function fixtureReader(overrides = {}) {
  return (file) => {
    const normalized = file.replace(/\\/g, '/')
    const key = Object.keys(files)
      .sort((a, b) => b.length - a.length)
      .find((name) => normalized.endsWith(name))
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
      for (const file of GUARDED_FILES) {
        expect(flat, `rule lists ${file}`).toContain(file)
      }
    }

    const firstSection = claude.match(/^##\s+(.+)$/m)
    expect(firstSection).not.toBeNull()
    expect(firstSection[1]).toMatch(/UI/)
    expect(claude.indexOf(firstSection[0])).toBeLessThan(claude.indexOf('Before changing any file'))
    expect(claude.replace(/\s+/g, ' ')).toContain('AGENTS.md')
  })

  it('the canonical rules are plain Markdown with all ten sections in order', () => {
    expect(uiDoc.startsWith('---')).toBe(false)
    let last = -1
    for (let n = 1; n <= 10; n += 1) {
      const index = uiDoc.indexOf(`## ${n}.`)
      expect(index, `section ${n}`).toBeGreaterThan(-1)
      expect(index, `order of section ${n}`).toBeGreaterThan(last)
      last = index
    }
    const flat = uiDoc.replace(/\s+/g, ' ')
    expect(flat).toContain('0.86')
    expect(flat).toContain('its own contrast measurement')
    expect(flat).toContain(
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

  it('both wrappers are short and point at their document', () => {
    expect(uiWrapper).toMatch(/^name: hr-hub-ui-motion$/m)
    expect(uiWrapper).toContain(UI_DOC_FILE)
    expect(uiWrapper).toMatch(/follow it fully/i)
    expect(uiWrapper.trimEnd().split('\n').length).toBeLessThanOrEqual(12)

    expect(designWrapper).toMatch(/^name: hr-hub-frontend-design$/m)
    expect(designWrapper).toContain(DESIGN_DOC_FILE)
    expect(designWrapper).toMatch(/^description: .*(design|typography|colour|motion).*$/m)
    expect(designWrapper.trimEnd().split('\n').length).toBeLessThanOrEqual(12)
  })

  it('fails when AGENTS.md loses the mandatory sentence', () => {
    const withoutSentence = agents.replace(
      'If a requested change conflicts with a rule, stop and ask instead of working around it.',
      ''
    )
    const problems = checkUiSkill(fixtureReader({ 'AGENTS.md': withoutSentence }))
    expect(problems.join('\n')).toMatch(/AGENTS\.md does not contain the mandatory UI rule/)
  })

  it('fails when a section of the canonical rules is removed', () => {
    const withoutSectionSeven = uiDoc.replace(/^## 7\. .+$/m, '')
    const problems = checkUiSkill(fixtureReader({ 'docs/ai/hr-hub-ui-motion.md': withoutSectionSeven }))
    expect(problems.join('\n')).toMatch(/hr-hub-ui-motion\.md is missing the heading "## 7\."/)
  })

  it('fails when a design document heading goes missing', () => {
    const withoutHeading = designDoc.replace('## G. Performance budget\n', '')
    const problems = checkUiSkill(fixtureReader({ 'docs/ai/frontend-design.md': withoutHeading }))
    expect(problems.join('\n')).toMatch(/missing the heading "## G\. Performance budget"/)
  })

  it('the CLI exits 0 on this repository', () => {
    const output = execFileSync(process.execPath, ['scripts/check-ui-skill.mjs'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(output).toContain('UI skill check passed')
  })
})
