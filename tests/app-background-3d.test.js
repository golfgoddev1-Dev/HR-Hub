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
  QUALITY_TIERS,
  VEIL_OPACITY,
  createBenchmark,
  deviceHints,
  initialTier,
  veilBackground,
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

  return {
    state,
    module: {
      AmbientLight: Object3D,
      Color,
      DirectionalLight: Object3D,
      DoubleSide: 2,
      DynamicDrawUsage: 35048,
      Group: Object3D,
      InstancedMesh,
      MeshBasicMaterial: Material,
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

/** The slate-50 veil composited over an opaque scene colour. */
function veilOver(hex, alpha = VEIL_OPACITY) {
  const veil = 'f8fafc'.match(/.{2}/g).map((part) => parseInt(part, 16))
  const base = hex.replace('#', '').match(/.{2}/g).map((part) => parseInt(part, 16))
  const mixed = veil.map((channel, index) =>
    Math.round(channel * alpha + base[index] * (1 - alpha))
      .toString(16)
      .padStart(2, '0')
  )
  return `#${mixed.join('')}`
}

beforeEach(() => {
  raf.nextId = 0
  raf.pending = new Map()
  raf.scheduled = 0
  raf.cancelled = 0
  raf.clock = 0
  threeMock.state.instanced.length = 0
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
    expect(QUALITY_TIERS.high.objectCount).toBe(60)
    expect(QUALITY_TIERS.high.pixelRatioCap).toBe(1.5)
    expect(QUALITY_TIERS.high.targetFps).toBe(60)

    expect(QUALITY_TIERS.medium.objectCount).toBe(30)
    expect(QUALITY_TIERS.medium.pixelRatioCap).toBe(1)
    expect(QUALITY_TIERS.medium.targetFps).toBe(30)

    expect(QUALITY_TIERS.low.objectCount).toBe(12)
    expect(QUALITY_TIERS.low.pixelRatioCap).toBe(0.75)
    expect(QUALITY_TIERS.low.targetFps).toBe(24)

    expect(QUALITY_TIERS.static.objectCount).toBe(0)
    expect(QUALITY_TIERS.static.targetFps).toBe(0)
  })

  it('splits each budget into cards and spheres', () => {
    for (const name of ['high', 'medium', 'low']) {
      const tier = QUALITY_TIERS[name]
      expect(tier.cardCount + tier.sphereCount, name).toBe(tier.objectCount)
    }
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

  it('offers mouse parallax only on fine pointers at high and medium', () => {
    expect(QUALITY_TIERS.high.mouseParallax).toBe(true)
    expect(QUALITY_TIERS.medium.mouseParallax).toBe(true)
    expect(QUALITY_TIERS.low.mouseParallax).toBe(false)
    expect(QUALITY_TIERS.static.mouseParallax).toBe(false)
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
    // 44 cards and 16 spheres, two draw calls.
    expect(threeMock.state.instanced.map((mesh) => mesh.count)).toEqual([44, 16])
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
    expect(threeMock.state.instanced.map((mesh) => mesh.count)).toEqual([22, 8])
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
    expect(threeMock.state.instanced.map((mesh) => mesh.count).slice(-2)).toEqual([22, 8])

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

describe('text contrast over the veil', () => {
  it('keeps every text token at AA over the darkest scene tone', () => {
    const veil = veilBackground()
    expect(veil).toBe(`rgba(248, 250, 252, ${VEIL_OPACITY})`)

    const worst = veilOver('#c7d2fe')
    for (const text of ['#0b1c30', '#12343b', '#444651', '#5c7176']) {
      expect(contrast(text, worst), `${text} on ${worst}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the composited backdrop as light as the shell it replaces', () => {
    // #5c7176 already sits at 4.70:1 on the current #f3f6f5 shell, so the veil
    // may not darken the backdrop much at all.
    const composed = veilOver('#c7d2fe')
    const shell = contrast('#5c7176', '#f3f6f5')
    expect(contrast('#5c7176', composed)).toBeGreaterThanOrEqual(4.5)
    expect(luminance(composed)).toBeGreaterThan(0.88)
    expect(shell).toBeGreaterThan(4.5)
  })
})
