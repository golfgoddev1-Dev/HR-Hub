// @vitest-environment happy-dom
// The HR leave page's 3D layer: lite-mode detection, the scene that is never
// created on a lite device, the card tilt that reduced motion turns off, and the
// disposal that has to run on unmount.
//
// WebGL is mocked here: no real GPU is involved, and `three` is replaced by a
// small module that counts its own imports, renderers and disposals.
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    }
    add(...items) {
      this.children.push(...items)
      return this
    }
  }

  class BoxGeometry extends Geometry {}
  class TorusGeometry extends Geometry {}
  class Scene extends Object3D {}
  class Group extends Object3D {}

  class Mesh extends Object3D {
    constructor(geometry, material) {
      super()
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
      DirectionalLight: Light,
      BoxGeometry,
      Group,
      Mesh,
      MeshStandardMaterial: Material,
      PerspectiveCamera,
      Scene,
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
