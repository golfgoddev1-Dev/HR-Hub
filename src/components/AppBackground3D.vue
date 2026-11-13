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
// Three.js is a dynamic import: the library keeps its own chunk, and this
// component's code is fetched on demand too (AppLayout holds only an async
// reference), so the entry bundle is untouched.
//
// What is drawn is decided by src/lib/background-quality.js: three 3D tiers plus
// a CSS-only static tier, chosen from device hints and then from a 60-frame
// benchmark that may only walk down.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  QUALITY_TIERS,
  createBenchmark,
  deviceHints,
  initialTier,
  normalizedTier,
  veilBackground,
} from '../lib/background-quality.js'

// Soft tints only. The darkest pixel the canvas may paint is indigo-200
// (#c7d2fe); anything deeper would push the screens' muted grey text (#5c7176),
// which already sits at 4.70:1 on the #f3f6f5 shell, below WCAG AA once the
// veil is composited. Violet and indigo therefore appear as washes, not slabs.
const CARD_TINTS = [0xc7d2fe, 0xddd6fe, 0xe0e7ff]
const SPHERE_TINTS = [0xddd6fe, 0xc7d2fe]
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
const veilStyle = { background: veilBackground() }

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

  const ambient = new THREE.AmbientLight(0xffffff, 0.95)
  const key = new THREE.DirectionalLight(0xffffff, 0.85)
  key.position.set(4, 7, 9)
  group.add(ambient, key)
  scene.add(group)

  const dummy = new THREE.Object3D()
  const tint = new THREE.Color()

  const cardGeometry = roundedCardGeometry(THREE, CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS)
  const cardMaterial = makeMaterial(config, 0.66)
  const cardMesh = new THREE.InstancedMesh(cardGeometry, cardMaterial, config.cardCount)
  cardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  cardMesh.frustumCulled = false
  disposables.push(cardGeometry, cardMaterial, cardMesh)

  const cards = []
  for (let index = 0; index < config.cardCount; index += 1) {
    const card = {
      nx: between(index * 3 + 1, -1, 1),
      ny: between(index * 3 + 2, -1, 1),
      nz: between(index * 3 + 3, -1, 1),
      scale: between(index * 5 + 11, 0.55, 1.35),
      tiltX: between(index * 7 + 2, -0.4, 0.4),
      tiltY: between(index * 7 + 3, -0.5, 0.5),
      tiltZ: between(index * 7 + 4, -0.28, 0.28),
      bob: between(index * 11 + 5, 0.16, 0.5),
      phase: between(index * 13 + 7, 0, Math.PI * 2),
      tint: CARD_TINTS[index % CARD_TINTS.length],
    }
    cards.push(card)
    cardMesh.setColorAt(index, tint.setHex(card.tint))
  }
  if (cardMesh.instanceColor) cardMesh.instanceColor.needsUpdate = true
  group.add(cardMesh)

  const sphereGeometry = new THREE.SphereGeometry(
    1,
    Math.max(6, config.sphereSegments),
    Math.max(5, Math.round(config.sphereSegments * 0.65))
  )
  const sphereMaterial = makeMaterial(config, 0.5)
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

  const update = (time) => {
    const halfWidth = field.width / 2
    const halfHeight = field.height / 2
    // Cards keep their proportion on a narrow phone screen.
    const size = Math.min(1.2, Math.max(0.42, field.width / 22))

    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index]
      const bob = Math.sin(time * 0.26 + card.phase)
      const sway = Math.cos(time * 0.19 + card.phase)
      dummy.position.set(
        card.nx * halfWidth * 0.94 + sway * 0.5,
        card.ny * halfHeight * 0.94 + bob * card.bob,
        card.nz * DEPTH - 2
      )
      dummy.rotation.set(
        card.tiltX + bob * 0.05,
        card.tiltY + sway * 0.09,
        card.tiltZ + bob * 0.04
      )
      dummy.scale.setScalar(card.scale * size * (1 + bob * 0.015))
      dummy.updateMatrix()
      cardMesh.setMatrixAt(index, dummy.matrix)
    }
    cardMesh.instanceMatrix.needsUpdate = true

    for (let index = 0; index < spheres.length; index += 1) {
      const sphere = spheres[index]
      const drift = Math.sin(time * 0.21 + sphere.phase)
      dummy.position.set(
        sphere.nx * halfWidth * 0.82 + drift * 0.3,
        sphere.ny * halfHeight * 0.82 + Math.cos(time * 0.17 + sphere.phase) * 0.4,
        sphere.nz * DEPTH - 4
      )
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(sphere.scale * (1 + drift * 0.06))
      dummy.updateMatrix()
      sphereMesh.setMatrixAt(index, dummy.matrix)
    }
    sphereMesh.instanceMatrix.needsUpdate = true
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
    <span class="app-background-veil" :style="veilStyle"></span>
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
  /* Also the whole of the "static" tier: no canvas, just this wash. */
  background:
    radial-gradient(120% 120% at 8% 0%, rgba(139, 92, 246, 0.24) 0%, rgba(139, 92, 246, 0) 58%),
    radial-gradient(110% 120% at 94% 102%, rgba(79, 70, 229, 0.22) 0%, rgba(79, 70, 229, 0) 62%),
    linear-gradient(135deg, #eef2ff 0%, #e4e9ff 48%, #ede9fe 100%);
}

.app-background-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* The slate-50 veil that keeps text at WCAG AA over whatever the canvas paints. */
.app-background-veil {
  position: absolute;
  inset: 0;
  display: block;
  pointer-events: none;
}
</style>
