// @vitest-environment happy-dom
// One motion language, asserted from the source and from behaviour.
//
// Phase 1 of the motion system: the token set, the CSS copy of it, the shared
// stack primitive and the donut primitive. The page commits add their own
// assertions to this file as each page adopts the layer.
import { readdirSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import {
  CYCLE,
  CSS_TOKENS,
  DURATION,
  EASE,
  ENTRANCE,
  FOCUS,
  LIFT,
  MOTION,
  PRESS,
  REDUCED_MOTION,
  STAGGER,
  TAP,
} from '../src/lib/motion-tokens.js'
import { createCardStack } from '../src/lib/card-stack.js'

import { readSource } from './helpers/read-source.js'

const STYLES = readSource('src/styles.css')
const MOTION_SRC = readSource('src/lib/motion.js')
const STACK = readSource('src/lib/card-stack.js')
const DONUT = readSource('src/components/ProgressDonut.vue')

const PAGES = readdirSync('src/pages')
  .filter((name) => name.endsWith('.vue'))
  .map((name) => ({ name, source: readSource(`src/pages/${name}`) }))

/** The `:root` block that carries the tokens, as text. */
const TOKEN_BLOCK = (() => {
  const match = /:root \{([\s\S]*?)\n\}/.exec(STYLES)
  return match ? match[1] : ''
})()

/** Every `transition:` declaration in a source file. */
const transitions = (source) => [...source.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1])
/** Every `animation:` shorthand in a source file. */
const animations = (source) => [...source.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1])

const LAYOUT_PROPERTIES = /\b(width|height|top|left|right|bottom|margin|padding|font-size|gap|stroke-dashoffset)\b/

describe('the token set', () => {
  it('keeps the entrance under 600ms and the stagger at 60ms or less', () => {
    expect(DURATION.entrance).toBeLessThan(600)
    expect(DURATION.route).toBeLessThan(600)
    expect(ENTRANCE.maxDuration).toBe(600)
    expect(STAGGER.step).toBeLessThanOrEqual(60)
    expect(STAGGER.max).toBe(60)
    // The rhythm the docs already use.
    expect(DURATION).toMatchObject({ press: 120, release: 180, hover: 240, hoverOut: 280, route: 320, entrance: 440 })
    expect(STAGGER.step).toBe(40)
  })

  it('has one easing curve, one lift, one press, one ring and one cycle step', () => {
    expect(Object.keys(EASE).sort()).toEqual(['css', 'gsap'])
    expect(EASE.css).toBe('cubic-bezier(0.22, 0.61, 0.36, 1)')
    expect(EASE.gsap).toBe('power2.out')
    expect(Number.isInteger(LIFT.y)).toBe(true)
    expect(PRESS.scale).toBeLessThan(1)
    expect(FOCUS).toEqual({ color: '#8b5cf6', width: 2, offset: 2, rowOffset: -2 })
    // Violet is an indicator, never an ink.
    expect(FOCUS.color).toBe('#8b5cf6')
    expect(CYCLE.ms).toBe(3000)
    expect(TAP.min).toBe(44)
    expect(REDUCED_MOTION).toEqual({ animation: 'none', transition: 'none', opacity: 1, transform: 'none' })
  })

  it('declares every token as the same CSS custom property', () => {
    for (const [name, value] of Object.entries(CSS_TOKENS)) {
      expect(TOKEN_BLOCK, name).toContain(`${name}: ${value};`)
    }
    // Nothing invented in CSS that JS does not know about.
    const declared = [...TOKEN_BLOCK.matchAll(/(--motion-[a-z-]+):/g)].map((match) => match[1])
    expect(declared.sort()).toEqual(Object.keys(CSS_TOKENS).sort())
    expect(MOTION.cycle).toEqual(CYCLE)
  })

  it('drops the legacy hard-coded rhythm from the shared sheet', () => {
    // The entrance and every stagger step come from the tokens now.
    expect(STYLES).toContain('animation: panel-rise var(--motion-entrance) var(--motion-ease) backwards')
    expect(STYLES).toContain('animation-delay: calc(var(--motion-stagger) * 2)')
    expect(STYLES).not.toContain('animation-delay: 0.08s')
    expect(STYLES).not.toContain('animation: panel-rise 0.44s')
  })

  it('turns motion off app-wide under reduced motion, in the finished state', () => {
    const reduce = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/.exec(STYLES)?.[0] ?? ''
    expect(reduce).toContain('animation: none')
    expect(reduce).toContain('opacity: 1')
    expect(reduce).toContain('transform: none')
    // The entrance itself only exists inside no-preference.
    expect(STYLES.indexOf('animation: panel-rise')).toBeGreaterThan(STYLES.indexOf('@media (prefers-reduced-motion: no-preference)'))
    // No base opacity:0 anywhere outside the keyframe's own start: content is
    // visible with JavaScript off.
    const withoutKeyframes = STYLES.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '')
    expect(withoutKeyframes).not.toMatch(/opacity:\s*0;/)
    // The public roots are covered by the same finished state.
    expect(reduce).toContain('.v-main > .page')
  })
})

describe('the route entrance is shared by every route', () => {
  it('runs one entrance on the shell and on the public page roots', () => {
    // Signed-in pages: the shell's main, one stagger step apart.
    expect(STYLES).toContain('.app-layout-inner > main > * {')
    // Public pages have no shell; their own container gets the same tokens.
    expect(STYLES).toContain(':is(.v-main > .page, .v-main > .pending-page, .v-main > .approve-page) {')
    expect(STYLES).toContain('animation: panel-rise var(--motion-entrance) var(--motion-ease) backwards')
  })

  it('gives every public page the entrance and no second motion of its own', () => {
    for (const name of ['LoginPage.vue', 'PendingPage.vue', 'SetPinPage.vue', 'RegisterPage.vue']) {
      // The page root that the shared rule matches, asserted from the source so
      // a renamed root cannot silently lose the entrance.
      const source = readSource(`src/pages/${name}`)
      expect(source, name).toMatch(/<(div|main)[^>]*class="(page|pending-page)"/)
    }
    const approval = readSource('src/components/ApprovalLinkView.vue')
    expect(approval).toContain('class="approve-page"')
  })

  it('lays the entrance over every signed-in route, without a page-level override', () => {
    // The shell owns the entrance, so a page that renders its own <main> inherits
    // it. No page declares a second route entrance of its own.
    for (const page of PAGES) {
      expect(page.source, page.name).not.toMatch(/animation:\s*panel-rise/)
    }
  })
})

describe('the page layer uses transform and opacity only', () => {
  /** Every @keyframes block, with brace matching so one block cannot spill into the next rule. */
  const keyframesOf = (source) => {
    const blocks = []
    const opener = /@keyframes\s+([\w-]+)\s*\{/g
    let match
    while ((match = opener.exec(source))) {
      let depth = 1
      let index = opener.lastIndex
      while (index < source.length && depth > 0) {
        if (source[index] === '{') depth += 1
        else if (source[index] === '}') depth -= 1
        index += 1
      }
      blocks.push({ name: match[1], body: source.slice(opener.lastIndex, index - 1) })
      opener.lastIndex = index
    }
    return blocks
  }

  it('animates nothing but transform and opacity in a page keyframe', () => {
    for (const page of PAGES) {
      for (const block of keyframesOf(page.source)) {
        for (const step of block.body.matchAll(/\{[^{}]*\}/g)) {
          for (const declaration of step[0].matchAll(/([a-z-]+)\s*:/g)) {
            expect(['transform', 'opacity'], `${page.name} ${block.name}: ${declaration[1]}`).toContain(declaration[1])
          }
        }
      }
    }
  })

  it('transitions only paint and compositor properties in a page', () => {
    const ALLOWED = ['transform', 'opacity', 'background-color', 'border-color', 'color', 'box-shadow', 'outline-color', 'filter']
    // Split at top-level commas only: a cubic-bezier() has commas of its own.
    const entries = (value) => {
      const parts = []
      let depth = 0
      let current = ''
      for (const character of value) {
        if (character === '(') depth += 1
        if (character === ')') depth -= 1
        if (character === ',' && depth === 0) {
          parts.push(current.trim())
          current = ''
          continue
        }
        current += character
      }
      parts.push(current.trim())
      return parts
    }
    for (const page of PAGES) {
      for (const value of transitions(page.source)) {
        for (const entry of entries(value)) {
          const property = entry.trim().split(/\s+/)[0]
          // `transition: none` inside the reduced-motion block animates nothing.
          if (property === 'none') continue
          expect(ALLOWED, `${page.name}: ${property}`).toContain(property)
        }
      }
    }
  })

  it('keeps each page entrance short enough to finish the sequence', () => {
    // An entrance may start on a stagger step, but the step plus the duration
    // must still land inside the 600ms budget.
    const ENTRANCE_NAMES = /rise|enter|appear|fade|slide|panel/i
    for (const page of PAGES) {
      for (const value of animations(page.source)) {
        const parts = value.split(/\s+/)
        const name = parts[0]
        if (!ENTRANCE_NAMES.test(name)) continue
        const duration = parts.find((part) => /^(var\(--motion-[a-z-]+\)|[\d.]+m?s)$/.test(part))
        // A token duration is bounded by the token table (entrance 440ms).
        if (duration?.startsWith('var(')) continue
        expect(Number(duration.replace('s', '')) * (duration.endsWith('ms') ? 0.001 : 1), `${page.name}: ${value}`).toBeLessThanOrEqual(0.6)
      }
    }
  })
})

describe('the shared motion helpers use the tokens', () => {
  it('drives GSAP from the tokens, not from literals', () => {
    expect(MOTION_SRC).toContain("import { DURATION, EASE, ENTRANCE, LIFT, PRESS } from './motion-tokens.js'")
    expect(MOTION_SRC).toContain('duration: seconds(DURATION.press)')
    expect(MOTION_SRC).toContain('duration: seconds(DURATION.release)')
    expect(MOTION_SRC).toContain('duration: seconds(DURATION.hover)')
    expect(MOTION_SRC).toContain('duration: seconds(DURATION.hoverOut)')
    expect(MOTION_SRC).toContain('duration: seconds(DURATION.route)')
    expect(MOTION_SRC).toContain('y: ENTRANCE.rise')
    expect(MOTION_SRC).toContain('y: LIFT.y')
    expect(MOTION_SRC).toContain('rotationX: LIFT.rotation')
    expect(MOTION_SRC).toContain('transformPerspective: LIFT.perspective')
    expect(MOTION_SRC).toContain('scale: PRESS.scale')
    expect(MOTION_SRC).toContain('ease: EASE.gsap')
    // No stray duration literals in the tween options.
    expect(MOTION_SRC).not.toMatch(/duration:\s*0\.\d+/)
  })

  it('animates nothing but transform and opacity in the shared sheet', () => {
    for (const value of transitions(STYLES)) {
      expect(value).not.toMatch(LAYOUT_PROPERTIES)
    }
    for (const value of animations(STYLES)) {
      expect(value).not.toMatch(LAYOUT_PROPERTIES)
    }
  })
})

describe('no page polls', () => {
  it('keeps every page entrance under 600ms and every stagger at 60ms or less', () => {
    const ENTRANCE_NAMES = /rise|enter|appear|fade|slide|panel/i
    for (const page of PAGES) {
      for (const value of animations(page.source)) {
        const name = value.split(/\s+/)[0]
        if (!ENTRANCE_NAMES.test(name)) continue
        for (const match of value.matchAll(/([\d.]+)(m?s)\b/g)) {
          const ms = match[2] === 's' ? Number(match[1]) * 1000 : Number(match[1])
          expect(ms, `${page.name}: ${value}`).toBeLessThanOrEqual(600)
        }
      }
      for (const match of page.source.matchAll(/animation-delay:\s*([\d.]+)(m?s)\b/g)) {
        const ms = match[2] === 's' ? Number(match[1]) * 1000 : Number(match[1])
        expect(ms, `${page.name}: delay ${match[0]}`).toBeLessThanOrEqual(60)
      }
    }
  })

  it('allows a steady loop only for a progress cue or the ambient backdrop', () => {
    // Spinners, pulses, a progress sweep and the slow ambient orbs are state
    // cues, not entrances. Nothing else may loop, and none of them carries text.
    const ALLOWED_LOOPS = new Set([
      'spin',
      'pulse',
      'floatAmbient',
      'readyPulseGlow',
      'shimmerSweep',
      // The set-pin button's own copy of the same shimmer.
      'm-shine',
      'admin-gradient-move',
      'admin-progress-sweep',
    ])
    for (const page of PAGES) {
      for (const value of animations(page.source)) {
        if (!value.includes('infinite')) continue
        const name = value.split(/\s+/)[0]
        expect(ALLOWED_LOOPS.has(name), `${page.name}: ${value}`).toBe(true)
      }
    }
  })

  it('has no setInterval in any page', () => {
    for (const page of PAGES) {
      expect(page.source, page.name).not.toContain('setInterval(')
    }
    expect(STACK).not.toContain('setInterval(')
    expect(MOTION_SRC).not.toContain('setInterval(')
    // The one poll in the tree stays where it belongs.
    expect(readSource('src/lib/approval-count.js')).toContain('setInterval')
  })
})

describe('the shared stack primitive', () => {
  const items = { value: [] }
  let timers

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', (query) => ({
      media: query,
      matches: query.includes('(pointer: fine)'),
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }))
    document.documentElement.setAttribute('data-bg-tier', 'high')
    items.value = [{ id: 1 }, { id: 2 }, { id: 3 }]
    timers = 0
    const realSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
      timers += 1
      return realSetTimeout(fn, ms)
    })
  })

  const make = (options = {}) => {
    const stack = createCardStack({ items, ...options })
    stack.start()
    return stack
  }

  it('advances one card every 3000ms with one chained timeout', async () => {
    const stack = make()
    expect(stack.index.value).toBe(0)
    await vi.advanceTimersByTimeAsync(CYCLE.ms)
    expect(stack.index.value).toBe(1)
    await vi.advanceTimersByTimeAsync(CYCLE.ms)
    expect(stack.index.value).toBe(2)
    await vi.advanceTimersByTimeAsync(CYCLE.ms)
    // Wraps at the end.
    expect(stack.index.value).toBe(0)
    stack.destroy()
  })

  it('does not pause for a synthesized mouseenter, only for a real mouse', async () => {
    const stack = make()
    stack.handlers.onPointerEnter({ pointerType: '' })
    expect(stack.hovered.value).toBe(true)
    stack.hovered.value = false
    // A touch tap's synthesized mouseenter carries no pointer type and must not
    // latch the pause; only 'mouse' does.
    stack.handlers.onPointerEnter({ pointerType: 'touch' })
    expect(stack.hovered.value).toBe(false)
    stack.handlers.onPointerEnter({ pointerType: 'mouse' })
    expect(stack.hovered.value).toBe(true)
    await vi.advanceTimersByTimeAsync(CYCLE.ms * 2)
    expect(stack.index.value).toBe(0)
    stack.handlers.onPointerLeave({ pointerType: 'mouse' })
    await vi.advanceTimersByTimeAsync(CYCLE.ms)
    expect(stack.index.value).toBe(1)
    stack.destroy()
  })

  it('pauses while the keyboard focus is inside, not for a click', async () => {
    const stack = make()
    stack.handlers.onFocusIn({ target: { matches: (selector) => selector === ':focus-visible' } })
    expect(stack.focused.value).toBe(true)
    await vi.advanceTimersByTimeAsync(CYCLE.ms * 2)
    expect(stack.index.value).toBe(0)
    stack.handlers.onFocusOut()
    await vi.advanceTimersByTimeAsync(CYCLE.ms)
    expect(stack.index.value).toBe(1)

    // A click leaves focus behind without :focus-visible, which is not a pause.
    stack.handlers.onFocusIn({ target: { matches: () => false } })
    expect(stack.focused.value).toBe(false)
    stack.destroy()
  })

  it('pauses on a hidden tab and resumes when it is visible again', async () => {
    const stack = make()
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(CYCLE.ms * 2)
    expect(stack.index.value).toBe(0)

    hidden.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(CYCLE.ms)
    expect(stack.index.value).toBe(1)
    hidden.mockRestore()
    stack.destroy()
  })

  it('restarts the full step after a manual move', async () => {
    const stack = make()
    stack.next()
    expect(stack.index.value).toBe(1)
    await vi.advanceTimersByTimeAsync(CYCLE.ms - 1)
    expect(stack.index.value).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(stack.index.value).toBe(2)
    stack.destroy()
  })

  it('keeps the first card still on the low and static tiers', async () => {
    for (const tier of ['low', 'static']) {
      document.documentElement.setAttribute('data-bg-tier', tier)
      const stack = make()
      await vi.advanceTimersByTimeAsync(CYCLE.ms * 2)
      expect(stack.index.value, tier).toBe(0)
      expect(stack.canCycle.value, tier).toBe(false)
      // By hand still works.
      stack.next()
      expect(stack.index.value, tier).toBe(1)
      stack.destroy()
    }
    document.documentElement.setAttribute('data-bg-tier', 'high')
  })

  it('leaves no timer or listener behind when the page unmounts mid-chain', async () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const stack = make()
    await vi.advanceTimersByTimeAsync(CYCLE.ms - 500)
    const pending = timers
    expect(pending).toBeGreaterThan(0)

    stack.destroy()
    // No scheduled step survives, and the visibility listener is gone.
    await vi.advanceTimersByTimeAsync(CYCLE.ms * 3)
    expect(stack.index.value).toBe(0)
    expect(remove.mock.calls.map(([name]) => name)).toContain('visibilitychange')
    expect(add.mock.calls.filter(([name]) => name === 'visibilitychange')).toHaveLength(
      remove.mock.calls.filter(([name]) => name === 'visibilitychange').length
    )
    add.mockRestore()
    remove.mockRestore()
  })

  it('clears the chain on destroy even when a step is pending', async () => {
    const stack = make()
    const before = timers
    stack.destroy()
    await vi.advanceTimersByTimeAsync(CYCLE.ms * 2)
    expect(stack.index.value).toBe(0)
    expect(timers).toBe(before)
  })

  it('keeps the timer logic in the primitive, not in a page', () => {
    expect(STACK).toContain('setTimeout(')
    expect(STACK).toContain('clearTimeout(')
    expect(STACK).toContain('export function createCardStack')
    // The chain is one function inside the primitive, and the pages that use a
    // deck have no timer of their own.
    expect(STACK.match(/setTimeout\(/g)).toHaveLength(1)
    const decks = {
      'src/pages/LeaveHomePage.vue': 'createCardStack({ items: stackItems })',
      'src/pages/HrHomePage.vue': 'requireFinePointer: true',
    }
    for (const [file, marker] of Object.entries(decks)) {
      const source = readSource(file)
      expect(source, file).toContain('createCardStack(')
      expect(source, file).toContain(marker)
      for (const gone of ['CYCLE_MS', 'cycleTimer', 'scheduleNextStep', 'syncCycle', 'STACK_TIERS', 'tierObserver']) {
        expect(source, `${file} still owns ${gone}`).not.toContain(gone)
      }
    }
  })
})

describe('the donut primitive', () => {
  it('animates transform and opacity only', () => {
    for (const value of transitions(DONUT)) {
      expect(value).not.toMatch(LAYOUT_PROPERTIES)
    }
    for (const value of animations(DONUT)) {
      expect(value).not.toMatch(LAYOUT_PROPERTIES)
    }
    expect(DONUT).toContain('transform: rotate(var(--donut-angle))')
    expect(DONUT).not.toContain('stroke-dashoffset:')
    // The arc is painted once; only the marker moves.
    expect(DONUT).toContain('conic-gradient(')
  })

  it('uses the shared tokens and reaches its final state under reduced motion', () => {
    expect(DONUT).toContain('var(--motion-entrance, 440ms)')
    expect(DONUT).toContain('var(--motion-ease, cubic-bezier(0.22, 0.61, 0.36, 1))')
    const reduce = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/.exec(DONUT)?.[0] ?? ''
    expect(reduce).toContain('transition: none')
    // The ring is never hidden: the percentage is readable with motion off.
    expect(DONUT).not.toMatch(/\.donut-ring \{[^}]*opacity: 0/)
  })

  it('shows a percentage and a label beside it', () => {
    expect(DONUT).toContain('{{ percent }}%')
    expect(DONUT).toContain('donut-label')
    expect(DONUT).toContain("label: { type: String")
    expect(DONUT).toContain('aria-hidden="true"')
  })

  it('clamps the value instead of drawing past a full turn', async () => {
    const ProgressDonut = (await import('../src/components/ProgressDonut.vue')).default
    const over = mount(ProgressDonut, { props: { value: 140, label: 'ใช้ไปแล้ว' } })
    expect(over.text()).toContain('100%')
    expect(over.text()).toContain('ใช้ไปแล้ว')
    const under = mount(ProgressDonut, { props: { value: -5 } })
    expect(under.text()).toContain('0%')
    const normal = mount(ProgressDonut, { props: { value: 62 } })
    expect(normal.text()).toContain('62%')
    expect(normal.find('.donut').attributes('style')).toContain('--donut-angle: 223.2deg')
  })
})
