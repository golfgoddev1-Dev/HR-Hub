// @vitest-environment happy-dom
// The app-wide background: the pure tier policy (hints, benchmark thresholds,
// the one-way rule) and the component's own contract (lazy Three.js, disposal,
// pause paths, static fallback, aria and stacking). WebGL is mocked: no GPU is
// involved and `three` is replaced by a small module that counts its imports,
// renderers and disposals.
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  BENCHMARK,
  GLASS,
  QUALITY_TIERS,
  SURFACE_OPACITY,
  createBenchmark,
  deviceHints,
  initialTier,
} from '../src/lib/background-quality.js'
import AppBackground3D from '../src/components/AppBackground3D.vue'

const threeMock = vi.hoisted(() => {
  const state = {
    imported: 0,
    renderers: 0,
    disposedRenderers: 0,
    disposedGeometries: 0,
    disposedMaterials: 0,
    disposedInstanced: 0,
    renders: 0,
    instanced: [],
    bufferAttributes: [],
    pixelRatios: [],
    sizes: [],
    contextLosses: 0,
    shadowMap: null,
    failure: false,
  }

  function vector() {
    return {
      x: 0,
      y: 0,
      z: 0,
      set(x, y, z) {
        this.x = x
        this.y = y
        this.z = z
      },
    }
  }

  class Object3D {
    constructor() {
      this.children = []
      this.parent = null
      this.position = vector()
      this.rotation = vector()
      this.scale = {
        ...vector(),
        setScalar(value) {
          this.x = value
          this.y = value
          this.z = value
        },
      }
      this.matrix = { elements: [] }
    }
    add(...items) {
      for (const item of items) {
        item.parent = this
        this.children.push(item)
      }
      return this
    }
    remove(item) {
      const at = this.children.indexOf(item)
      if (at >= 0) this.children.splice(at, 1)
      item.parent = null
      return this
    }
    updateMatrix() {}
    lookAt() {}
  }

  class Geometry {
    dispose() {
      state.disposedGeometries += 1
    }
  }

  class Material {
    constructor(options = {}) {
      this.options = options
    }
    dispose() {
      state.disposedMaterials += 1
    }
  }

  class Shape {
    moveTo() {
      return this
    }
    lineTo() {
      return this
    }
    quadraticCurveTo() {
      return this
    }
  }

  class PerspectiveCamera extends Object3D {
    constructor(fov, aspect, near, far) {
      super()
      this.fov = fov
      this.aspect = aspect
      this.near = near
      this.far = far
      this.position.set = (x, y, z) => {
        this.position.x = x
        this.position.y = y
        this.position.z = z
      }
    }
    updateProjectionMatrix() {
      state.projectionUpdates = (state.projectionUpdates ?? 0) + 1
    }
  }

  class ShapeGeometry extends Geometry {}
  class SphereGeometry extends Geometry {}

  class Color {
    constructor(hex) {
      this.hex = hex
    }
    setHex(hex) {
      this.hex = hex
      return this
    }
  }

  class InstancedMesh extends Object3D {
    constructor(geometry, material, count) {
      super()
      this.geometry = geometry
      this.material = material
      this.count = count
      this.instanceMatrix = { usage: null, needsUpdate: false, setUsage(usage) { this.usage = usage } }
      this.instanceColor = null
      this.matrices = []
      this.colors = []
      state.instanced.push(this)
    }
    setMatrixAt(index, matrix) {
      this.matrices[index] = matrix
    }
    setColorAt(index, color) {
      if (!this.instanceColor) this.instanceColor = { needsUpdate: false }
      this.colors[index] = color
    }
    dispose() {
      state.disposedInstanced += 1
    }
  }

  class WebGLRenderer {
    constructor(options = {}) {
      if (state.failure) throw new Error('Error creating WebGL context')
      state.renderers += 1
      this.canvas = options.canvas
      this.pixelRatio = 1
      this.size = { width: 0, height: 0 }
      this.disposed = false
      // Deliberately on: the component has to turn shadow maps off.
      this.shadowMap = { enabled: true }
      state.shadowMap = this.shadowMap
    }
    setPixelRatio(value) {
      this.pixelRatio = value
      state.pixelRatios.push(value)
    }
    setSize(width, height) {
      this.size = { width, height }
      state.sizes.push({ width, height })
    }
    render() {
      state.renders += 1
    }
    dispose() {
      this.disposed = true
      state.disposedRenderers += 1
    }
    forceContextLoss() {
      state.contextLosses += 1
    }
  }

  class BufferGeometry extends Geometry {
    constructor() {
      super()
      this.attributes = {}
    }
    setAttribute(name, attribute) {
      this.attributes[name] = attribute
      return this
    }
  }

  class BufferAttribute {
    constructor(array, itemSize) {
      this.array = array
      this.itemSize = itemSize
      this.needsUpdate = false
      this.usage = null
      state.bufferAttributes.push(this)
    }
    setUsage(usage) {
      this.usage = usage
      return this
    }
  }

  class Points extends Object3D {
    constructor(geometry, material) {
      super()
      this.geometry = geometry
      this.material = material
    }
  }

  return {
    state,
    module: {
      AdditiveBlending: 1,
      AmbientLight: Object3D,
      BufferAttribute,
      BufferGeometry,
      Color,
      DirectionalLight: Object3D,
      DoubleSide: 2,
      DynamicDrawUsage: 35048,
      Group: Object3D,
      InstancedMesh,
      MeshBasicMaterial: Material,
      Points,
      PointsMaterial: Material,
      MeshLambertMaterial: Material,
      MeshStandardMaterial: Material,
      Object3D,
      PerspectiveCamera,
      Scene: Object3D,
      Shape,
      ShapeGeometry,
      SphereGeometry,
      WebGLRenderer,
    },
  }
})

vi.mock('three', () => {
  threeMock.state.imported += 1
  return threeMock.module
})

const BACKGROUND_SOURCE = readFileSync('src/components/AppBackground3D.vue', 'utf8')
const LAYOUT_SOURCE = readFileSync('src/components/AppLayout.vue', 'utf8')
const ROUTER_SOURCE = readFileSync('src/router.js', 'utf8')
const INDEX_SOURCE = readFileSync('index.html', 'utf8')
const STYLES_SOURCE = readFileSync('src/styles.css', 'utf8')
const DOCK_SOURCE = readFileSync('src/components/AppDock.vue', 'utf8')
const PROFILE_SOURCE = readFileSync('src/pages/ProfilePage.vue', 'utf8')
const MY_APPROVERS_SOURCE = readFileSync('src/pages/MyApproversPage.vue', 'utf8')
const ADMIN_SOURCE = readFileSync('src/pages/AdminPage.vue', 'utf8')
const ADMIN_PERMISSIONS_SOURCE = readFileSync('src/pages/AdminPermissionsPage.vue', 'utf8')
const CALENDAR_SOURCE = readFileSync('src/components/LeaveCalendarView.vue', 'utf8')

/** The declaration block of one selector, from a plain CSS/Vue source. */
function styleBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`\\n\\s*${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(source)
  return match ? match[1] : ''
}

const raf = { nextId: 0, pending: new Map(), scheduled: 0, cancelled: 0, clock: 0 }

function stubEnvironment({
  memory = 8,
  cores = 8,
  coarse = false,
  fine = true,
  reduced = false,
  pixelRatio = 2,
  width = 1280,
} = {}) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query) => ({
      media: query,
      matches: query.includes('prefers-reduced-motion')
        ? reduced
        : query.includes('pointer: coarse')
          ? coarse
          : query.includes('pointer: fine')
            ? fine
            : false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }))
  )
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 })
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    writable: true,
    value: pixelRatio,
  })
  Object.defineProperty(window.navigator, 'deviceMemory', { configurable: true, value: memory })
  Object.defineProperty(window.navigator, 'hardwareConcurrency', {
    configurable: true,
    value: cores,
  })
}

/** Feed the animation loop `count` frames, `stepMs` apart. */
function runFrames(count, stepMs) {
  for (let index = 0; index < count; index += 1) {
    raf.clock += stepMs
    const callbacks = [...raf.pending.values()]
    raf.pending.clear()
    for (const callback of callbacks) callback(raf.clock)
  }
}

async function mountBackground() {
  const wrapper = mount(AppBackground3D, { attachTo: document.body })
  await flushPromises()
  await flushPromises()
  return wrapper
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
  raf.nextId = 0
  raf.pending = new Map()
  raf.scheduled = 0
  raf.cancelled = 0
  raf.clock = 0
  threeMock.state.instanced.length = 0
  threeMock.state.bufferAttributes.length = 0
  threeMock.state.sizes.length = 0
  threeMock.state.pixelRatios.length = 0
  threeMock.state.renders = 0
  threeMock.state.contextLosses = 0
  threeMock.state.shadowMap = null
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback) => {
      raf.nextId += 1
      raf.scheduled += 1
      raf.pending.set(raf.nextId, callback)
      return raf.nextId
    })
  )
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id) => {
      raf.cancelled += 1
      raf.pending.delete(id)
    })
  )
})

// Every mounted background is unmounted after its test, so a stray animation
// loop can never leak into the next one.
enableAutoUnmount(afterEach)

afterEach(() => {
  vi.unstubAllGlobals()
  threeMock.state.failure = false
  document.body.innerHTML = ''
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

describe('AppBackground3D mount', () => {
  it('builds a high-tier scene with instanced meshes and no shadow maps', async () => {
    stubEnvironment({ memory: 8, cores: 8 })
    const renderersBefore = threeMock.state.renderers

    const wrapper = await mountBackground()

    expect(threeMock.state.renderers).toBe(renderersBefore + 1)
    expect(wrapper.attributes('data-tier')).toBe('high')
    expect(wrapper.find('canvas').exists()).toBe(true)
    // Three card planes, then spheres, the calendar grid and the glints.
    expect(threeMock.state.instanced.map((mesh) => mesh.count)).toEqual([20, 20, 20, 14, 40, 6])
    // One dust cloud of 260 motes, one draw call.
    expect(threeMock.state.bufferAttributes.map((attribute) => attribute.array.length)).toEqual([
      260 * 3,
    ])
    expect(threeMock.state.shadowMap.enabled).toBe(false)
    expect(threeMock.state.pixelRatios.at(-1)).toBe(1.5)

    wrapper.unmount()
  })

  it('caps the pixel ratio at 1.5 even on a 3x screen', async () => {
    stubEnvironment({ pixelRatio: 3 })
    const wrapper = await mountBackground()
    expect(threeMock.state.pixelRatios.at(-1)).toBe(1.5)
    wrapper.unmount()
  })

  it('starts at medium on a coarse pointer, with fewer objects and a 1.0 cap', async () => {
    stubEnvironment({ coarse: true, fine: false, memory: 4, cores: 4, pixelRatio: 2 })
    const wrapper = await mountBackground()

    expect(wrapper.attributes('data-tier')).toBe('medium')
    expect(threeMock.state.instanced.map((mesh) => mesh.count)).toEqual([10, 10, 10, 8, 18, 4])
    expect(threeMock.state.pixelRatios.at(-1)).toBe(1)

    wrapper.unmount()
  })

  it('drops one tier from a slow benchmark and keeps it there', async () => {
    stubEnvironment({ memory: 8, cores: 8 })
    const wrapper = await mountBackground()
    expect(wrapper.attributes('data-tier')).toBe('high')

    runFrames(61, 30)
    await flushPromises()
    expect(wrapper.attributes('data-tier')).toBe('medium')
    // The rebuild adds a second set of meshes; the newest six are the medium one.
    expect(threeMock.state.instanced.map((mesh) => mesh.count).slice(-6)).toEqual([
      10, 10, 10, 8, 18, 4,
    ])

    // Fast frames afterwards must not raise it back.
    runFrames(61, 6)
    await flushPromises()
    expect(wrapper.attributes('data-tier')).toBe('medium')

    wrapper.unmount()
  })

  it('skips render calls to hold the tier frame rate', async () => {
    stubEnvironment({ coarse: true, fine: false, memory: 4, cores: 4 })
    const wrapper = await mountBackground()
    expect(wrapper.attributes('data-tier')).toBe('medium')

    threeMock.state.renders = 0
    runFrames(60, 5)
    // A 30 fps target over 300 ms of frames: far fewer renders than frames.
    expect(threeMock.state.renders).toBeGreaterThan(0)
    expect(threeMock.state.renders).toBeLessThan(20)

    wrapper.unmount()
  })

  it('falls back to static when WebGL creation throws', async () => {
    stubEnvironment({ memory: 8, cores: 8 })
    threeMock.state.failure = true

    const wrapper = await mountBackground()

    expect(wrapper.attributes('data-tier')).toBe('static')
    expect(wrapper.find('canvas').exists()).toBe(false)
    expect(wrapper.classes()).toContain('app-background--static')

    wrapper.unmount()
  })

  it('never imports Three.js and never paints a canvas for reduced motion', async () => {
    stubEnvironment({ reduced: true })
    const importsBefore = threeMock.state.imported

    const wrapper = await mountBackground()

    expect(threeMock.state.imported).toBe(importsBefore)
    expect(wrapper.attributes('data-tier')).toBe('static')
    expect(wrapper.find('canvas').exists()).toBe(false)
    expect(raf.scheduled).toBe(0)

    wrapper.unmount()
  })

  it('disposes the renderer, geometries, materials, canvas and animation frame', async () => {
    stubEnvironment({ memory: 8, cores: 8 })
    const before = {
      renderers: threeMock.state.disposedRenderers,
      geometries: threeMock.state.disposedGeometries,
      materials: threeMock.state.disposedMaterials,
      instances: threeMock.state.disposedInstanced,
    }

    const wrapper = await mountBackground()
    runFrames(2, 16)
    expect(raf.scheduled).toBeGreaterThan(0)

    wrapper.unmount()

    expect(threeMock.state.disposedRenderers).toBe(before.renderers + 1)
    expect(threeMock.state.disposedGeometries).toBeGreaterThan(before.geometries)
    expect(threeMock.state.disposedMaterials).toBeGreaterThan(before.materials)
    expect(threeMock.state.disposedInstanced).toBeGreaterThan(before.instances)
    expect(threeMock.state.contextLosses).toBeGreaterThan(0)
    expect(raf.cancelled).toBeGreaterThan(0)
    expect(raf.pending.size).toBe(0)
    expect(document.querySelectorAll('canvas').length).toBe(0)
  })

  it('stops the loop while the tab is hidden and resumes when it returns', async () => {
    stubEnvironment()
    const wrapper = await mountBackground()
    runFrames(2, 16)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    const cancelled = raf.cancelled
    runFrames(5, 16)
    expect(raf.pending.size).toBe(0)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(raf.pending.size).toBe(1)
    expect(raf.cancelled).toBeGreaterThanOrEqual(cancelled)

    wrapper.unmount()
  })

  it('pauses when the host leaves the viewport', async () => {
    stubEnvironment()
    const observed = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback) {
          this.callback = callback
          observed.push(callback)
        }
        observe() {}
        disconnect() {}
      }
    )

    const wrapper = await mountBackground()
    runFrames(2, 16)
    expect(observed.length).toBe(1)

    observed[0]([{ isIntersecting: false }])
    expect(raf.pending.size).toBe(0)

    observed[0]([{ isIntersecting: true }])
    expect(raf.pending.size).toBe(1)

    wrapper.unmount()
  })

  it('sizes through ResizeObserver, not only window.resize', async () => {
    stubEnvironment()
    const callbacks = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback) {
          this.callback = callback
          callbacks.push(callback)
        }
        observe(element) {
          this.element = element
        }
        disconnect() {}
      }
    )

    const wrapper = await mountBackground()
    expect(callbacks.length).toBe(1)
    expect(threeMock.state.sizes.at(-1)).toEqual({ width: 1280, height: 800 })

    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 })
    callbacks[0]()
    expect(threeMock.state.sizes.at(-1)).toEqual({ width: 1280, height: 400 })

    wrapper.unmount()
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

  it('imports Three.js dynamically only', () => {
    expect(BACKGROUND_SOURCE).toContain("await import('three')")
    expect(BACKGROUND_SOURCE).not.toMatch(/^import .* from 'three'/m)
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
      const source = readFileSync(file, 'utf8')
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
    expect(template).toContain('<canvas')
    expect(template).not.toContain('<span')
    // The one overlay is a screen-blended gradient, never an opaque sheet.
    expect(template).toContain('app-background-sweep')
    const sweep = styleBlock(BACKGROUND_SOURCE, '.app-background-sweep')
    expect(sweep).toContain('pointer-events: none')
    expect(sweep).toContain('mix-blend-mode: screen')
    expect(sweep).not.toMatch(/background:\s*#[0-9a-f]{3,6}/i)
  })

  it('draws the leave palette and a calendar motif inside the scene', () => {
    // Brand indigo and violet plus the three leave-status colours.
    expect(BACKGROUND_SOURCE).toContain('0x16a34a')
    expect(BACKGROUND_SOURCE).toContain('0xd97706')
    expect(BACKGROUND_SOURCE).toContain('0xdc2626')
    expect(BACKGROUND_SOURCE).toContain('rgba(79, 70, 229, 0.95)')
    expect(BACKGROUND_SOURCE).toContain('rgba(139, 92, 246, 0.9)')
    expect(BACKGROUND_SOURCE).toContain('CALENDAR_TINTS')
    // Shapes only: the scene never draws lettering.
    expect(BACKGROUND_SOURCE).not.toContain('TextGeometry')
    expect(BACKGROUND_SOURCE).not.toContain('FontLoader')
  })

  it('builds three depth planes, glints and dust, and disposes all of them', async () => {
    stubEnvironment({ memory: 8, cores: 8 })
    const wrapper = await mountBackground()

    // Three card planes with different parallax shares, then spheres, calendar
    // cells, glints and one points cloud.
    expect(threeMock.state.instanced.map((mesh) => mesh.count)).toEqual([20, 20, 20, 14, 40, 6])
    expect(threeMock.state.bufferAttributes).toHaveLength(1)
    expect(threeMock.state.bufferAttributes[0].itemSize).toBe(3)

    const disposed = {
      geometries: threeMock.state.disposedGeometries,
      materials: threeMock.state.disposedMaterials,
    }
    wrapper.unmount()
    expect(threeMock.state.disposedGeometries).toBeGreaterThan(disposed.geometries)
    expect(threeMock.state.disposedMaterials).toBeGreaterThan(disposed.materials)
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
    expect(keyframeBlocks.length).toBeGreaterThanOrEqual(3)
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

  it('staggers the page sections and the route change', () => {
    expect(STYLES_SOURCE).toContain('.app-layout-inner > main { animation: page-fade')
    expect(STYLES_SOURCE).toContain('.app-layout-inner > main > * {')
    expect(STYLES_SOURCE).toContain(':nth-child(3) { animation-delay: 0.08s; }')
    expect(STYLES_SOURCE).toContain(':nth-child(n + 7) { animation-delay: 0.24s; }')
    // The entrance only defines a start frame, so it never leaves a filled
    // transform behind that would block the hover tilt.
    expect(STYLES_SOURCE).not.toMatch(/animation:[^;]*\bboth\b/)
  })

  it('turns every bit of motion off for a reduced-motion visitor', () => {
    const gate = STYLES_SOURCE.indexOf('@media (prefers-reduced-motion: no-preference)')
    expect(gate).toBeGreaterThan(0)
    for (const marker of [
      'animation: page-fade',
      'animation: panel-rise',
      'transform: translate3d(0, 1px, 0) scale(0.985)',
      'transform: perspective(900px)',
    ]) {
      expect(STYLES_SOURCE.indexOf(marker), marker).toBeGreaterThan(gate)
    }
    // The sweep stops, the tier collapses to static and the glass loses its blur.
    expect(BACKGROUND_SOURCE).toContain('@media (prefers-reduced-motion: reduce)')
    expect(BACKGROUND_SOURCE).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.app-background-sweep \{ animation: none; \}/)
    expect(initialTier({ reducedMotion: true })).toBe('static')
    expect(QUALITY_TIERS.static.glassBlur).toBe(0)
  })

  it('lifts and tilts only for a real mouse on the top tier', () => {
    const hover = STYLES_SOURCE.slice(
      STYLES_SOURCE.indexOf('@media (hover: hover) and (pointer: fine)')
    )
    expect(hover).toContain(":root[data-bg-tier='high']")
    expect(hover).toContain(
      'transform: perspective(900px) translate3d(0, -3px, 0) rotateX(1.2deg) rotateY(-1.2deg)'
    )
    // No other tier is ever named in the hover block.
    for (const tier of ['medium', 'low', 'static']) {
      expect(hover, tier).not.toContain("data-bg-tier='" + tier + "'")
    }
  })

  it('counts up to a number the page already shows, and stops counting on unmount', () => {
    const source = readFileSync('src/lib/use-count-up.js', 'utf8')
    expect(source).toContain('prefers-reduced-motion: reduce')
    expect(source).toContain('cancelAnimationFrame')
    expect(source).toContain('watch(')
    expect(source).not.toMatch(/transition:|@keyframes/)
    expect(readFileSync('src/pages/LeaveHomePage.vue', 'utf8')).toContain('useCountUp')
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
    expect(readFileSync('src/pages/HrHomePage.vue', 'utf8')).toContain('color: #55696d')
  })

  it('leaves the benchmark and the static fallback untouched', () => {
    expect(QUALITY_TIERS.high.material).toBe('standard')
    expect(QUALITY_TIERS.static.objectCount).toBe(0)
    expect(BENCHMARK.frames).toBe(60)
  })
})
