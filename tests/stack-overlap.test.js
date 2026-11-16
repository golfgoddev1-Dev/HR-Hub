// The card stack swaps two cards in one slot, on /hr (the deck) and on /leave
// (the stack). Three source rules keep that honest:
//   - the ghost edges under the leave card are decoration: no text, aria-hidden,
//     and they never take a pointer;
//   - the outgoing card leaves the layout and stops taking pointers the moment
//     its exit starts, so a tap during the exit cannot land on the card going;
//   - only the arriving card paints words, so no second card's text is drawn
//     over the card being read.
// The rhythm is untouched: both exits still name the motion tokens the repo
// already uses, and no duration was written into these files.

import { describe, expect, it } from 'vitest'

import { readSource } from './helpers/read-source.js'

const HR = readSource('src/pages/HrHomePage.vue')
const LEAVE = readSource('src/pages/LeaveHomePage.vue')

function styles(source) {
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

const HR_CSS = styles(HR)
const LEAVE_CSS = styles(LEAVE)

/** The body of every rule whose selector list contains `selector`. */
function ruleBody(css, selector) {
  const wanted = selector.replace(/\s+/g, ' ')
  const rules = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
  return rules
    .filter((rule) => {
      const head = rule.slice(0, rule.indexOf('{'))
      return head
        .split(',')
        .map((part) => part.trim().replace(/\s+/g, ' '))
        .includes(wanted)
    })
    .map((rule) => rule.slice(rule.indexOf('{') + 1))
    .join('\n')
}

function zIndex(css, selector) {
  const match = /z-index:\s*(-?\d+)/.exec(ruleBody(css, selector))
  return match ? Number(match[1]) : NaN
}

describe('ghost edges', () => {
  it('render two empty, aria-hidden spans under the leave card', () => {
    const ghosts = [...LEAVE.matchAll(/<span class="stack-ghost[^"]*"[^>]*>([\s\S]*?)<\/span>/g)]
    expect(ghosts).toHaveLength(2)
    for (const [, inner] of ghosts) {
      expect(inner.trim()).toBe('')
    }
    for (const [tag] of ghosts) {
      expect(tag).toContain('aria-hidden="true"')
    }
  })

  it('never carry a word and never take a pointer', () => {
    expect(LEAVE).not.toMatch(/stack-ghost[^\n]*\{\{/)
    expect(ruleBody(LEAVE_CSS, '.stack-ghost')).toContain('pointer-events: none')
  })
})

describe('the outgoing card', () => {
  it('leaves the layout on the hr deck, so the swap stays in one box', () => {
    expect(ruleBody(HR_CSS, '.deck')).toContain('position: relative')
    const leaving = ruleBody(HR_CSS, '.deck-leave-active')
    expect(leaving).toContain('position: absolute')
    expect(leaving).toContain('inset: 0')
  })

  it('takes no pointer while it leaves, on either page', () => {
    expect(ruleBody(HR_CSS, '.deck-leave-active')).toContain('pointer-events: none')
    expect(ruleBody(LEAVE_CSS, '.stack-leave-active')).toContain('pointer-events: none')
  })

  it('paints no words while it leaves, on either page', () => {
    for (const selector of ['.deck-name', '.deck-desc', '.deck-foot']) {
      expect(ruleBody(HR_CSS, `.deck-leave-active ${selector}`)).toContain('opacity: 0')
    }
    for (const selector of ['.stack-top', '.stack-type', '.stack-facts']) {
      expect(ruleBody(LEAVE_CSS, `.stack-leave-active ${selector}`)).toContain('opacity: 0')
    }
  })

  it('sits under the arriving card', () => {
    expect(zIndex(HR_CSS, '.deck-card')).toBeGreaterThan(zIndex(HR_CSS, '.deck-leave-active'))
    expect(zIndex(LEAVE_CSS, '.stack-card')).toBeGreaterThan(zIndex(LEAVE_CSS, '.stack-leave-active'))
  })
})

describe('the rhythm', () => {
  it('still exits with the same motion token and no new duration', () => {
    const deck = ruleBody(HR_CSS, '.deck-leave-active')
    expect(deck).toContain('opacity var(--motion-hover) ease')
    expect(deck).toContain('transform var(--motion-hover) ease')
    expect(deck).not.toMatch(/\d+(?:\.\d+)?(?:ms|s)\b/)

    const stack = ruleBody(LEAVE_CSS, '.stack-leave-active')
    expect(stack).toContain('opacity var(--motion-route) var(--motion-ease)')
    expect(stack).toContain('transform var(--motion-route) var(--motion-ease)')
    expect(stack).not.toMatch(/\d+(?:\.\d+)?(?:ms|s)\b/)
  })
})
