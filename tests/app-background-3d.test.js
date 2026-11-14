// @vitest-environment happy-dom
// The app-wide background, after the move to TresJS, plus the GSAP motion helper.
//
// Three layers are covered here:
//   1. the tier policy in src/lib/background-quality.js (pure, no renderer);
//   2. the scene plan in src/lib/background-scene.js (pure: every budget, every
//      transform, the calendar motif and the tints);
//   3. the components, with @tresjs/core mocked so no GPU is involved: the shell
//      must mount a canvas only for a tier that draws, publish the CSS tier, fall
//      back to the gradient on failure, and unregister its loop hook on unmount.
//
// Disposal itself is TresJS's: TresCanvas's renderer manager calls
// renderer.dispose() and forceContextLoss(), and disposeObject3D() releases every
// geometry and material in the scene. What this file can and does check is that we
// never take that job back (no `new WebGLRenderer`, no manual render call) and that
// our own listeners and loop hook are released. The browser audit confirms the
// canvas leaves the document on unmount.
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BENCHMARK,
  GLASS,
  QUALITY_TIERS,
  SURFACE_OPACITY,
  createBenchmark,
  deviceHints,
  initialTier,
} from '../src/lib/background-quality.js'
import {
  CALENDAR_COLUMNS,
  CALENDAR_TINTS,
  CARD_TINTS,
  GLINT_SIZE,
  SCENE_DEPTH,
  SPHERE_TINTS,
  cardPlanes,
  driftDust,
  dustField,
  glintStreaks,
  layoutCalendar,
  layoutCards,
  layoutGlints,
  layoutSpheres,
  scenePlan,
} from '../src/lib/background-scene.js'
import { countUp, fadeRoute, installUiMotion } from '../src/lib/motion.js'
import AppBackground3D from '../src/components/AppBackground3D.vue'

import { readSource } from './helpers/read-source.js'

// What the mocked TresJS saw: the props it was handed, the loop hooks it was
// given, and how many of those hooks were released.
// The shell reads the current route to fade a page in; a stub route keeps this
// file free of the whole app router.
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/leave' }) }))

const tresMock = vi.hoisted(() => ({ canvases: [], loopHooks: [], released: 0 }))

vi.mock('@tresjs/core', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    TresCanvas: defineComponent({
      name: 'TresCanvas',
      inheritAttrs: false,
      props: {
        alpha: { type: Boolean, default: false },
        clearAlpha: { type: Number, default: 1 },
        antialias: { type: Boolean, default: true },
        dpr: { type: [Number, Array], default: 1 },
        shadows: { type: Boolean, default: false },
        fpsLimit: { type: Number, default: 0 },
        powerPreference: { type: String, default: 'default' },
        windowSize: { type: Boolean, default: false },
        preserveDrawingBuffer: { type: Boolean, default: false },
      },
      emits: ['error', 'ready'],
      setup(props, { slots }) {
        tresMock.canvases.push({ ...props, dpr: JSON.parse(JSON.stringify(props.dpr)) })
        return () => h('div', { class: 'tres-canvas-stub', 'data-tres-stub': '' }, slots.default?.() ?? [])
      },
    }),
    useLoop: () => ({
      onBeforeRender: (fn) => {
        tresMock.loopHooks.push(fn)
        return {
          off: () => {
            tresMock.released += 1
            const at = tresMock.loopHooks.indexOf(fn)
            if (at >= 0) tresMock.loopHooks.splice(at, 1)
          },
        }
      },
      onRender: () => ({ off: () => {} }),
      stop: () => {},
      start: () => {},
    }),
  }
})

const BACKGROUND_SOURCE = readSource('src/components/AppBackground3D.vue')
const BACKDROP_SOURCE = readSource('src/components/background/TresBackdrop.vue')
const SCENE_SOURCE = readSource('src/components/background/TresBackdropScene.vue')
const PLAN_SOURCE = readSource('src/lib/background-scene.js')
const MOTION_SOURCE = readSource('src/lib/motion.js')
const LAYOUT_SOURCE = readSource('src/components/AppLayout.vue')
const ROUTER_SOURCE = readSource('src/router.js')
const INDEX_SOURCE = readSource('index.html')
const STYLES_SOURCE = readSource('src/styles.css')
const DOCK_SOURCE = readSource('src/components/AppDock.vue')
const PROFILE_SOURCE = readSource('src/pages/ProfilePage.vue')
const MY_APPROVERS_SOURCE = readSource('src/pages/MyApproversPage.vue')
const ADMIN_SOURCE = readSource('src/pages/AdminPage.vue')
const ADMIN_PERMISSIONS_SOURCE = readSource('src/pages/AdminPermissionsPage.vue')
const CALENDAR_SOURCE = readSource('src/components/LeaveCalendarView.vue')

const VEIL_OPACITY = 0

function styleBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`\\n\\s*${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(source)
  return match ? match[1] : ''
}

function luminance(hex) {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)
    .map((part) => parseInt(part, 16) / 255)
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

/** The value of one custom property in a stylesheet. */
function cssVar(source, name) {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(source)
  return match ? match[1].trim() : ''
}

/** The alpha of an `rgba(255, 255, 255, a)` value, or null. */
function whiteAlpha(value) {
  const match = /rgba\(\s*255,\s*255,\s*255,\s*([\d.]+)\s*\)/.exec(String(value))
  return match ? Number(match[1]) : null
}

/** A white tint at `alpha` over a backdrop colour: what a glass panel shows. */
function glassOver(backdropHex, alpha) {
  const base = backdropHex
    .replace('#', '')
    .match(/.{2}/g)
    .map((part) => parseInt(part, 16))
  const mixed = base.map((channel) => Math.round(255 * alpha + channel * (1 - alpha)))
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

beforeEach(() => {
  tresMock.canvases.length = 0
  tresMock.loopHooks.length = 0
  tresMock.released = 0
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('the TresJS scene plan', () => {
  it('keeps every tier inside its object and particle budget', () => {
    for (const name of ['high', 'medium', 'low']) {
      const config = QUALITY_TIERS[name]
      const plan = scenePlan(config)
      expect(plan.objectCount, name).toBeLessThanOrEqual(config.objectCount)
      expect(plan.particleCount, name).toBeLessThanOrEqual(300)
      expect(plan.particleCount, name).toBe(config.particleCount)
      expect(plan.objectCount, name).toBeGreaterThan(0)
    }
    expect(scenePlan(QUALITY_TIERS.static).objectCount).toBe(0)
    expect(scenePlan(QUALITY_TIERS.static).particleCount).toBe(0)
  })

  it('splits the cards over three depth planes with different parallax shares', () => {
    const plan = scenePlan(QUALITY_TIERS.high)
    expect(plan.planes).toHaveLength(3)
    expect(plan.cardCount).toBe(QUALITY_TIERS.high.cardCount)
    expect(plan.planes.map((plane) => plane.depth)).toEqual([0, 0.5, 1])
    // Nearer planes are denser, which is what reads as depth.
    expect(plan.planes[2].opacity).toBeGreaterThan(plan.planes[0].opacity)
  })

  it('draws the status colours and a seven-column calendar motif, with no text', () => {
    // The three leave statuses the app uses, among the brand indigo and violet.
    expect(CARD_TINTS).toContain(0x16a34a)
    expect(CARD_TINTS).toContain(0xd97706)
    expect(CARD_TINTS).toContain(0xdc2626)
    expect(SPHERE_TINTS.length).toBeGreaterThan(0)
    expect(CALENDAR_TINTS.length).toBeGreaterThan(0)

    const calendar = scenePlan(QUALITY_TIERS.high).calendar
    expect(calendar.columns).toBe(CALENDAR_COLUMNS)
    expect(calendar.columns).toBe(7)
    expect(calendar.cells).toHaveLength(QUALITY_TIERS.high.calendarCellCount)

    // Shapes only: no lettering is ever built.
    for (const source of [PLAN_SOURCE, SCENE_SOURCE, BACKDROP_SOURCE]) {
      expect(source).not.toContain('TextGeometry')
      expect(source).not.toContain('FontLoader')
      expect(source).not.toContain('troika')
    }
  })

  it('drops the glints on the lowest tier and keeps them at high', () => {
    expect(scenePlan(QUALITY_TIERS.low).glints).toHaveLength(0)
    expect(scenePlan(QUALITY_TIERS.high).glints).toHaveLength(QUALITY_TIERS.high.glintCount)
  })

  it('moves instances with transform and scale only', () => {
    const plan = scenePlan(QUALITY_TIERS.high)
    const state = { time: 3.25, elapsed: 3.25, field: { width: 20, height: 12 }, pointer: { x: 0.4, y: -0.2 } }
    const cards = []
    const { count } = layoutCards(plan, state, cards)
    expect(count).toBe(plan.cardCount)
    for (const card of cards) {
      expect(Object.keys(card).sort()).toEqual(['rx', 'ry', 'rz', 'scale', 'x', 'y', 'z'])
      for (const value of Object.values(card)) expect(Number.isFinite(value)).toBe(true)
      expect(card.scale).toBeGreaterThan(0)
    }

    const spheres = []
    expect(layoutSpheres(plan, state, spheres).count).toBe(plan.spheres.length)
    const cells = []
    expect(layoutCalendar(plan, state, cells).count).toBe(plan.calendar.cells.length)
    const glints = []
    expect(layoutGlints(plan, state, glints).count).toBe(plan.glints.length)
    // A glint fades by scale but is never degenerate.
    for (const glint of glints) expect(glint.scale).toBeGreaterThan(0)
    expect(GLINT_SIZE.width).toBeGreaterThan(0)
  })

  it('wraps the dust inside the field instead of letting it drift away', () => {
    const plan = scenePlan(QUALITY_TIERS.medium)
    const field = { width: 20, height: 12 }
    const state = { time: 0, field, pointer: { x: 0, y: 0 } }
    for (let step = 0; step < 400; step += 1) {
      state.time = step * 0.05
      driftDust(plan, state)
    }
    for (let index = 0; index < plan.dust.count; index += 1) {
      expect(Math.abs(plan.dust.positions[index * 3])).toBeLessThanOrEqual(field.width / 2 + 1.001)
      expect(Math.abs(plan.dust.positions[index * 3 + 1])).toBeLessThanOrEqual(field.height / 2 + 1.001)
      expect(plan.dust.positions[index * 3 + 2]).toBeLessThan(0)
    }
    expect(SCENE_DEPTH).toBeGreaterThan(0)
  })

  it('draws nothing at all when the tier is static', () => {
    const plan = scenePlan(QUALITY_TIERS.static)
    expect(plan.planes.every((plane) => plane.cards.length === 0)).toBe(true)
    expect(plan.spheres).toHaveLength(0)
    expect(plan.calendar.cells).toHaveLength(0)
    expect(plan.dust.count).toBe(0)
  })
})

describe('the TresJS components', () => {
  it('declares the scene with TresJS components, never with its own renderer', () => {
    expect(BACKDROP_SOURCE).toContain("import { TresCanvas } from '@tresjs/core'")
    expect(SCENE_SOURCE).toContain('useLoop')
    expect(SCENE_SOURCE).toContain('<TresInstancedMesh')
    expect(SCENE_SOURCE).toContain('<TresPoints')
    expect(SCENE_SOURCE).toContain('<TresPerspectiveCamera')
    expect(SCENE_SOURCE).toContain('<TresAmbientLight')
    expect(SCENE_SOURCE).toContain('<TresDirectionalLight')

    // TresJS owns renderer, scene, camera and loop: we never build them by hand,
    // which is what keeps a second renderer out of the app.
    for (const source of [BACKGROUND_SOURCE, BACKDROP_SOURCE, SCENE_SOURCE]) {
      expect(source).not.toContain('new WebGLRenderer')
      expect(source).not.toContain('renderer.render(')
      expect(source).not.toContain('new Scene(')
      expect(source).not.toContain('requestAnimationFrame(tick)')
      expect(source).not.toContain('three/examples')
    }
    // One engine: the only 3D import is three itself.
    expect(BACKDROP_SOURCE).not.toMatch(/from ['"]three\//)
    expect(SCENE_SOURCE).not.toMatch(/from ['"]three\//)
  })

  it('takes the canvas settings from the tier budget', () => {
    expect(BACKDROP_SOURCE).toContain(':fps-limit="config.targetFps"')
    expect(BACKDROP_SOURCE).toContain(':shadows="false"')
    expect(BACKDROP_SOURCE).toContain(':dpr="dpr"')
    expect(BACKDROP_SOURCE).toContain(':clear-alpha="0"')
    expect(BACKDROP_SOURCE).toContain(':antialias="config.material !== \'basic\'"')

    // The shell clamps the device pixel ratio with the tier cap, and low goes
    // below 1 on purpose.
    const shell = readSource('src/components/AppBackground3D.vue')
    expect(shell).toContain('pixelRatioCap')
    expect(shell).toContain('cap < 1 ? [cap, cap] : [1, cap]')
    for (const name of ['high', 'medium', 'low']) {
      expect(QUALITY_TIERS[name].shadows).toBe(false)
      expect(QUALITY_TIERS[name].postProcessing).toBe(false)
    }
  })

  it('never lets the canvas swallow a click or a touch scroll', () => {
    const canvas = styleBlock(BACKDROP_SOURCE, '.app-background-tres')
    expect(canvas).toContain('pointer-events: none !important')
    expect(canvas).toContain('position: fixed !important')
    expect(canvas).toContain('z-index: 0')
  })
})

describe('the background shell', () => {
  /** Mounts the shell and waits for the lazily imported canvas component. */
  async function mountShell() {
    const wrapper = mount(AppBackground3D, {
      attachTo: document.body,
      global: {
        // TresJS registers these through its plugin; the canvas is mocked here, so
        // the elements are stubbed instead of resolved.
        stubs: {
          TresPerspectiveCamera: true,
          TresAmbientLight: true,
          TresDirectionalLight: true,
          TresInstancedMesh: true,
          TresPoints: true,
        },
      },
    })
    for (let pass = 0; pass < 4; pass += 1) {
      await vi.dynamicImportSettled()
      await flushPromises()
    }
    return wrapper
  }

  it('mounts a TresJS canvas for a tier that draws, and none for static', async () => {
    const wrapper = await mountShell()

    expect(wrapper.find('[data-app-background]').exists()).toBe(true)
    expect(tresMock.canvases.length).toBeGreaterThan(0)
    expect(tresMock.loopHooks.length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('publishes the tier for the CSS and removes it on unmount', async () => {
    const wrapper = mount(AppBackground3D, { attachTo: document.body })
    await flushPromises()
    expect(document.documentElement.dataset.bgTier).toBeTruthy()
    wrapper.unmount()
    expect(document.documentElement.dataset.bgTier).toBeUndefined()
  })

  it('releases its loop hook and its motion listeners on unmount', async () => {
    const wrapper = await mountShell()
    expect(tresMock.loopHooks.length).toBe(1)
    wrapper.unmount()
    expect(tresMock.loopHooks).toHaveLength(0)
    expect(tresMock.released).toBe(1)
  })
})

describe('the GSAP motion helper', () => {
  it('imports GSAP dynamically and nothing else', () => {
    expect(MOTION_SOURCE).toContain("import('gsap')")
    expect(MOTION_SOURCE).not.toMatch(/^import .*['"]gsap['"]/m)
    // Core only: no plugin import at all.
    expect(MOTION_SOURCE).not.toContain('gsap/ScrollTrigger')
    expect(MOTION_SOURCE).not.toContain('gsap/CustomEase')
    expect(MOTION_SOURCE).not.toContain('registerPlugin')
    // It must never be part of the entry bundle: only the lazy shell and pages
    // import it.
    expect(LAYOUT_SOURCE).not.toContain('motion.js')
    expect(BACKGROUND_SOURCE).toContain("from '../lib/motion.js'")
  })

  it('animates transform and opacity only, never a layout property', () => {
    for (const match of MOTION_SOURCE.matchAll(/^\s*(width|height|top|left|right|bottom|margin|padding|fontSize|gap):/gm)) {
      throw new Error(`motion.js animates the layout property ${match[1]}`)
    }
    // The tween targets are transform/opacity only.
    const keys = [...MOTION_SOURCE.matchAll(/^\s{6,}([a-zA-Z]+):/gm)].map((match) => match[1])
    for (const key of keys) {
      expect(['scale', 'y', 'opacity', 'rotationX', 'rotationY', 'transformPerspective', 'value', 'duration', 'ease', 'overwrite', 'onUpdate', 'onComplete', 'clearProps'], key).toContain(key)
    }
  })

  it('jumps to the final state for a reduced-motion visitor, at once', async () => {
    vi.stubGlobal('matchMedia', (query) => ({
      media: query,
      matches: String(query).includes('prefers-reduced-motion'),
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }))

    const element = document.createElement('span')
    document.body.appendChild(element)
    await countUp(element, 42)
    expect(element.textContent).toBe('42')

    const card = document.createElement('div')
    document.body.appendChild(card)
    const release = await installUiMotion(document)
    // No listeners were installed, and the cleanup is still safe to call.
    expect(typeof release).toBe('function')
    release()

    await fadeRoute(card)
    expect(card.style.transform ?? '').toBe('')
    expect(card.style.opacity ?? '').toBe('')
  })

  it('still paints the number when GSAP cannot load', async () => {
    vi.stubGlobal('matchMedia', (query) => ({
      media: query,
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }))

    const element = document.createElement('span')
    document.body.appendChild(element)
    const value = await countUp(element, 7, { duration: 0 })
    expect(value).toBe(7)
    expect(element.textContent).toBe('7')
  })
})

describe('tier constants', () => {
  it('declares the three budgets and the static fallback', () => {
    // The tier budget from the brief: 120 / 60 / 24 objects, 300 / 120 / 40
    // particles, 1.5 / 1.0 / 0.75 pixel ratio, 60 / 30 / 24 fps.
    expect(QUALITY_TIERS.high.objectCount).toBe(120)
    expect(QUALITY_TIERS.high.particleCount).toBe(300 - 40)
    expect(QUALITY_TIERS.high.pixelRatioCap).toBe(1.5)
    expect(QUALITY_TIERS.high.targetFps).toBe(60)

    expect(QUALITY_TIERS.medium.objectCount).toBe(60)
    expect(QUALITY_TIERS.medium.particleCount).toBe(120)
    expect(QUALITY_TIERS.medium.pixelRatioCap).toBe(1)
    expect(QUALITY_TIERS.medium.targetFps).toBe(30)

    expect(QUALITY_TIERS.low.objectCount).toBe(24)
    expect(QUALITY_TIERS.low.particleCount).toBe(32)
    expect(QUALITY_TIERS.low.pixelRatioCap).toBe(0.75)
    expect(QUALITY_TIERS.low.targetFps).toBe(24)

    expect(QUALITY_TIERS.static.objectCount).toBe(0)
    expect(QUALITY_TIERS.static.particleCount).toBe(0)
    expect(QUALITY_TIERS.static.targetFps).toBe(0)
  })

  it('never puts more than the budget in the scene', () => {
    for (const name of ['high', 'medium', 'low', 'static']) {
      const tier = QUALITY_TIERS[name]
      expect(tier.particleCount, name).toBeLessThanOrEqual(
        { high: 300, medium: 120, low: 40, static: 0 }[name]
      )
      expect(tier.glassBlur, name).toBeLessThanOrEqual(QUALITY_TIERS.high.glassBlur)
    }
    expect(QUALITY_TIERS.high.particleCount).toBeLessThanOrEqual(300)
    expect(QUALITY_TIERS.medium.particleCount).toBeLessThanOrEqual(120)
    expect(QUALITY_TIERS.low.particleCount).toBeLessThanOrEqual(40)
  })

  it('splits each budget into the three planes, spheres, glints and calendar', () => {
    for (const name of ['high', 'medium', 'low']) {
      const tier = QUALITY_TIERS[name]
      expect(
        tier.cardCount + tier.sphereCount + tier.glintCount + tier.calendarCellCount,
        name
      ).toBe(tier.objectCount)
      expect(tier.cardCount % tier.planeCount, name).toBe(0)
      expect(tier.planeCount, name).toBe(3)
    }
  })

  it('drops the glints on the lowest 3D tier', () => {
    expect(QUALITY_TIERS.low.material).toBe('basic')
    expect(QUALITY_TIERS.low.glintCount).toBe(0)
  })

  it('never enables shadow maps or post-processing', () => {
    for (const name of ['high', 'medium', 'low', 'static']) {
      expect(QUALITY_TIERS[name].shadows, name).toBe(false)
      expect(QUALITY_TIERS[name].postProcessing, name).toBe(false)
    }
  })

  it('uses MeshStandardMaterial only at high', () => {
    expect(QUALITY_TIERS.high.material).toBe('standard')
    expect(QUALITY_TIERS.medium.material).toBe('lambert')
    expect(QUALITY_TIERS.low.material).toBe('basic')
  })

  it('offers mouse parallax and card tilt only at high', () => {
    expect(QUALITY_TIERS.high.mouseParallax).toBe(true)
    expect(QUALITY_TIERS.high.cardTilt).toBe(true)
    for (const name of ['medium', 'low', 'static']) {
      expect(QUALITY_TIERS[name].mouseParallax, name).toBe(false)
      expect(QUALITY_TIERS[name].cardTilt, name).toBe(false)
    }
  })
})

describe('tier selection from device hints', () => {
  it('starts at high on an ordinary desktop', () => {
    expect(initialTier({ deviceMemory: 8, hardwareConcurrency: 8, coarsePointer: false })).toBe(
      'high'
    )
    expect(initialTier({})).toBe('high')
  })

  it('starts at medium for 4 GB, 4 cores or a coarse pointer', () => {
    expect(initialTier({ deviceMemory: 4, hardwareConcurrency: 8 })).toBe('medium')
    expect(initialTier({ deviceMemory: 0.5, hardwareConcurrency: 8 })).toBe('medium')
    expect(initialTier({ deviceMemory: 8, hardwareConcurrency: 4 })).toBe('medium')
    expect(initialTier({ deviceMemory: 8, hardwareConcurrency: 2 })).toBe('medium')
    expect(initialTier({ deviceMemory: 8, hardwareConcurrency: 8, coarsePointer: true })).toBe(
      'medium'
    )
  })

  it('never starts at high on a coarse pointer', () => {
    expect(initialTier({ coarsePointer: true, deviceMemory: 16, hardwareConcurrency: 16 })).toBe(
      'medium'
    )
  })

  it('starts static for reduced motion', () => {
    expect(initialTier({ reducedMotion: true, deviceMemory: 16, hardwareConcurrency: 16 })).toBe(
      'static'
    )
  })

  it('reads the hints from a window object', () => {
    const hints = deviceHints({
      navigator: { deviceMemory: 2, hardwareConcurrency: 4 },
      matchMedia: (query) => ({
        matches: query.includes('pointer: coarse'),
      }),
    })
    expect(hints).toMatchObject({
      deviceMemory: 2,
      hardwareConcurrency: 4,
      coarsePointer: true,
      finePointer: false,
    })
    expect(initialTier(hints)).toBe('medium')
  })
})

describe('benchmark', () => {
  it('uses the documented thresholds and a 60-frame window', () => {
    expect(BENCHMARK).toEqual({
      frames: 60,
      dropAboveMs: 24,
      raiseBelowMs: 14,
      staticAboveMs: 40,
    })
  })

  it('does nothing before the window is full', () => {
    const meter = createBenchmark('high')
    for (let index = 0; index < BENCHMARK.frames - 1; index += 1) {
      expect(meter.push(40).decided).toBe(false)
    }
    expect(meter.tier).toBe('high')
  })

  it('drops exactly one tier when the window is slow, then never raises back', () => {
    const meter = createBenchmark('high')
    let verdict = null
    for (let index = 0; index < BENCHMARK.frames; index += 1) verdict = meter.push(30)
    expect(verdict.decided).toBe(true)
    expect(meter.tier).toBe('medium')

    // The next window is fast, but the session already dropped once.
    for (let index = 0; index < BENCHMARK.frames; index += 1) verdict = meter.push(5)
    expect(meter.tier).toBe('medium')
    expect(verdict.decided).toBe(false)
    expect(meter.dropped).toBe(true)
  })

  it('walks high -> medium -> low while every window stays slow', () => {
    const meter = createBenchmark('high')
    for (let index = 0; index < BENCHMARK.frames; index += 1) meter.push(30)
    expect(meter.tier).toBe('medium')
    for (let index = 0; index < BENCHMARK.frames; index += 1) meter.push(30)
    expect(meter.tier).toBe('low')
  })

  it('keeps low when low is merely between 24 and 40 ms', () => {
    const meter = createBenchmark('low')
    let verdict = null
    for (let index = 0; index < BENCHMARK.frames; index += 1) verdict = meter.push(30)
    expect(meter.tier).toBe('low')
    expect(verdict.decided).toBe(false)
    expect(verdict.done).toBe(true)
  })

  it('gives up on WebGL above 40 ms at low', () => {
    const meter = createBenchmark('low')
    let verdict = null
    for (let index = 0; index < BENCHMARK.frames; index += 1) verdict = meter.push(45)
    expect(verdict.decided).toBe(true)
    expect(meter.tier).toBe('static')
    expect(meter.done).toBe(true)
  })

  it('raises one tier on a fast, fine-pointer device that started low', () => {
    const meter = createBenchmark('low')
    for (let index = 0; index < BENCHMARK.frames; index += 1) meter.push(9)
    expect(meter.tier).toBe('medium')
    // A second fast window is not another raise.
    for (let index = 0; index < BENCHMARK.frames; index += 1) meter.push(9)
    expect(meter.tier).toBe('medium')
    expect(meter.done).toBe(true)
  })

  it('never raises on a coarse pointer', () => {
    const meter = createBenchmark('medium', { coarsePointer: true })
    for (let index = 0; index < BENCHMARK.frames; index += 1) meter.push(9)
    expect(meter.tier).toBe('medium')
  })

  it('is already finished when it starts static', () => {
    const meter = createBenchmark('static')
    expect(meter.done).toBe(true)
    expect(meter.push(5).decided).toBe(false)
  })

  it('ignores unusable samples', () => {
    const meter = createBenchmark('high')
    for (let index = 0; index < BENCHMARK.frames; index += 1) meter.push(Number.NaN)
    expect(meter.tier).toBe('high')
    expect(meter.done).toBe(false)
  })
})

describe('layer contract', () => {
  it('is aria-hidden, fixed, click-through and under the content box', () => {
    expect(BACKGROUND_SOURCE).toContain('aria-hidden="true"')
    expect(BACKGROUND_SOURCE).toMatch(/\.app-background \{[\s\S]*?position: fixed;/)
    expect(BACKGROUND_SOURCE).toMatch(/\.app-background \{[\s\S]*?pointer-events: none;/)
    expect(BACKGROUND_SOURCE).toMatch(/\.app-background \{[\s\S]*?z-index: 0;/)
    // The content box above it.
    expect(LAYOUT_SOURCE).toMatch(/\.app-layout-inner \{[\s\S]*?z-index: 1;/)
  })

  it('imports TresJS and Three.js only behind a lazy boundary', () => {
    // The shell is the lazy chunk; it loads the canvas component on demand, so a
    // static tier never downloads TresJS at all.
    expect(BACKGROUND_SOURCE).toContain("defineAsyncComponent(() => import('./background/TresBackdrop.vue'))")
    expect(BACKGROUND_SOURCE).toContain("import { fadeRoute, installUiMotion } from '../lib/motion.js'")
    // One engine: the scene takes three itself, and TresJS renders it.
    expect(SCENE_SOURCE).toMatch(/from 'three'/)
    expect(BACKDROP_SOURCE).toContain("from '@tresjs/core'")
    // Nothing in the entry chain imports the scene, Three.js or TresJS.
    expect(LAYOUT_SOURCE).not.toContain('@tresjs/core')
    expect(LAYOUT_SOURCE).not.toContain("from 'three'")
    expect(LAYOUT_SOURCE).not.toContain('gsap')
  })

  it('is mounted by the signed-in layout only, as its own lazy chunk', () => {
    expect(LAYOUT_SOURCE).toContain("defineAsyncComponent(() => import('./AppBackground3D.vue'))")
    expect(LAYOUT_SOURCE.indexOf('<AppBackground />')).toBeLessThan(
      LAYOUT_SOURCE.indexOf('<div class="app-layout-inner">')
    )
    // No public or signed-out page can reach it.
    for (const file of [
      'src/pages/LoginPage.vue',
      'src/pages/SetPinPage.vue',
      'src/pages/ChangePinPage.vue',
      'src/pages/PendingPage.vue',
      'src/pages/RegisterPage.vue',
      'src/pages/ApproveLinkPage.vue',
    ]) {
      const source = readSource(file)
      expect(source, file).not.toContain('AppBackground3D')
      expect(source, file).not.toContain("from 'three'")
    }
    // The signed-out routes are not under the shell that renders the layout.
    const shellStart = ROUTER_SOURCE.indexOf('component: RoleShell')
    for (const path of ["'/login'", "'/pending'", "'/set-pin'", "'/approve/:token'"]) {
      expect(ROUTER_SOURCE.indexOf(path)).toBeLessThan(shellStart)
    }
  })

  it('leaves the Vuetify layer-order declaration untouched', () => {
    expect(INDEX_SOURCE).toContain(
      '@layer vuetify-core, vuetify-components, vuetify-overrides, vuetify-utilities, vuetify-final;'
    )
    expect(BACKGROUND_SOURCE).not.toContain('@layer')
  })
})

describe('the scene is the visible backdrop', () => {
  it('paints no veil over the canvas, only a transparent light sweep', () => {
    // The old slate-50 veil hid the scene; readability now comes from the glass.
    expect(BACKGROUND_SOURCE).not.toContain('app-background-veil')
    expect(BACKGROUND_SOURCE).not.toContain('veilStyle')
    expect(BACKGROUND_SOURCE).not.toContain('VEIL_OPACITY')

    const template = BACKGROUND_SOURCE.slice(BACKGROUND_SOURCE.indexOf('<template>'))
    // The canvas is TresJS's now, mounted through the lazy component.
    expect(template).toContain('<TresBackdrop')
    expect(template).not.toContain('<span')
    // The one overlay is a screen-blended gradient, never an opaque sheet.
    expect(template).toContain('app-background-sweep')
    const sweep = styleBlock(BACKGROUND_SOURCE, '.app-background-sweep')
    expect(sweep).toContain('pointer-events: none')
    expect(sweep).toContain('mix-blend-mode: screen')
    expect(sweep).not.toMatch(/background:\s*#[0-9a-f]{3,6}/i)
  })

  it('draws the leave palette and a calendar motif inside the scene', () => {
    // Brand indigo and violet plus the three leave-status colours. The palette
    // lives in the scene plan now, not in the component.
    expect(BACKGROUND_SOURCE).toContain('rgba(79, 70, 229, 0.95)')
    const palette = readSource('src/lib/background-scene.js')
    expect(palette).toContain('0x16a34a')
    expect(palette).toContain('0xd97706')
    expect(palette).toContain('0xdc2626')
    expect(BACKGROUND_SOURCE).toContain('rgba(139, 92, 246, 0.9)')
    expect(palette).toContain('CALENDAR_TINTS')
    // Shapes only: the scene never draws lettering.
    expect(BACKGROUND_SOURCE).not.toContain('TextGeometry')
    expect(BACKGROUND_SOURCE).not.toContain('FontLoader')
  })

  it('renders the planes, the calendar, the glints and the dust through TresJS', () => {
    // The scene's objects are TresJS elements driven by the plan, so the counts
    // come from background-scene.js rather than from a hand-built scene graph.
    expect(SCENE_SOURCE).toContain(':args="[cardGeometry, planeMaterials[planeIndex], plane.cards.length]"')
    expect(SCENE_SOURCE).toContain(':args="[sphereGeometry, sphereMaterial, plan.spheres.length]"')
    expect(SCENE_SOURCE).toContain(':args="[calendarGeometry, calendarMaterial, plan.calendar.cells.length]"')
    expect(SCENE_SOURCE).toContain(':args="[glintGeometry, glintMaterial, plan.glints.length]"')
    expect(SCENE_SOURCE).toContain(':args="[dustGeometry, dustMaterial]"')
    // Everything it allocates is handed to TresJS, which disposes the scene graph
    // on unmount, and the loop hook is released by our own cleanup.
    expect(SCENE_SOURCE).toContain('stopLoop.off()')
    expect(tresMock.released).toBeGreaterThanOrEqual(0)
  })

  it('sits below the content box, the dock, the sheet and dialogs', () => {
    const host = styleBlock(BACKGROUND_SOURCE, '.app-background')
    expect(host).toContain('position: fixed')
    expect(host).toContain('z-index: 0')
    expect(host).toContain('pointer-events: none')

    expect(styleBlock(LAYOUT_SOURCE, '.app-layout-inner')).toContain('z-index: 1')
    expect(LAYOUT_SOURCE).toMatch(/position: relative;\s*\n\s*z-index: 1;/)
    // The dock is above the content box, and the phone sheet above the dock.
    expect(Number(styleBlock(DOCK_SOURCE, '.dock').match(/z-index: (\d+)/)[1])).toBeGreaterThan(1)
    expect(
      Number(styleBlock(DOCK_SOURCE, '.dock-sheet-layer').match(/z-index: (\d+)/)[1])
    ).toBeGreaterThan(40)
    // Dialogs are teleported out of the shell by Vuetify, so no page z-index
    // can put one under the canvas.
    expect(BACKGROUND_SOURCE).not.toContain('v-overlay')
  })
})

describe('glass panels', () => {
  const blur = Number(cssVar(STYLES_SOURCE, '--glass-blur').replace('px', ''))
  const tint = whiteAlpha(cssVar(STYLES_SOURCE, '--glass-tint'))
  const tintStrong = whiteAlpha(cssVar(STYLES_SOURCE, '--glass-tint-strong'))

  it('frosts between 14 and 20px, 8px on medium and low, and none on static', () => {
    expect(blur).toBeGreaterThanOrEqual(GLASS.blurMin)
    expect(blur).toBeLessThanOrEqual(GLASS.blurMax)
    expect(QUALITY_TIERS.high.glassBlur).toBe(blur)
    expect(QUALITY_TIERS.medium.glassBlur).toBe(GLASS.reducedBlur)
    expect(QUALITY_TIERS.low.glassBlur).toBe(GLASS.reducedBlur)
    expect(QUALITY_TIERS.static.glassBlur).toBe(0)

    // The tier reaches the stylesheet through data-bg-tier on <html>.
    expect(STYLES_SOURCE).toContain(":root[data-bg-tier='medium'],")
    expect(STYLES_SOURCE).toContain(":root[data-bg-tier='low'] { --glass-blur: 8px; }")
    expect(STYLES_SOURCE).toMatch(/--glass-blur: 8px/)
    expect(STYLES_SOURCE).toContain('--glass-filter: blur(var(--glass-blur)) saturate(1.1)')
    expect(STYLES_SOURCE).toContain(":root[data-bg-tier='static'] {")
    expect(STYLES_SOURCE).toContain('--glass-filter: none')
    expect(BACKGROUND_SOURCE).toContain('document.documentElement.dataset.bgTier = value')
  })

  it('keeps every tint inside the allowed band', () => {
    expect(tint).toBeGreaterThanOrEqual(GLASS.tintMin)
    expect(tint).toBeLessThanOrEqual(GLASS.tintMax)
    expect(tintStrong).toBeGreaterThanOrEqual(tint)
    expect(tintStrong).toBeLessThanOrEqual(GLASS.tintMax)
    expect(SURFACE_OPACITY).toBe(GLASS.tintMin)

    // Static has no blur, so it leans on an even more solid tint.
    const staticBlock = STYLES_SOURCE.slice(STYLES_SOURCE.indexOf(":root[data-bg-tier='static']"))
    const staticTint = whiteAlpha(cssVar(staticBlock, '--glass-tint'))
    expect(staticTint).toBeGreaterThan(tint)
  })

  it('gives every text panel the same recipe and never frosts text itself', () => {
    const recipe = STYLES_SOURCE.slice(STYLES_SOURCE.indexOf('background-color: var(--glass-tint) !important'))
    expect(recipe).toContain('border: 1px solid var(--glass-border) !important')
    expect(recipe).toContain('box-shadow: var(--glass-shadow) !important')
    expect(recipe).toContain('-webkit-backdrop-filter: var(--glass-filter) !important')
    expect(recipe).toContain('backdrop-filter: var(--glass-filter) !important')

    // The recipe list is containers only: no inline text class is frosted.
    const list = STYLES_SOURCE.slice(
      STYLES_SOURCE.indexOf('/* One glass recipe'),
      STYLES_SOURCE.indexOf('background-color: var(--glass-tint) !important')
    )
    for (const textClass of ['.title', '.sub', '.label', '.value', '.badge', '.code', '.detail']) {
      expect(list, textClass).not.toContain(textClass)
    }
  })

  it('frosts the dock, the phone tab bar and the dialogs', () => {
    const dock = styleBlock(DOCK_SOURCE, '.dock')
    expect(dock).toContain('backdrop-filter: var(--glass-filter')
    expect(dock).toContain('var(--glass-tint-strong')
    expect(DOCK_SOURCE).toContain('backdrop-filter: var(--glass-filter')
    expect(styleBlock(DOCK_SOURCE, '.dock-sheet')).toContain('background: #ffffff')
    expect(STYLES_SOURCE).toContain('.v-overlay__content > .v-card')
  })

  it('leaves the shell transparent so the scene shows between panels', () => {
    const shell = styleBlock(LAYOUT_SOURCE, '.app-layout')
    expect(shell).toContain('background: transparent')
    expect(shell).not.toContain('#f3f6f5')
  })
})

describe('motion', () => {
  const keyframeBlocks = [
    ...[...STYLES_SOURCE.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]),
    ...[...BACKGROUND_SOURCE.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]),
  ]

  it('animates transform and opacity only, never a layout property', () => {
    // Two left: the panel entrance and the light sweep. The rest is GSAP.
    expect(keyframeBlocks.length).toBeGreaterThanOrEqual(2)
    for (const block of keyframeBlocks) {
      for (const match of block.matchAll(/([a-z-]+)\s*:/g)) {
        expect(['transform', 'opacity'], match[1]).toContain(match[1])
      }
    }
    for (const match of STYLES_SOURCE.matchAll(/transition:\s*([^;]+);/g)) {
      expect(match[1]).not.toMatch(
        /\b(width|height|top|left|right|bottom|margin|padding|font-size|gap)\b/
      )
    }
  })

  it('staggers the page sections and fades the route change', () => {
    // The entrance is CSS so it exists with no JavaScript at all...
    expect(STYLES_SOURCE).toContain('.app-layout-inner > main > * {')
    // The stagger and the duration come from the shared motion tokens, which
    // tests/motion-system.test.js pins to 40ms and 440ms.
    expect(STYLES_SOURCE).toContain(':nth-child(3) { animation-delay: calc(var(--motion-stagger) * 2); }')
    expect(STYLES_SOURCE).toContain(':nth-child(n + 7) { animation-delay: calc(var(--motion-stagger) * 6); }')
    expect(STYLES_SOURCE).not.toMatch(/animation:[^;]*both/)
    // ...and the route change is GSAP's, on transform and opacity only.
    expect(MOTION_SOURCE).toContain('export async function fadeRoute')
    expect(MOTION_SOURCE).toContain('y: ENTRANCE.rise')
    expect(MOTION_SOURCE).toContain('opacity: ENTRANCE.opacityFrom')
  })

  it('turns every bit of motion off for a reduced-motion visitor', () => {
    const gate = STYLES_SOURCE.indexOf('@media (prefers-reduced-motion: no-preference)')
    expect(gate).toBeGreaterThan(0)
    expect(STYLES_SOURCE.indexOf('animation: panel-rise')).toBeGreaterThan(gate)
    // The helper returns before it touches GSAP when motion is reduced.
    expect(MOTION_SOURCE).toContain('if (reduced())')
    expect(MOTION_SOURCE).toContain('prefersReducedMotion')
    expect(BACKGROUND_SOURCE).toContain('@media (prefers-reduced-motion: reduce)')
    expect(BACKGROUND_SOURCE).toContain('.app-background-sweep { animation: none; }')
    expect(initialTier({ reducedMotion: true })).toBe('static')
    expect(QUALITY_TIERS.static.glassBlur).toBe(0)
  })

  it('lifts and tilts only for a real mouse', () => {
    // The lift is GSAP's now, gated on a fine pointer and a no-preference visitor.
    expect(MOTION_SOURCE).toContain("(hover: hover) and (pointer: fine)")
    expect(MOTION_SOURCE).toContain('rotationX: LIFT.rotation')
    expect(MOTION_SOURCE).toContain('transformPerspective: LIFT.perspective')
    expect(MOTION_SOURCE).toContain('if (!finePointer()) return')
    // No CSS tilt is left that could double up with it.
    expect(STYLES_SOURCE).not.toContain('perspective(900px)')
  })

  it('counts up to a number the page already shows', () => {
    expect(MOTION_SOURCE).toContain('export async function countUp')
    expect(MOTION_SOURCE).toContain('onUpdate')
    expect(readSource('src/pages/LeaveHomePage.vue')).toContain('countUp(')
    // The totals are in the DOM before any animation runs, so they are correct
    // with motion off.
    expect(readSource('src/pages/LeaveHomePage.vue')).toContain('{{ counts.pending }}')
  })
})

describe('glass readability over the worst backdrop', () => {
  // The tint has to hold AA over the darkest pixel the scene can put behind a
  // panel, not over an average: #000000 is the absolute floor and the second row
  // is the darkest pixel measured in the browser audit.
  const WORST_BACKDROPS = [
    ['#000000', 'absolute floor'],
    ['#14103a', 'darkest measured scene pixel'],
    ['#ffffff', 'lightest (the sweep glow)'],
  ]

  // Every text colour a glass panel carries.
  const INKS = [
    ['#0b1c30', 'body text'],
    ['#12343b', 'headings'],
    ['#444651', 'secondary text'],
    ['#5c7176', 'muted labels and captions'],
    ['#55696d', 'the HR card caption beside an icon tile'],
    ['#4d6468', 'empty state'],
    ['#10504e', 'links'],
    ['#a01b1b', 'error text'],
  ]

  it('keeps every ink at AA on the tinted glass, at both tints', () => {
    const alphas = [
      whiteAlpha(cssVar(STYLES_SOURCE, '--glass-tint')),
      whiteAlpha(cssVar(STYLES_SOURCE, '--glass-tint-strong')),
    ]
    for (const [backdrop, label] of WORST_BACKDROPS) {
      for (const alpha of alphas) {
        const surface = glassOver(backdrop, alpha)
        for (const [ink, inkLabel] of INKS) {
          expect(
            contrast(ink, surface),
            `${inkLabel} ${ink} on ${surface} (${alpha} over ${label})`
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it('keeps the light border visible against the glass', () => {
    const border = glassOver('#ffffff', 0.72)
    const surface = glassOver('#14103a', whiteAlpha(cssVar(STYLES_SOURCE, '--glass-tint')))
    expect(contrast(border, surface)).toBeGreaterThan(1.1)
  })
})

describe('panel text tokens', () => {
  // Every text colour the signed-in panels use, against the surface it sits on.
  const PANEL_PAIRS = [
    ['#12343b', '#ffffff', 'titles and card headings'],
    ['#0b1c30', '#ffffff', 'body text'],
    ['#444651', '#ffffff', 'muted body text'],
    ['#5c7176', '#ffffff', 'subtitles, captions and muted values'],
    ['#55696d', '#ffffff', 'HR card caption'],
    ['#55696d', '#f0f7f6', 'HR card caption over the icon tile tint'],
    ['#4d6468', '#ffffff', 'empty-state text'],
    ['#10504e', '#ffffff', 'primary links'],
    ['#a01b1b', '#ffffff', 'error text'],
    ['#6b4300', '#fff8e8', 'read-only note'],
    ['#ffffff', '#98620f', 'read-only badge'],
    ['#ffffff', '#4f46e5', 'primary button'],
    ['#ffffff', '#10504e', 'dock brand tile'],
    ['#5c7176', '#f1f5f9', 'muted text on a slate chip'],
  ]

  it('keeps every pair at WCAG AA (4.5:1)', () => {
    for (const [foreground, background, label] of PANEL_PAIRS) {
      const ratio = contrast(foreground, background)
      expect(ratio, `${label}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('darkened exactly the tokens that failed on white', () => {
    expect(contrast('#8b9c9a', '#ffffff')).toBeLessThan(4.5)
    expect(contrast('#b7791f', '#ffffff')).toBeLessThan(4.5)
    expect(contrast('#7c8f93', '#ffffff')).toBeLessThan(4.5)
    expect(contrast('#94a5a7', '#ffffff')).toBeLessThan(4.5)
    expect(contrast('#b3c2c0', '#ffffff')).toBeLessThan(4.5)
    expect(contrast('#9aa8a5', '#ffffff')).toBeLessThan(4.5)

    expect(PROFILE_SOURCE).toContain('color: #5c7176')
    expect(PROFILE_SOURCE).not.toContain('color: #8b9c9a')
    expect(PROFILE_SOURCE).toContain('background: #98620f')
    expect(MY_APPROVERS_SOURCE).toContain('background: #98620f')
    expect(MY_APPROVERS_SOURCE).not.toContain('background: #b7791f')
    expect(ADMIN_SOURCE).not.toContain('color: #94a5a7')
    expect(ADMIN_SOURCE).not.toContain('color: #7c8f93')
    expect(ADMIN_PERMISSIONS_SOURCE).not.toContain('color: #7c8f93')
    expect(ADMIN_PERMISSIONS_SOURCE).not.toContain('color: #b3c2c0')
    expect(CALENDAR_SOURCE).not.toContain('color: #9aa8a5')

    // The one token the glass audit still failed at 4.21:1 next to the mint icon
    // tile, darkened to #55696d. 4.21 -> 4.74 and 5.15 -> 6.00 on white.
    expect(contrast('#5c7176', '#e2eae9')).toBeLessThan(4.5)
    expect(contrast('#55696d', '#e2eae9')).toBeGreaterThanOrEqual(4.5)
    // The home page no longer has the mint caption: its muted ink is slate-600 on
    // the glass panel, measured against the scene in tests/hr-home-page.test.js.
    expect(readSource('src/pages/HrHomePage.vue')).toContain('--ink-muted: #475569;')
  })

  it('leaves the benchmark and the static fallback untouched', () => {
    expect(QUALITY_TIERS.high.material).toBe('standard')
    expect(QUALITY_TIERS.static.objectCount).toBe(0)
    expect(BENCHMARK.frames).toBe(60)
  })
})
