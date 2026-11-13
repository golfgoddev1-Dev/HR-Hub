<script setup>
// Decorative Three.js layer for the HR leave-management page. It is mounted on
// that one page and nowhere else.
//
// Three.js is pulled in with a dynamic import() inside this component, so the
// library becomes its own chunk and is only fetched when the page decides the
// device can afford it. In lite mode (see src/lib/lite-mode.js) the import never
// runs and the component draws the same indigo-to-violet gradient without a
// canvas, so a phone still shows the whole list and every button.
//
// The layer is aria-hidden: it carries no information. Text, buttons and leave
// rows stay ordinary HTML either way.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { isLiteMode } from '../lib/lite-mode.js'

// The page's palette, so the objects belong to it. Status colours stay semantic.
const COLOR_APPROVED = 0x34d399
const COLOR_PENDING = 0xfbbf24
const COLOR_REJECTED = 0xf87171
const COLOR_CALENDAR = 0x4f46e5
const COLOR_CALENDAR_HEAD = 0x8b5cf6
const COLOR_DOT = 0xffffff
const COLOR_RING = 0x8b5cf6
const COLOR_FILL = 0x8b5cf6

const PIXEL_RATIO_CAP = 1.5
const CARD_COUNT = 8
const ORBIT_RX = 3.15
const ORBIT_RY = 1.1
const ORBIT_SPEED = 0.0009
const CAMERA_FOV = 40
const CAMERA_Z = 7.4
const STATUS_CYCLE = ['approved', 'pending', 'rejected', 'approved', 'pending', 'rejected', 'approved', 'pending']

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
let calendar = null
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

    // Slow orbit: the ring of cards turns, each one drifts and leans a little.
    if (group) group.rotation.y += ORBIT_SPEED
    for (const card of cards) {
      const wobble = Math.sin(elapsed * 0.009 + card.phase)
      card.mesh.position.y = card.baseY + wobble * 0.045
      card.mesh.position.z = card.baseZ + Math.cos(elapsed * 0.007 + card.phase) * 0.07
      card.mesh.rotation.z = card.tilt + wobble * 0.025
    }
    if (calendar) calendar.rotation.y = Math.sin(elapsed * 0.004) * 0.08

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
  const width = Math.max(1, Math.round(host.value.clientWidth || 1))
  const height = Math.max(1, Math.round(host.value.clientHeight || 1))
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()

  // A wide, short band needs a slightly larger cluster, a phone-width band a
  // smaller one, so the ring never clips on either.
  if (group) {
    const fit = Math.min(1.25, Math.max(0.78, camera.aspect / 3.6))
    group.scale.setScalar(fit)
  }

  // A hidden or collapsed panel costs nothing.
  if (width <= 1 || height <= 1) stopLoop()
  else startLoop()
}

function dispose({ removeCanvas = true } = {}) {
  disposed = true
  stopLoop()
  window.removeEventListener('resize', resize)
  window.removeEventListener('orientationchange', resize)
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
  calendar = null
}

/** A rounded rectangle with a small bevel, so the cards read as soft cards. */
function roundedRectGeometry(THREE, width, height, depth, radius) {
  const halfW = width / 2
  const halfH = height / 2
  const r = Math.min(radius, halfW, halfH)
  const shape = new THREE.Shape()
  shape.moveTo(-halfW + r, -halfH)
  shape.lineTo(halfW - r, -halfH)
  shape.quadraticCurveTo(halfW, -halfH, halfW, -halfH + r)
  shape.lineTo(halfW, halfH - r)
  shape.quadraticCurveTo(halfW, halfH, halfW - r, halfH)
  shape.lineTo(-halfW + r, halfH)
  shape.quadraticCurveTo(-halfW, halfH, -halfW, halfH - r)
  shape.lineTo(-halfW, -halfH + r)
  shape.quadraticCurveTo(-halfW, -halfH, -halfW + r, -halfH)
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.015,
    bevelThickness: 0.015,
    bevelSegments: 2,
    curveSegments: 8,
    steps: 1,
  })
}

function buildCalendar(THREE) {
  const tile = new THREE.Group()

  const bodyGeometry = roundedRectGeometry(THREE, 1.6, 1.5, 0.16, 0.2)
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: COLOR_CALENDAR,
    roughness: 0.48,
    metalness: 0.08,
  })
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
  body.position.z = -0.08
  disposables.push(bodyGeometry, bodyMaterial)
  tile.add(body)

  const headGeometry = roundedRectGeometry(THREE, 1.6, 0.38, 0.17, 0.16)
  const headMaterial = new THREE.MeshStandardMaterial({
    color: COLOR_CALENDAR_HEAD,
    roughness: 0.42,
    metalness: 0.08,
  })
  const head = new THREE.Mesh(headGeometry, headMaterial)
  head.position.set(0, 0.56, -0.075)
  disposables.push(headGeometry, headMaterial)
  tile.add(head)

  // Six day cells, the calendar's only detail: quiet, no text, no icons.
  const dotGeometry = new THREE.BoxGeometry(0.19, 0.13, 0.03)
  const dotMaterial = new THREE.MeshStandardMaterial({
    color: COLOR_DOT,
    roughness: 0.7,
    metalness: 0,
  })
  disposables.push(dotGeometry, dotMaterial)
  const rows = [0.14, -0.16, -0.46]
  for (const y of rows) {
    for (const x of [-0.46, 0, 0.46]) {
      const dot = new THREE.Mesh(dotGeometry, dotMaterial)
      // In front of the tile body (its front face sits at z = 0.08), so the day
      // cells read as a calendar instead of hiding inside the slab.
      dot.position.set(x, y, 0.11)
      tile.add(dot)
    }
  }

  // A soft contact shadow so the tile sits on the background, not in front of it.
  const shadowGeometry = new THREE.CircleGeometry(1.15, 40)
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x1e1b4b,
    transparent: true,
    opacity: 0.08,
  })
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial)
  shadow.scale.set(1.25, 0.85, 1)
  shadow.position.set(0, -0.16, -0.32)
  disposables.push(shadowGeometry, shadowMaterial)
  tile.add(shadow)

  return tile
}

async function buildScene() {
  // Dynamic import: a separate chunk, fetched only when the 3D layer is wanted.
  const THREE = await import('three')
  if (disposed || lite.value) return

  const canvas = canvasEl.value
  if (!canvas) return

  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP))

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100)
  camera.position.set(0, 0.12, CAMERA_Z)
  camera.lookAt(0, 0, 0)

  group = new THREE.Group()
  group.rotation.x = -0.05
  scene.add(group)

  const ambient = new THREE.AmbientLight(0xffffff, 0.92)
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.05)
  keyLight.position.set(2.6, 3.4, 5)
  const fillLight = new THREE.DirectionalLight(COLOR_FILL, 0.32)
  fillLight.position.set(-3.2, -1.2, 2.4)
  scene.add(ambient, keyLight, fillLight)

  // The faint path the cards travel on.
  const ringGeometry = new THREE.TorusGeometry(1, 0.004, 8, 120)
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: COLOR_RING,
    transparent: true,
    opacity: 0.26,
  })
  const ring = new THREE.Mesh(ringGeometry, ringMaterial)
  ring.scale.set(ORBIT_RX, ORBIT_RY, 1)
  ring.position.z = -0.5
  disposables.push(ringGeometry, ringMaterial)
  group.add(ring)

  calendar = buildCalendar(THREE)
  calendar.position.z = 0.1
  group.add(calendar)

  // Eight small leave cards in three status colours, one shared geometry.
  const cardGeometry = roundedRectGeometry(THREE, 0.7, 0.48, 0.07, 0.11)
  disposables.push(cardGeometry)
  const statusColors = {
    approved: COLOR_APPROVED,
    pending: COLOR_PENDING,
    rejected: COLOR_REJECTED,
  }
  const statusMaterials = {}
  for (const [name, color] of Object.entries(statusColors)) {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.52,
      metalness: 0.04,
    })
    statusMaterials[name] = material
    disposables.push(material)
  }

  for (let index = 0; index < CARD_COUNT; index += 1) {
    const status = STATUS_CYCLE[index % STATUS_CYCLE.length]
    const angle = (index / CARD_COUNT) * Math.PI * 2
    const x = Math.cos(angle) * ORBIT_RX
    const y = Math.sin(angle) * ORBIT_RY
    const z = Math.sin(angle) * 0.5

    const mesh = new THREE.Mesh(cardGeometry, statusMaterials[status])
    mesh.position.set(x, y, z)
    mesh.rotation.z = Math.cos(angle) * 0.12
    mesh.rotation.y = -x * 0.1
    group.add(mesh)
    cards.push({
      mesh,
      baseY: y,
      baseZ: z,
      tilt: mesh.rotation.z,
      phase: index * 0.8,
    })
  }

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
  window.addEventListener('orientationchange', resize)
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
/* Decorative band. Lite mode shows exactly this gradient, with no canvas, so it
   can never be an empty or black box. */
.scene-3d {
  position: relative;
  display: block;
  width: 100%;
  height: 132px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  background:
    radial-gradient(120% 160% at 8% 0%, rgba(139, 92, 246, 0.2) 0%, rgba(139, 92, 246, 0) 58%),
    radial-gradient(110% 150% at 100% 110%, rgba(79, 70, 229, 0.16) 0%, rgba(79, 70, 229, 0) 60%),
    linear-gradient(135deg, #eef2ff 0%, #e4e9ff 46%, #ede9fe 100%);
  box-shadow:
    0 1px 2px rgba(30, 27, 75, 0.05),
    0 12px 28px rgba(30, 27, 75, 0.06);
}

@media (min-width: 600px) {
  .scene-3d {
    height: 168px;
  }
}

@media (min-width: 960px) {
  .scene-3d {
    height: 216px;
  }
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
  background: radial-gradient(70% 90% at 84% 90%, rgba(139, 92, 246, 0.12), transparent 72%);
}
</style>
