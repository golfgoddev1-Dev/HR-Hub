import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CLAUDE_FILE,
  MANDATORY_RULE,
  REPORT_RULE,
  SECTION_COUNT,
  SKILL_FILE,
  checkUiSkill,
  sectionHeading,
} from '../scripts/check-ui-skill.mjs'
import { readSource } from './helpers/read-source.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const claude = readSource(join(root, CLAUDE_FILE))
const skill = readSource(join(root, SKILL_FILE))

const fixtureReader = (claudeText, skillText) => (file) => {
  if (file.endsWith(CLAUDE_FILE)) return claudeText
  if (file.endsWith('SKILL.md')) return skillText
  throw new Error(`unexpected read: ${file}`)
}

describe('UI skill guard', () => {
  it('passes on this repository', () => {
    expect(checkUiSkill()).toEqual([])
  })

  it('CLAUDE.md carries the mandatory rule as its first section', () => {
    const flat = claude.replace(/\s+/g, ' ')
    expect(flat).toContain(MANDATORY_RULE.replace(/\s+/g, ' '))
    expect(flat).toContain(REPORT_RULE.replace(/\s+/g, ' '))

    const firstSection = claude.match(/^##\s+(.+)$/m)
    expect(firstSection).not.toBeNull()
    expect(firstSection[1]).toMatch(/UI/)
    expect(claude.indexOf(firstSection[0])).toBeLessThan(claude.indexOf('Before you change any file'))
  })

  it('the skill is named, says when it applies, and has all ten sections', () => {
    expect(skill.startsWith('---\n')).toBe(true)
    expect(skill).toMatch(/^name: hr-hub-ui-motion$/m)
    expect(skill).toMatch(/^description: .*src\/pages.*src\/components.*src\/styles\.css/m)
    expect(skill).toMatch(/src\/lib\/background-scene\.js/)
    expect(skill).toMatch(/src\/lib\/motion\.js/)
    expect(skill).toMatch(/src\/lib\/background-quality\.js/)

    for (let n = 1; n <= SECTION_COUNT; n += 1) {
      expect(sectionHeading(n).test(skill), `section ${n} heading`).toBe(true)
    }

    // A bare heading is not a section: every one of them must carry rules.
    const bodies = skill.split(/^## /m).slice(1)
    expect(bodies).toHaveLength(SECTION_COUNT)
    for (const body of bodies) {
      expect(body.length).toBeGreaterThan(400)
    }
  })

  it('fails when CLAUDE.md loses the mandatory rule', () => {
    const withoutRule = claude.replace(MANDATORY_RULE, 'Make it look nice.')
    const problems = checkUiSkill(fixtureReader(withoutRule, skill))
    expect(problems.join('\n')).toMatch(/mandatory UI skill rule/)
  })

  it('fails when the skill loses a numbered section', () => {
    const withoutSectionSeven = skill.replace(/^## 7\. .+$/m, '')
    const problems = checkUiSkill(fixtureReader(claude, withoutSectionSeven))
    expect(problems.join('\n')).toMatch(/section 7 heading/)
  })

  it('the CLI exits 0 on this repository', () => {
    const output = execFileSync(process.execPath, ['scripts/check-ui-skill.mjs'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(output).toContain('UI skill check passed')
  })
})
