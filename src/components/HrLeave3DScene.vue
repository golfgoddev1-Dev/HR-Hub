<script setup>
// Decorative Three.js layer for the HR leave-management page. It is mounted on
// that one page and nowhere else.
//
// Three.js is pulled in with a dynamic import() inside this component, so the
// library becomes its own chunk and is only fetched when the page decides the
// device can afford it. In lite mode (see src/lib/lite-mode.js) the import never
// runs and the component draws the same static gradient without a canvas, so a
// phone still shows the whole list and every button.
//
// The layer is aria-hidden: it carries no information. Text, buttons and leave
// rows stay ordinary HTML either way.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { isLiteMode } from '../lib/lite-mode.js'

// The page's own tokens, so the objects look like they belong to it.
const COLOR_CARD = 0xd9ece7
const COLOR_BACK = 0xeef7f4
const COLOR_ACCENT = 0x8fb8ae
const COLOR_RING = 0x10504e
const PIXEL_RATIO_CAP = 1.5
const SPIN_PER_FRAME = 0.0018

const host = ref(null)
const canvasEl = ref(null)
// Decided synchronously so the canvas is never painted on a lite device, not
// even for one frame.
const lite = ref(isLiteMode())

// Everything created below is pushed here so unmount disposes it in one place.
const disposables = []
let renderer = null
let scene = null
let camera = null
let group = null
let cards = []
let frameId = 0
let running = false
let inView = true
let elapsed = 0
let resizeObserver = null
let intersectionObserver = null
let disposed = false

function stopLoop() {
  if (frameId) cancelAnimationFrame(frameId)
  frameId = 0
  running = false
}

function shouldRun() {
  return !disposed && renderer !== null && inView && document.visibilityState !== 'hidden'
}

function startLoop() {
  if (running || !shouldRun()) return
  running = true
  const tick = () => {
    if (!shouldRun()) {
      running = false
      frameId = 0
      return
    }
    frameId = requestAnimationFrame(tick)
    elapsed += 1
    if (group) group.rotation.y += SPIN_PER_FRAME
    for (const card of cards) {
      card.mesh.position.y = card.baseY + Math.sin(elapsed * 0.012 + card.phase) * 0.06
    }
    renderer.render(scene, camera)
  }
  frameId = requestAnimationFrame(tick)
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') stopLoop()
  else startLoop()
}

function resize() {
  if (!renderer || !camera || !host.value) return
  const width = host.value.clientWidth || 1
  const height = host.value.clientHeight || 1
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  // A hidden or collapsed panel costs nothing.
  if (width <= 1 || height <= 1) stopLoop()
  else startLoop()
}

function dispose({ removeCanvas = true } = {}) {
  disposed = true
  stopLoop()
  window.removeEventListener('resize', resize)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (resizeObserver) resizeObserver.disconnect()
  resizeObserver = null
  if (intersectionObserver) intersectionObserver.disconnect()
  intersectionObserver = null

  for (const item of disposables) {
    if (item && typeof item.dispose === 'function') item.dispose()
  }
  disposables.length = 0
  cards = []

  if (renderer) {
    renderer.dispose()
    if (typeof renderer.forceContextLoss === 'function') renderer.forceContextLoss()
  }

  // The canvas is ours, not Vue's, once WebGL took it over: take it out here so
  // a re-mount starts from an empty host. When we are falling back to lite mode
  // the v-if still owns the node, so Vue removes it instead.
  const canvas = canvasEl.value
  if (removeCanvas && canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)

  renderer = null
  scene = null
  camera = null
  group = null
}

async function buildScene() {
  // Dynamic import: a separate chunk, fetched only when the 3D layer is wanted.
  const THREE = await import('three')
  if (disposed || lite.value) return null

  const canvas = canvasEl.value
  if (!canvas) return null

  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP))

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
  camera.position.set(0, 0.5, 6.4)
  camera.lookAt(0, 0, 0)

  group = new THREE.Group()
  scene.add(group)

  const ambient = new THREE.AmbientLight(COLOR_BACK, 1.15)
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2)
  keyLight.position.set(2.4, 3.2, 4)
  const rimLight = new THREE.DirectionalLight(COLOR_ACCENT, 0.65)
  rimLight.position.set(-3, -1.4, -2)
  scene.add(ambient, keyLight, rimLight)

  // Three soft cards, the same rounded rectangles the list is made of.
  const cardGeometry = new THREE.BoxGeometry(1.5, 0.94, 0.1)
  disposables.push(cardGeometry)
  const cardSpecs = [
    { x: -1.55, y: 0.3, z: 0.2, tilt: 0.08, color: COLOR_CARD, phase: 0 },
    { x: 0.05, y: -0.4, z: -0.35, tilt: -0.05, color: COLOR_BACK, phase: 2.1 },
    { x: 1.6, y: 0.42, z: 0.05, tilt: 0.12, color: COLOR_ACCENT, phase: 4.2 },
  ]
  for (const spec of cardSpecs) {
    const material = new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: 0.62,
      metalness: 0.08,
      transparent: true,
      opacity: 0.92,
    })
    disposables.push(material)
    const mesh = new THREE.Mesh(cardGeometry, material)
    mesh.position.set(spec.x, spec.y, spec.z)
    mesh.rotation.z = spec.tilt
    group.add(mesh)
    cards.push({ mesh, baseY: spec.y, phase: spec.phase })
  }

  // One slow ring behind them, in the page's deep teal.
  const ringGeometry = new THREE.TorusGeometry(2.1, 0.026, 12, 88)
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: COLOR_RING,
    roughness: 0.42,
    metalness: 0.22,
    transparent: true,
    opacity: 0.3,
  })
  disposables.push(ringGeometry, ringMaterial)
  const ring = new THREE.Mesh(ringGeometry, ringMaterial)
  ring.rotation.x = 1.18
  ring.position.z = -0.9
  group.add(ring)

  return THREE
}

onMounted(async () => {
  if (lite.value) return

  try {
    await buildScene()
  } catch {
    // No WebGL context, a lost driver or a failed chunk: fall back silently to
    // the static gradient, exactly like a lite device.
    dispose({ removeCanvas: false })
    lite.value = true
    return
  }

  // Unmounted (or flipped to lite) while Three.js was loading.
  if (disposed || lite.value || !renderer) return

  window.addEventListener('resize', resize)
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
      { threshold: 0.05 }
    )
    intersectionObserver.observe(host.value)
  }

  resize()
})

onBeforeUnmount(dispose)
</script>

<template>
  <div ref="host" class="scene-3d" :class="{ 'scene-is-lite': lite }" aria-hidden="true">
    <canvas v-if="!lite" ref="canvasEl" class="scene-canvas" aria-hidden="true"></canvas>
    <span class="scene-glow"></span>
  </div>
</template>

<style scoped>
.scene-3d {
  position: relative;
  display: block;
  width: 100%;
  height: clamp(120px, 15vw, 168px);
  overflow: hidden;
  border: 1px solid #e0e8e6;
  border-radius: 16px;
  /* Lite mode keeps exactly this: one still gradient, no canvas. */
  background:
    radial-gradient(120% 140% at 18% 10%, #f1f9f6 0%, rgba(241, 249, 246, 0) 62%),
    linear-gradient(135deg, #f4faf8 0%, #e4f1ee 48%, #dcece8 100%);
}

.scene-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.scene-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(80% 90% at 84% 88%, rgba(16, 80, 78, 0.1), transparent 70%);
}
</style>
