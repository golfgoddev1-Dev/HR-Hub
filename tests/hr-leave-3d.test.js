// @vitest-environment happy-dom
// The HR leave page's 3D layer: lite-mode detection, the scene that is never
// created on a lite device, the card tilt that reduced motion turns off, and the
// disposal that has to run on unmount.
//
// WebGL is mocked here: no real GPU is involved, and `three` is replaced by a
// small module that counts its own imports, renderers and disposals.
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readFileSync } from 'node:fs'

import { allowsPointerTilt, isLiteMode, prefersReducedMotion } from '../src/lib/lite-mode.js'
import HrLeave3DScene from '../src/components/HrLeave3DScene.vue'
import HrLeaveRequestsPage from '../src/pages/HrLeaveRequestsPage.vue'
import { clearAll } from '../src/lib/data-cache.js'

const threeMock = vi.hoisted(() => {
  const state = {
    imported: 0,
    renderers: 0,
    disposedRenderers: 0,
    disposedGeometries: 0,
    disposedMaterials: 0,
    renders: 0,
    lastPixelRatio: null,
    lastSize: null,
    materialColors: [],
    meshes: 0,
    failure: false,
  }

  class Geometry {
    dispose() {
      state.disposedGeometries += 1
    }
  }

  class Material {
    constructor(options = {}) {
      this.options = options
      if (options.color !== undefined) state.materialColors.push(options.color)
    }
    dispose() {
      state.disposedMaterials += 1
    }
  }

  class Object3D {
    constructor() {
      this.children = []
      this.userData = {}
      this.position = {
        x: 0,
        y: 0,
        z: 0,
        set: (x, y, z) => {
          this.position.x = x
          this.position.y = y
          this.position.z = z
        },
      }
      this.rotation = { x: 0, y: 0, z: 0 }
      this.scale = {
        x: 1,
        y: 1,
        z: 1,
        set: (x, y, z) => {
          this.scale.x = x
          this.scale.y = y
          this.scale.z = z
        },
        setScalar: (value) => {
          this.scale.x = value
          this.scale.y = value
          this.scale.z = value
        },
      }
    }
    add(...items) {
      this.children.push(...items)
      return this
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

  class BoxGeometry extends Geometry {}
  class TorusGeometry extends Geometry {}
  class ExtrudeGeometry extends Geometry {}
  class CircleGeometry extends Geometry {}
  class Scene extends Object3D {}
  class Group extends Object3D {}

  class Mesh extends Object3D {
    constructor(geometry, material) {
      super()
      state.meshes += 1
      this.geometry = geometry
      this.material = material
    }
  }

  class Light extends Object3D {
    constructor(color, intensity) {
      super()
      this.color = color
      this.intensity = intensity
      this.position = { x: 0, y: 0, z: 0, set: () => {} }
    }
  }

  class PerspectiveCamera extends Object3D {
    constructor(fov, aspect, near, far) {
      super()
      Object.assign(this, { fov, aspect, near, far })
      this.position = { x: 0, y: 0, z: 0, set: () => {} }
    }
    updateProjectionMatrix() {}
    lookAt() {}
  }

  class WebGLRenderer {
    constructor(options = {}) {
      if (state.failure) throw new Error('WebGL is not available')
      state.renderers += 1
      this.canvas = options.canvas
      this.pixelRatio = 1
      this.size = { width: 0, height: 0 }
      this.disposed = false
    }
    setPixelRatio(value) {
      this.pixelRatio = value
      state.lastPixelRatio = value
    }
    setSize(width, height) {
      this.size = { width, height }
      state.lastSize = { width, height }
    }
    render() {
      state.renders += 1
    }
    dispose() {
      this.disposed = true
      state.disposedRenderers += 1
    }
    forceContextLoss() {}
  }

  return {
    state,
    module: {
      AmbientLight: Light,
      BoxGeometry,
      CircleGeometry,
      DirectionalLight: Light,
      ExtrudeGeometry,
      Group,
      Mesh,
      MeshBasicMaterial: Material,
      MeshStandardMaterial: Material,
      PerspectiveCamera,
      Scene,
      Shape,
      TorusGeometry,
      WebGLRenderer,
    },
  }
})

vi.mock('three', () => {
  threeMock.state.imported += 1
  return threeMock.module
})

const raf = { nextId: 0, pending: new Map(), scheduled: 0, cancelled: 0 }

function stubEnvironment({ width = 1280, coarse = false, reduced = false, memory = 8, cores = 8, pixelRatio = 2 } = {}) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query) => ({
      media: query,
      matches: query.includes('prefers-reduced-motion')
        ? reduced
        : query.includes('pointer: coarse')
          ? coarse
          : false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }))
  )
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    writable: true,
    value: pixelRatio,
  })
  Object.defineProperty(window.navigator, 'deviceMemory', { configurable: true, value: memory })
  Object.defineProperty(window.navigator, 'hardwareConcurrency', { configurable: true, value: cores })
}

/** A fake window for the pure detection function, with one trigger switched on. */
function fakeWindow({ width = 1440, coarse = false, reduced = false, memory, cores } = {}) {
  return {
    innerWidth: width,
    navigator: { deviceMemory: memory, hardwareConcurrency: cores },
    matchMedia: (query) => ({
      matches: query.includes('prefers-reduced-motion')
        ? reduced
        : query.includes('pointer: coarse')
          ? coarse
          : false,
    }),
  }
}

const SCENE_SOURCE = readFileSync('src/components/HrLeave3DScene.vue', 'utf8')
const PAGE_SOURCE = readFileSync('src/pages/HrLeaveRequestsPage.vue', 'utf8')
const CARD_COUNT_MIN = 6

function luminance(hex) {
  const h = hex.replace('#', '')
  const channels = [0, 2, 4].map((index) => parseInt(h.slice(index, index + 2), 16) / 255)
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

/** The `@media (max-width: Npx)` block that contains `needle`. */
function mediaBlock(source, maxWidth, needle) {
  const start = source.indexOf(`@media (max-width: ${maxWidth}px)`)
  if (start === -1) return ''
  const brace = source.indexOf('{', start)
  let depth = 0
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return ''
}

const ROW = {
  id: 'req-1',
  requestCode: 'LV-20261101-001',
  requester: { fullName: 'สมชาย ใจดี', employeeCode: 'EMP001' },
  departmentName: 'การเงิน',
  leaveTypeName: 'ลาป่วย',
  startDate: '2026-11-01',
  endDate: '2026-11-02',
  days: 2,
  status: 'pending',
  source: 'employee',
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body }
}

function stubFetch() {
  const fetchMock = vi.fn(async (url) => {
    const path = String(url)
    if (path.includes('/api/hr/directory/catalog')) {
      return jsonResponse({ ok: true, departments: [{ id: 'dep-1', name: 'การเงิน', isActive: true }] })
    }
    if (path.includes('/api/leave/hr/catalog')) {
      return jsonResponse({
        ok: true,
        types: [{ id: 'type-1', name: 'ลาป่วย' }],
        certificateRetentionDays: 90,
      })
    }
    if (path.includes('/api/leave/hr/requests')) {
      return jsonResponse({ ok: true, results: [ROW], hasMore: false, scanCapped: false })
    }
    return jsonResponse({ ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const SelectStub = { inheritAttrs: false, template: '<div class="select-stub"></div>' }
const AlertStub = { template: '<div class="alert-stub"><slot /></div>' }

function mountPage() {
  return mount(HrLeaveRequestsPage, {
    global: {
      stubs: {
        'v-select': SelectStub,
        'v-alert': AlertStub,
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  })
}

// happy-dom lays nothing out, so a mounted host has no size. Give every element
// a panel-sized box: that is what the component measures before it renders.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get() {
    return 320
  },
})
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get() {
    return 160
  },
})

beforeEach(() => {
  raf.nextId = 0
  raf.pending = new Map()
  raf.scheduled = 0
  raf.cancelled = 0
  threeMock.state.lastSize = null
  threeMock.state.materialColors.length = 0
  threeMock.state.meshes = 0
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
  clearAll()
})

afterEach(() => {
  vi.unstubAllGlobals()
  threeMock.state.failure = false
  clearAll()
})

describe('lite-mode detection', () => {
  it('is off on an ordinary desktop window', () => {
    expect(isLiteMode(fakeWindow({ width: 1440, memory: 8, cores: 8 }))).toBe(false)
    expect(allowsPointerTilt(fakeWindow({ width: 1440, memory: 8, cores: 8 }))).toBe(true)
  })

  it('is on for a coarse pointer', () => {
    expect(isLiteMode(fakeWindow({ coarse: true }))).toBe(true)
  })

  it('is on below 768px, and stays off at exactly 768px', () => {
    expect(isLiteMode(fakeWindow({ width: 390 }))).toBe(true)
    expect(isLiteMode(fakeWindow({ width: 767 }))).toBe(true)
    expect(isLiteMode(fakeWindow({ width: 768, memory: 8, cores: 8 }))).toBe(false)
  })

  it('is on when deviceMemory is set and 4 GB or less', () => {
    expect(isLiteMode(fakeWindow({ memory: 4 }))).toBe(true)
    expect(isLiteMode(fakeWindow({ memory: 0.5 }))).toBe(true)
    // An unset value is not a trigger.
    expect(isLiteMode(fakeWindow({ memory: undefined }))).toBe(false)
  })

  it('is on when hardwareConcurrency is 4 or less', () => {
    expect(isLiteMode(fakeWindow({ cores: 4 }))).toBe(true)
    expect(isLiteMode(fakeWindow({ cores: 2 }))).toBe(true)
    expect(prefersReducedMotion(fakeWindow({ reduced: true }))).toBe(true)
  })

  it('is on when the visitor prefers reduced motion, which also turns the tilt off', () => {
    const reduced = fakeWindow({ reduced: true, memory: 8, cores: 8 })
    expect(isLiteMode(reduced)).toBe(true)
    expect(allowsPointerTilt(reduced)).toBe(false)
  })

  it('treats a missing window as lite instead of guessing', () => {
    expect(isLiteMode(null)).toBe(true)
  })
})

describe('HrLeave3DScene', () => {
  it('never creates the scene on a lite device and never imports Three.js', async () => {
    stubEnvironment({ width: 390, coarse: true, memory: 2, cores: 2 })
    const importsBefore = threeMock.state.imported

    const wrapper = mount(HrLeave3DScene)
    await flushPromises()

    expect(threeMock.state.imported).toBe(importsBefore)
    expect(wrapper.find('canvas').exists()).toBe(false)
    expect(wrapper.classes()).toContain('scene-is-lite')
    wrapper.unmount()
  })

  it('builds the scene on a desktop and caps the pixel ratio at 1.5', async () => {
    stubEnvironment({ width: 1280, pixelRatio: 3 })
    const renderersBefore = threeMock.state.renderers

    const wrapper = mount(HrLeave3DScene)
    await flushPromises()
    await flushPromises()

    expect(threeMock.state.renderers).toBe(renderersBefore + 1)
    expect(threeMock.state.lastPixelRatio).toBe(1.5)
    expect(wrapper.find('canvas').exists()).toBe(true)
    expect(wrapper.classes()).not.toContain('scene-is-lite')
    wrapper.unmount()
  })

  it('falls back to the static gradient when WebGL cannot be created', async () => {
    stubEnvironment({ width: 1280 })
    threeMock.state.failure = true

    const wrapper = mount(HrLeave3DScene)
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('canvas').exists()).toBe(false)
    expect(wrapper.classes()).toContain('scene-is-lite')
    wrapper.unmount()
  })

  it('disposes the renderer, geometry and materials on unmount', async () => {
    stubEnvironment({ width: 1280 })
    const before = {
      disposedRenderers: threeMock.state.disposedRenderers,
      disposedGeometries: threeMock.state.disposedGeometries,
      disposedMaterials: threeMock.state.disposedMaterials,
    }

    const wrapper = mount(HrLeave3DScene)
    await flushPromises()
    await flushPromises()
    expect(raf.scheduled).toBeGreaterThan(0)

    wrapper.unmount()

    expect(threeMock.state.disposedRenderers).toBe(before.disposedRenderers + 1)
    expect(threeMock.state.disposedGeometries).toBeGreaterThan(before.disposedGeometries)
    expect(threeMock.state.disposedMaterials).toBeGreaterThan(before.disposedMaterials)
    expect(raf.cancelled).toBeGreaterThan(0)
    expect(raf.pending.size).toBe(0)
  })

  it('survives mounting and unmounting twice without leaving a canvas behind', async () => {
    stubEnvironment({ width: 1280 })
    const disposedBefore = threeMock.state.disposedRenderers

    for (let pass = 0; pass < 2; pass += 1) {
      const wrapper = mount(HrLeave3DScene, { attachTo: document.body })
      await flushPromises()
      await flushPromises()
      expect(document.querySelectorAll('canvas').length).toBe(1)
      wrapper.unmount()
      expect(document.querySelectorAll('canvas').length).toBe(0)
    }

    expect(threeMock.state.disposedRenderers).toBe(disposedBefore + 2)
  })

  it('stops the loop while the tab is hidden', async () => {
    stubEnvironment({ width: 1280 })
    const wrapper = mount(HrLeave3DScene)
    await flushPromises()
    await flushPromises()
    const cancelledBefore = raf.cancelled

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(raf.cancelled).toBeGreaterThan(cancelledBefore)
    wrapper.unmount()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
  })
})

describe('HR leave list motion', () => {
  it('keeps the cards flat and still when reduced motion is asked for', async () => {
    stubEnvironment({ width: 1280, reduced: true })
    stubFetch()

    const wrapper = mountPage()
    await flushPromises()

    const row = wrapper.find('.list-row')
    expect(row.exists()).toBe(true)
    expect(row.classes()).not.toContain('row-tilt')
    expect(row.text()).toContain('LV-20261101-001')

    row.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 40 })
    await row.trigger('pointermove', { clientX: 200, clientY: 0 })

    expect(row.element.style.getPropertyValue('--tilt-x')).toBe('')
    expect(row.element.style.getPropertyValue('--tilt-y')).toBe('')
    wrapper.unmount()
  })

  it('tilts the cards by at most 6 degrees on a desktop pointer', async () => {
    stubEnvironment({ width: 1280 })
    stubFetch()

    const wrapper = mountPage()
    await flushPromises()

    const row = wrapper.find('.list-row')
    expect(row.classes()).toContain('row-tilt')

    row.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 })
    await row.trigger('pointermove', { clientX: 200, clientY: 0 })

    const tiltX = Math.abs(Number.parseFloat(row.element.style.getPropertyValue('--tilt-x')))
    const tiltY = Math.abs(Number.parseFloat(row.element.style.getPropertyValue('--tilt-y')))
    expect(tiltX).toBeCloseTo(6, 5)
    expect(tiltY).toBeCloseTo(6, 5)

    // Leaving the row puts it back flat.
    await row.trigger('pointerleave')
    expect(row.element.style.getPropertyValue('--tilt-x')).toBe('')
    wrapper.unmount()
  })
})

describe('scene redesign', () => {
  it('floats status-coloured cards around a central calendar tile', async () => {
    stubEnvironment({ width: 1280 })

    const wrapper = mount(HrLeave3DScene)
    await flushPromises()
    await flushPromises()

    expect(threeMock.state.materialColors).toContain(0x34d399) // approved green
    expect(threeMock.state.materialColors).toContain(0xfbbf24) // pending amber
    expect(threeMock.state.materialColors).toContain(0xf87171) // rejected red
    expect(threeMock.state.materialColors).toContain(0x4f46e5) // indigo calendar
    expect(threeMock.state.materialColors).toContain(0x8b5cf6) // violet accent

    // Eight orbiting cards, plus the calendar tile, its header, six day cells,
    // its shadow and the orbit path.
    expect(SCENE_SOURCE).toMatch(/const CARD_COUNT = (?:[6-9]|10)\b/)
    expect(threeMock.state.meshes).toBeGreaterThanOrEqual(CARD_COUNT_MIN)
    wrapper.unmount()
  })

  it('keeps the band short on phones and taller from 600px up', () => {
    const phoneHeight = Number(SCENE_SOURCE.match(/height: (\d+)px/)[1])
    expect(phoneHeight).toBeGreaterThanOrEqual(120)
    expect(phoneHeight).toBeLessThanOrEqual(160)
    expect(SCENE_SOURCE).toContain('@media (min-width: 600px)')
    expect(SCENE_SOURCE).toContain('@media (min-width: 960px)')
    expect(SCENE_SOURCE).toContain('height: 216px')
  })

  it('draws the indigo-to-violet gradient in lite mode, never an empty box', () => {
    expect(SCENE_SOURCE).toContain(
      'linear-gradient(135deg, #eef2ff 0%, #e4e9ff 46%, #ede9fe 100%)'
    )
    expect(SCENE_SOURCE).toMatch(/\.scene-canvas\s*\{[^}]*width: 100%[^}]*height: 100%/)
  })
})

describe('responsive contract', () => {
  it('sizes the buttons and Vuetify fields to a 44px tap target', () => {
    expect(PAGE_SOURCE).toContain('--tap-target: 44px')
    const uses = PAGE_SOURCE.match(/min-height: var\(--tap-target\)/g) ?? []
    expect(uses.length).toBeGreaterThanOrEqual(4)
    expect(PAGE_SOURCE).toContain('.field :deep(.v-field) {')
  })

  it('puts every hover style behind a fine-pointer media query', () => {
    const hoverMedia = PAGE_SOURCE.indexOf('@media (hover: hover) and (pointer: fine)')
    expect(hoverMedia).toBeGreaterThan(-1)
    expect(PAGE_SOURCE.indexOf(':hover')).toBeGreaterThan(hoverMedia)
    expect(PAGE_SOURCE).toContain('.list-row.row-tilt:hover')
  })

  it('turns the detail panel into a full-screen sheet below 600px', () => {
    const block = mediaBlock(PAGE_SOURCE, 599)
    expect(block).toContain('position: fixed')
    expect(block).toContain('inset: 0')
    expect(block).toContain('z-index: 70')
    expect(block).toContain('env(safe-area-inset-bottom)')
    // The sheet slides up instead of opening on a perspective, so it cannot
    // paint outside the viewport.
    expect(block).toContain('translate3d(0, 16px, 0)')
  })

  it('never animates width, height, top or left on the cards', () => {
    const entrance = PAGE_SOURCE.slice(
      PAGE_SOURCE.indexOf('.leave-card-enter-active'),
      PAGE_SOURCE.indexOf('.list-row:last-of-type')
    )
    expect(entrance).toContain('opacity')
    expect(entrance).toContain('transform')
    for (const property of ['width', 'height', 'top:', 'left:']) {
      expect(entrance).not.toContain(property)
    }
  })

  it('disables the tilt for a coarse pointer', async () => {
    stubEnvironment({ width: 1280, coarse: true })
    stubFetch()

    const wrapper = mountPage()
    await flushPromises()

    const row = wrapper.find('.list-row')
    expect(row.exists()).toBe(true)
    expect(row.classes()).not.toContain('row-tilt')

    row.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 })
    await row.trigger('pointermove', { clientX: 200, clientY: 0 })
    expect(row.element.style.getPropertyValue('--tilt-x')).toBe('')
    wrapper.unmount()
  })

  it('resizes the canvas through ResizeObserver, not only window.resize', async () => {
    stubEnvironment({ width: 1280 })
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

    const wrapper = mount(HrLeave3DScene)
    await flushPromises()
    await flushPromises()

    expect(callbacks.length).toBe(1)
    expect(threeMock.state.lastSize).toEqual({ width: 320, height: 160 })

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 640,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 180,
    })
    callbacks[0]()
    expect(threeMock.state.lastSize).toEqual({ width: 640, height: 180 })

    wrapper.unmount()
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 320,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 160,
    })
  })
})

describe('page palette', () => {
  const TEXT_PAIRS = [
    ['#1e1b4b', '#ffffff'],
    ['#1e1b4b', '#f8fafc'],
    ['#1e1b4b', '#f1f5f9'],
    ['#475569', '#ffffff'],
    ['#475569', '#f8fafc'],
    ['#475569', '#f1f5f9'],
    ['#ffffff', '#4f46e5'],
    ['#ffffff', '#4338ca'],
    ['#4f46e5', '#ffffff'],
    ['#4f46e5', '#f8fafc'],
    ['#4338ca', '#eef2ff'],
    ['#8a4b06', '#fff2df'],
    ['#1c6b3f', '#e6f4ec'],
    ['#a01b1b', '#fdecec'],
    ['#6a6a6a', '#f1f1f1'],
    ['#92400e', '#f8fafc'],
    ['#b91c1c', '#ffffff'],
  ]

  it('declares the approved tokens on the page root', () => {
    expect(PAGE_SOURCE).toContain('--indigo-600: #4f46e5')
    expect(PAGE_SOURCE).toContain('--indigo-900: #1e1b4b')
    expect(PAGE_SOURCE).toContain('--violet-500: #8b5cf6')
    expect(PAGE_SOURCE).toContain('--slate-50: #f8fafc')
    expect(PAGE_SOURCE).toContain('--slate-200: #e2e8f0')
    // Violet never carries text: at 4.23 on white it would miss AA.
    expect(PAGE_SOURCE).not.toContain('color: var(--violet-500)')
    // Vuetify's 38%-opacity placeholder (about 2.4:1) is replaced by slate-600.
    expect(PAGE_SOURCE).toContain('input::placeholder')
  })

  it('keeps every text pair at WCAG AA (4.5:1)', () => {
    for (const [foreground, background] of TEXT_PAIRS) {
      const ratio = contrastRatio(foreground, background)
      expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
