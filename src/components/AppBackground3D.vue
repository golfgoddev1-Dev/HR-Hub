<script setup>
// The app-wide decorative background on signed-in screens.
//
// It is mounted by src/components/AppLayout.vue only: employee, HR and admin
// pages get it, while /login, /set-pin, /change-pin, /pending, the public meeting
// registration page and the printed leave form never render that layout, so no
// canvas is ever created there.
//
// The layer is aria-hidden, fixed, pointer-events: none and painted at z-index 0
// under the content box, so it can never cover a link, a field or the dock.
// Nothing is painted over it either: the layer is meant to be seen at full
// strength, and every block that carries text sits on its own near-solid panel
// (see the signed-in surface rules in src/styles.css).
// Three.js is a dynamic import: the library keeps its own chunk, and this
// component's code is fetched on demand too (AppLayout holds only an async
// reference), so the entry bundle is untouched.
//
// What is drawn is decided by src/lib/background-quality.js: three 3D tiers plus
// a CSS-only static tier, chosen from device hints and then from a 60-frame
// benchmark that may only walk down.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  QUALITY_TIERS,
  createBenchmark,
  deviceHints,
  initialTier,
  normalizedTier,
} from '../lib/background-quality.js'

// The full brand range. No text ever sits on the canvas — every block that
// carries text is on its own near-solid panel — so the scene is drawn at full
// strength instead of as a pale tint.
// Brand indigo and violet, plus the three leave-status colours the app already
// uses (approved green, pending amber, rejected red) so the field reads as a
// leave tool. No lettering is drawn in the scene.
const CARD_TINTS = [
  0x3730a3, 0x6d28d9, 0x818cf8, 0x4f46e5, 0x16a34a, 0x6d28d9, 0x818cf8, 0x3730a3,
  0xd97706, 0x4f46e5, 0x16a34a, 0x818cf8, 0xdc2626, 0x6d28d9, 0x3730a3, 0x4f46e5,
]
const SPHERE_TINTS = [0x8b5cf6, 0x818cf8, 0x34d399]
const CALENDAR_TINTS = [0xc7d2fe, 0x86efac, 0xfcd34d, 0xddd6fe, 0xa5b4fc, 0xfca5a5]
const CARD_WIDTH = 1.7
const CARD_HEIGHT = 1.05
const CARD_RADIUS = 0.22
const CAMERA_FOV = 55
const CAMERA_Z = 14
const DEPTH = 7
const MAX_PARALLAX = 0.85

// The root element is aria-hidden because the layer carries no information:
// every text node, button and leave row stays ordinary HTML on top of it.
const hints = deviceHints()
// Decided before the first paint, so a phone or a reduced-motion visitor never
// flashes a canvas.
const tier = ref(initialTier(hints))

const host = ref(null)
const canvasEl = ref(null)

const isStatic = computed(() => tier.value === 'static')

// The panels' frosting is CSS, so the tier is published on <html>: medium and low
// drop to an 8px blur (and lose tilt), static drops the blur entirely. Removing
// the attribute on unmount sends the panels back to the full-strength default,
// which is also what /login (no background at all) uses.
watch(
  tier,
  (value) => {
    if (typeof document === 'undefined') return
    document.documentElement.dataset.bgTier = value
  },
  { immediate: true }
)

const field = { width: 1, height: 1 }
const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 }

let THREE = null
let renderer = null
let scene = null
let camera = null
let current = null
let benchmark = null
let disposables = []
let frameId = 0
let running = false
let inView = true
let disposed = false
let lastFrameAt = 0
let lastRenderAt = 0
let elapsed = 0
let resizeObserver = null
let intersectionObserver = null

function seeded(index) {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

function between(index, min, max) {
  return min + seeded(index) * (max - min)
}

/** A rounded rectangle, flat: one cheap shape for every card instance. */
function roundedCardGeometry(three, width, height, radius) {
  const halfWidth = width / 2
  const halfHeight = height / 2
  const r = Math.min(radius, halfWidth, halfHeight)
  const shape = new three.Shape()
  shape.moveTo(-halfWidth + r, -halfHeight)
  shape.lineTo(halfWidth - r, -halfHeight)
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + r)
  shape.lineTo(halfWidth, halfHeight - r)
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - r, halfHeight)
  shape.lineTo(-halfWidth + r, halfHeight)
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - r)
  shape.lineTo(-halfWidth, -halfHeight + r)
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + r, -halfHeight)
  return new three.ShapeGeometry(shape, 8)
}

/** MeshStandardMaterial at high, Lambert at medium, Basic at low. */
function makeMaterial(config, opacity) {
  const options = {
    color: 0xffffff,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  }
  if (config.material === 'standard') {
    return new THREE.MeshStandardMaterial({ ...options, roughness: 0.45, metalness: 0.05 })
  }
  if (config.material === 'lambert') return new THREE.MeshLambertMaterial(options)
  return new THREE.MeshBasicMaterial(options)
}

/**
 * Builds the objects for one tier: one InstancedMesh of translucent rounded
 * cards and one InstancedMesh of soft spheres, so the whole scene is two draw
 * calls whatever the tier. Everything created is pushed to `disposables`.
 */
function buildScene(config) {
  if (!THREE || !scene) return

  const group = new THREE.Group()
  group.rotation.x = -0.04

  // Ambient + key stay below 1.0 combined: brighter light clips the instance
  // colours to white and the cards read as grey slabs instead of indigo ones.
  const ambient = new THREE.AmbientLight(0xffffff, 0.62)
  const key = new THREE.DirectionalLight(0xffffff, 0.5)
  key.position.set(4, 7, 9)
  group.add(ambient, key)
  scene.add(group)

  const dummy = new THREE.Object3D()
  const tint = new THREE.Color()

  // One rounded card geometry is shared by all three depth planes, so it is
  // pushed once and disposed once.
  const cardGeometry = roundedCardGeometry(THREE, CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS)
  disposables.push(cardGeometry)

  // Three depth planes. Each plane is its own InstancedMesh with its own base z
  // and its own share of the pointer parallax, so the field has real depth and a
  // near card moves more than a far one.
  const planes = []
  const planeCount = Math.max(1, config.planeCount)
  const perPlane = Math.max(1, Math.floor(config.cardCount / planeCount))

  for (let plane = 0; plane < planeCount; plane += 1) {
    const material = makeMaterial(config, 0.46 + plane * 0.13)
    const mesh = new THREE.InstancedMesh(cardGeometry, material, perPlane)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    disposables.push(material, mesh)
    group.add(mesh)

    const cards = []
    for (let index = 0; index < perPlane; index += 1) {
      const seed = plane * 97 + index
      const card = {
        nx: between(seed * 3 + 1, -1, 1),
        ny: between(seed * 3 + 2, -1, 1),
        nz: between(seed * 3 + 3, -1, 1),
        scale: between(seed * 5 + 11, 0.55, 1.3),
        tiltX: between(seed * 7 + 2, -0.4, 0.4),
        tiltY: between(seed * 7 + 3, -0.5, 0.5),
        tiltZ: between(seed * 7 + 4, -0.28, 0.28),
        bob: between(seed * 11 + 5, 0.16, 0.5),
        phase: between(seed * 13 + 7, 0, Math.PI * 2),
        tint: CARD_TINTS[(plane * 7 + index) % CARD_TINTS.length],
      }
      cards.push(card)
      mesh.setColorAt(index, tint.setHex(card.tint))
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

    planes.push({
      mesh,
      cards,
      // 0 for the far plane, 1 for the nearest: the parallax share.
      depth: planeCount === 1 ? 1 : plane / (planeCount - 1),
    })
  }

  const sphereGeometry = new THREE.SphereGeometry(
    1,
    Math.max(6, config.sphereSegments),
    Math.max(5, Math.round(config.sphereSegments * 0.65))
  )
  const sphereMaterial = makeMaterial(config, 0.7)
  const sphereMesh = new THREE.InstancedMesh(sphereGeometry, sphereMaterial, config.sphereCount)
  sphereMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  sphereMesh.frustumCulled = false
  disposables.push(sphereGeometry, sphereMaterial, sphereMesh)

  const spheres = []
  for (let index = 0; index < config.sphereCount; index += 1) {
    const sphere = {
      nx: between(index * 17 + 3, -0.9, 0.9),
      ny: between(index * 19 + 5, -0.9, 0.9),
      nz: between(index * 23 + 7, -1, 0),
      scale: between(index * 29 + 11, 0.22, 0.62),
      phase: between(index * 31 + 13, 0, Math.PI * 2),
      tint: SPHERE_TINTS[index % SPHERE_TINTS.length],
    }
    spheres.push(sphere)
    sphereMesh.setColorAt(index, tint.setHex(sphere.tint))
  }
  if (sphereMesh.instanceColor) sphereMesh.instanceColor.needsUpdate = true
  group.add(sphereMesh)

  // The calendar motif: a small month grid of rounded cells in the far plane.
  // It is a shape, never a date or a label.
  let calendar = null
  if (config.calendarCellCount > 0) {
    const geometry = roundedCardGeometry(THREE, 0.52, 0.34, 0.07)
    const material = makeMaterial(config, 0.42)
    const mesh = new THREE.InstancedMesh(geometry, material, config.calendarCellCount)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    disposables.push(geometry, material, mesh)
    group.add(mesh)

    const columns = 7
    const rows = Math.ceil(config.calendarCellCount / columns)
    const cells = []
    for (let index = 0; index < config.calendarCellCount; index += 1) {
      const column = index % columns
      const row = Math.floor(index / columns)
      cells.push({
        x: (column - (columns - 1) / 2) * 0.62,
        y: ((rows - 1) / 2 - row) * 0.44,
        phase: between(index * 37 + 3, 0, Math.PI * 2),
        tint: CALENDAR_TINTS[index % CALENDAR_TINTS.length],
      })
      mesh.setColorAt(index, tint.setHex(cells.at(-1).tint))
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    calendar = { mesh, cells }
  }

  // Light glints: additive streaks that sweep across the glass at a slow, uneven
  // pace. They fade in and out by scale, so the wrap is never visible.
  let glints = null
  if (config.glintCount > 0) {
    const geometry = roundedCardGeometry(THREE, 2.4, 0.16, 0.08)
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.InstancedMesh(geometry, material, config.glintCount)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    disposables.push(geometry, material, mesh)
    group.add(mesh)

    const streaks = []
    for (let index = 0; index < config.glintCount; index += 1) {
      streaks.push({
        y: between(index * 41 + 5, -0.85, 0.85),
        phase: between(index * 43 + 7, 0, 1),
        speed: between(index * 47 + 11, 0.018, 0.042),
        lean: between(index * 53 + 13, -0.5, 0.5),
        level: index % 3,
      })
    }
    glints = { mesh, streaks }
  }

  // Dust: one Points draw call of drifting motes, wrapped inside the field.
  let dust = null
  if (config.particleCount > 0) {
    const positions = new Float32Array(config.particleCount * 3)
    const seeds = new Float32Array(config.particleCount)
    for (let index = 0; index < config.particleCount; index += 1) {
      positions[index * 3] = between(index * 59 + 3, -1, 1) * 11
      positions[index * 3 + 1] = between(index * 61 + 5, -1, 1) * 7
      positions[index * 3 + 2] = between(index * 67 + 7, -1, 0) * DEPTH - 1
      seeds[index] = between(index * 71 + 11, 0, 1)
    }
    const geometry = new THREE.BufferGeometry()
    const attribute = new THREE.BufferAttribute(positions, 3)
    attribute.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('position', attribute)
    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.055,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      sizeAttenuation: true,
    })
    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    disposables.push(geometry, material, points)
    group.add(points)
    dust = { points, attribute, seeds, count: config.particleCount }
  }

  const update = (time) => {
    const halfWidth = field.width / 2
    const halfHeight = field.height / 2
    // Cards keep their proportion on a narrow phone screen.
    const size = Math.min(1.2, Math.max(0.42, field.width / 22))
    const tilt = config.cardTilt === true

    // Each plane carries a little of the pointer offset, the near one the most.
    for (let plane = 0; plane < planes.length; plane += 1) {
      const { mesh, cards: planeCards, depth } = planes[plane]
      const share = 0.16 + depth * 0.5
      const baseZ = -2.2 - (1 - depth) * 4.4

      for (let index = 0; index < planeCards.length; index += 1) {
        const card = planeCards[index]
        const bob = Math.sin(time * 0.26 + card.phase)
        const sway = Math.cos(time * 0.19 + card.phase)
        dummy.position.set(
          card.nx * halfWidth * 0.94 + sway * 0.5 + pointer.x * share,
          card.ny * halfHeight * 0.94 + bob * card.bob - pointer.y * share * 0.7,
          card.nz * DEPTH * 0.8 + baseZ
        )
        dummy.rotation.set(
          card.tiltX + bob * 0.05,
          card.tiltY + sway * 0.09,
          card.tiltZ + bob * 0.04
        )
        dummy.scale.setScalar(card.scale * size * (1 + bob * 0.015) * (0.72 + depth * 0.28))
        dummy.updateMatrix()
        mesh.setMatrixAt(index, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      if (tilt) mesh.rotation.y = pointer.x * 0.04
    }

    for (let index = 0; index < spheres.length; index += 1) {
      const sphere = spheres[index]
      const drift = Math.sin(time * 0.21 + sphere.phase)
      dummy.position.set(
        sphere.nx * halfWidth * 0.82 + drift * 0.3 + pointer.x * 0.4,
        sphere.ny * halfHeight * 0.82 + Math.cos(time * 0.17 + sphere.phase) * 0.4 -
          pointer.y * 0.3,
        sphere.nz * DEPTH - 4
      )
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(sphere.scale * (1 + drift * 0.06))
      dummy.updateMatrix()
      sphereMesh.setMatrixAt(index, dummy.matrix)
    }
    sphereMesh.instanceMatrix.needsUpdate = true

    if (calendar) {
      const { mesh, cells } = calendar
      // Sits behind the cards, tilting very slightly like a sheet on a desk.
      const lean = Math.sin(time * 0.17) * 0.06
      for (let index = 0; index < cells.length; index += 1) {
        const cell = cells[index]
        const bob = Math.sin(time * 0.3 + cell.phase) * 0.04
        dummy.position.set(
          cell.x * Math.min(1, halfHeight / 4.2) + pointer.x * 0.2,
          cell.y * Math.min(1, halfHeight / 4.2) + bob - pointer.y * 0.15,
          -8.6
        )
        dummy.rotation.set(lean, lean * 0.6, 0)
        dummy.scale.setScalar(0.9)
        dummy.updateMatrix()
        mesh.setMatrixAt(index, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    }

    if (glints) {
      const { mesh, streaks } = glints
      for (let index = 0; index < streaks.length; index += 1) {
        const streak = streaks[index]
        const travel = (time * streak.speed + streak.phase) % 1
        const fade = Math.sin(travel * Math.PI)
        dummy.position.set(
          travel * halfWidth * 2.4 - halfWidth * 1.2,
          streak.y * halfHeight * 0.9 + Math.sin(travel * Math.PI * 2) * 0.4,
          -3.4 - streak.level * 0.5
        )
        dummy.rotation.set(0, 0, streak.lean * 0.5)
        dummy.scale.set(Math.max(0.001, fade), Math.max(0.001, fade), 1)
        dummy.updateMatrix()
        mesh.setMatrixAt(index, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    }

    if (dust) {
      const { attribute, seeds, count } = dust
      const positions = attribute.array
      for (let index = 0; index < count; index += 1) {
        const at = index * 3
        const speed = 0.16 + seeds[index] * 0.34
        positions[at + 1] += speed * 0.014
        if (positions[at + 1] > halfHeight + 1) positions[at + 1] = -halfHeight - 1
        positions[at] += Math.sin(time * 0.4 + seeds[index] * 6.28) * 0.004
        if (positions[at] > halfWidth + 1) positions[at] = -halfWidth - 1
        if (positions[at] < -halfWidth - 1) positions[at] = halfWidth + 1
      }
      attribute.needsUpdate = true
    }
  }

  const dispose = () => {
    if (group.parent) group.parent.remove(group)
    for (const item of disposables) {
      if (item && typeof item.dispose === 'function') item.dispose()
    }
    disposables = []
  }

  current = { group, update, dispose }
}

function stopLoop() {
  if (frameId) cancelAnimationFrame(frameId)
  frameId = 0
  running = false
}

function shouldRun() {
  if (disposed || isStatic.value || renderer === null) return false
  if (!inView) return false
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

function startLoop() {
  if (running || !shouldRun()) return
  running = true
  lastFrameAt = 0
  frameId = requestAnimationFrame(tick)
}

function driftCamera(delta) {
  if (!camera) return
  const config = QUALITY_TIERS[tier.value]
  const strength = config.mouseParallax ? MAX_PARALLAX : MAX_PARALLAX * 0.35
  const ease = Math.min(1, delta * 2.5)
  pointer.x += (pointer.targetX - pointer.x) * ease
  pointer.y += (pointer.targetY - pointer.y) * ease

  camera.position.x = Math.sin(elapsed * 0.16) * 0.55 + pointer.x * strength
  camera.position.y = Math.cos(elapsed * 0.12) * 0.4 - pointer.y * strength * 0.7
  camera.lookAt(0, 0, 0)
}

function tick(now) {
  if (!shouldRun()) {
    running = false
    frameId = 0
    return
  }
  frameId = requestAnimationFrame(tick)

  const delta = lastFrameAt > 0 ? now - lastFrameAt : 0
  lastFrameAt = now

  // The benchmark sees raw frame time, so the frame cap below cannot flatter it.
  if (benchmark && !benchmark.done && delta > 0) {
    const verdict = benchmark.push(delta)
    if (verdict.decided) {
      switchTo(verdict.tier)
      return
    }
  }

  const config = QUALITY_TIERS[tier.value]
  if (config.targetFps > 0 && now - lastRenderAt < 1000 / config.targetFps - 1) return
  lastRenderAt = now

  const seconds = delta > 0 ? Math.min(delta, 100) / 1000 : 1 / 60
  elapsed += seconds

  driftCamera(seconds)
  if (current) current.update(elapsed)
  renderer.render(scene, camera)
}

function resize() {
  if (!renderer || !camera || !host.value) return
  const width = Math.max(1, Math.round(host.value.clientWidth || window.innerWidth || 1))
  const height = Math.max(1, Math.round(host.value.clientHeight || window.innerHeight || 1))
  const aspect = width / height

  renderer.setSize(width, height, false)
  camera.aspect = aspect
  camera.updateProjectionMatrix()

  field.height = 2 * Math.tan((CAMERA_FOV * Math.PI) / 360) * CAMERA_Z
  field.width = field.height * aspect

  if (width <= 1 || height <= 1) stopLoop()
  else startLoop()
}

function disposeScene() {
  if (current) current.dispose()
  current = null
}

function disposeRenderer() {
  if (!renderer) return
  renderer.dispose()
  if (typeof renderer.forceContextLoss === 'function') renderer.forceContextLoss()
  renderer = null
}

function removeCanvas() {
  const canvas = canvasEl.value
  if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)
}

/**
 * Fall back to the CSS gradient with no WebGL, silently. The canvas itself is
 * removed by the template's v-if, so Vue keeps ownership of that node.
 */
function fallbackToStatic() {
  tier.value = 'static'
  stopLoop()
  disposeScene()
  disposeRenderer()
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') stopLoop()
  else startLoop()
}

function onPointerMove(event) {
  if (!QUALITY_TIERS[tier.value].mouseParallax) return
  const width = window.innerWidth || 1
  const height = window.innerHeight || 1
  pointer.targetX = ((event.clientX ?? 0) / width) * 2 - 1
  pointer.targetY = ((event.clientY ?? 0) / height) * 2 - 1
}

function onPointerLeave() {
  pointer.targetX = 0
  pointer.targetY = 0
}

function switchTo(name) {
  const next = normalizedTier(name)
  if (next === tier.value) return

  if (next === 'static') {
    fallbackToStatic()
    return
  }

  tier.value = next
  disposeScene()
  if (!renderer || !scene) return
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY_TIERS[next].pixelRatioCap))
  resize()
  buildScene(QUALITY_TIERS[next])
}

async function mount() {
  if (isStatic.value) return

  try {
    THREE = await import('three')
  } catch {
    fallbackToStatic()
    return
  }
  if (disposed || isStatic.value) return

  const canvas = canvasEl.value
  if (!canvas) {
    fallbackToStatic()
    return
  }

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: tier.value !== 'low',
      powerPreference: 'low-power',
    })
  } catch {
    fallbackToStatic()
    return
  }

  renderer.shadowMap.enabled = false
  const config = QUALITY_TIERS[tier.value]
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, config.pixelRatioCap))

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 80)
  camera.position.set(0, 0, CAMERA_Z)
  camera.lookAt(0, 0, 0)

  try {
    buildScene(config)
  } catch {
    fallbackToStatic()
    return
  }

  benchmark = createBenchmark(tier.value, {
    coarsePointer: hints.coarsePointer,
    reducedMotion: hints.reducedMotion,
  })

  window.addEventListener('resize', resize)
  window.addEventListener('orientationchange', resize)
  if (hints.finePointer) {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerleave', onPointerLeave)
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  if (typeof ResizeObserver === 'function' && host.value) {
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host.value)
  }
  if (typeof IntersectionObserver === 'function' && host.value) {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        inView = entries.some((entry) => entry.isIntersecting === true)
        if (inView) startLoop()
        else stopLoop()
      },
      { threshold: 0 }
    )
    intersectionObserver.observe(host.value)
  }

  resize()
}

onMounted(mount)

onBeforeUnmount(() => {
  disposed = true
  stopLoop()
  window.removeEventListener('resize', resize)
  window.removeEventListener('orientationchange', resize)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerleave', onPointerLeave)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (resizeObserver) resizeObserver.disconnect()
  resizeObserver = null
  if (intersectionObserver) intersectionObserver.disconnect()
  intersectionObserver = null

  disposeScene()
  disposeRenderer()
  removeCanvas()
  if (typeof document !== 'undefined') delete document.documentElement.dataset.bgTier

  scene = null
  camera = null
  THREE = null
  benchmark = null
})
</script>

<template>
  <div
    ref="host"
    class="app-background"
    :class="`app-background--${tier}`"
    :data-tier="tier"
    data-app-background
    aria-hidden="true"
  >
    <canvas
      v-if="!isStatic"
      ref="canvasEl"
      class="app-background-canvas"
      aria-hidden="true"
    ></canvas>
    <!-- A slow light sweep over the gradient. Purely CSS, transparent, and drawn
         under every panel; the static and reduced-motion tiers switch it off. -->
    <div class="app-background-sweep" aria-hidden="true"></div>
  </div>
</template>

<style scoped>
/* Fixed, full viewport, behind the content box (which is z-index 1 in the
   layout). pointer-events: none means even a stray click passes through. */
.app-background {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  /* Also the whole of the "static" tier: no canvas, just this indigo-to-violet
     field. It is the visible backdrop, so it is not toned down by a veil. */
  background:
    radial-gradient(115% 105% at 4% -6%, rgba(79, 70, 229, 0.95) 0%, rgba(79, 70, 229, 0) 56%),
    radial-gradient(120% 115% at 98% 104%, rgba(139, 92, 246, 0.9) 0%, rgba(139, 92, 246, 0) 58%),
    linear-gradient(135deg, #c7d2fe 0%, #e0e7ff 46%, #ddd6fe 100%);
}

.app-background-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.app-background-sweep {
  position: absolute;
  inset: -30%;
  pointer-events: none;
  background: conic-gradient(
    from 120deg at 50% 50%,
    rgba(255, 255, 255, 0) 0deg,
    rgba(255, 255, 255, 0.16) 60deg,
    rgba(255, 255, 255, 0) 140deg,
    rgba(199, 210, 254, 0.16) 220deg,
    rgba(255, 255, 255, 0) 320deg
  );
  mix-blend-mode: screen;
  will-change: transform;
  animation: background-sweep 26s linear infinite;
}

@keyframes background-sweep {
  from { transform: rotate(0turn) scale(1.05); }
  to { transform: rotate(1turn) scale(1.05); }
}

.app-background--static .app-background-sweep { display: none; }

@media (prefers-reduced-motion: reduce) {
  .app-background-sweep { animation: none; }
}


</style>
