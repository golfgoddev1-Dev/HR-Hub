<script setup>
// The scene graph itself, declared as TresJS components.
//
// Declarative: the ribbons, the crystal knot and its shell, the rings, the gems,
// the halos and the dust are <TresMesh>, <TresInstancedMesh>, <TresSprite> and
// <TresPoints> elements whose geometry, material and counts come from the plan
// for this tier. There is no renderer, no camera setup, no scene construction and
// no manual render() call here - TresJS does all of that. What is left is the
// per-frame animation, which writes geometry attributes and instance matrices
// from the pure layout functions in src/lib/background-scene.js.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  EdgesGeometry,
  IcosahedronGeometry,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointsMaterial,
  SphereGeometry,
  SpriteMaterial,
  TorusGeometry,
  TorusKnotGeometry,
} from 'three'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useLoop } from '@tresjs/core'
import {
  BEAD_RADIUS,
  CAMERA,
  KNOT,
  MAX_PARALLAX,
  RIBBON_SIZE,
  cameraDrift,
  driftDust,
  easeFrame,
  heroFit,
  layoutGems,
  layoutKnot,
  layoutRings,
  layoutShell,
  lightPositions,
  moodFrame,
  scenePlan,
  waveRibbon,
} from '../../lib/background-scene.js'

const props = defineProps({
  config: { type: Object, required: true },
  // 'hero' or 'quiet', from sceneMood(route.path) in the shell.
  mood: { type: String, default: 'quiet' },
})

const plan = scenePlan(props.config)
const lit = props.config.material !== 'basic'

// standard at high, Lambert at medium, Basic at low: the tier decides how much
// light maths each surface may cost. `glow` is a faint self-colour that keeps the
// surfaces luminous against the pale gradient (Basic has no lighting to add it to).
function surface(options, standard = {}, glow = null) {
  if (props.config.material === 'standard') {
    return new MeshStandardMaterial({ ...options, ...standard, ...(glow ?? {}) })
  }
  if (props.config.material === 'lambert') {
    return new MeshLambertMaterial({ ...options, ...(glow ?? {}) })
  }
  return new MeshBasicMaterial(options)
}

// ---- Ribbons ----------------------------------------------------------------
// Each ribbon is a plane whose z, colour and top-edge line are rewritten every
// frame from waveRibbon(). Colours need their own attribute.
const ribbonGeometries = []
const crestGeometries = []
const ribbonMaterials = plan.ribbons.map((ribbon) => {
  const geometry = new PlaneGeometry(RIBBON_SIZE.width, RIBBON_SIZE.height, ribbon.cols, ribbon.rows)
  const count = geometry.attributes.position.count
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3), 3))
  geometry.attributes.position.setUsage(DynamicDrawUsage)
  geometry.attributes.color.setUsage(DynamicDrawUsage)
  ribbonGeometries.push(geometry)

  const crest = new BufferGeometry()
  const crestPositions = new BufferAttribute(new Float32Array((ribbon.cols + 1) * 3), 3)
  crestPositions.setUsage(DynamicDrawUsage)
  crest.setAttribute('position', crestPositions)
  crestGeometries.push(crest)

  return surface(
    {
      vertexColors: true,
      transparent: true,
      opacity: ribbon.opacity,
      side: DoubleSide,
      depthWrite: false,
    },
    { roughness: 0.3, metalness: 0.1 },
    { emissive: 0x6366f1, emissiveIntensity: 0.28 }
  )
})
const crestMaterials = plan.ribbons.map(
  (ribbon) =>
    new LineBasicMaterial({
      color: ribbon.crest,
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
    })
)

// ---- Knot, shell, rings, beads, gems ------------------------------------------
const knotGeometry = plan.knot
  ? new TorusKnotGeometry(KNOT.radius, KNOT.tube, plan.knot.segments, plan.knot.radial, KNOT.p, KNOT.q)
  : null
const knotMaterial = plan.knot
  ? surface(
      { color: 0x6366f1, transparent: true, opacity: 0.9 },
      { roughness: 0.1, metalness: 0.6 },
      { emissive: 0x4f46e5, emissiveIntensity: 0.32 }
    )
  : null

const shellGeometry = plan.shell ? new EdgesGeometry(new IcosahedronGeometry(plan.shell.radius, 1)) : null
const shellMaterial = plan.shell
  ? new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: AdditiveBlending })
  : null

const ringGeometries = plan.rings.map((ring) => new TorusGeometry(ring.radius, 0.04, 10, 160))
const ringMaterials = plan.rings.map(
  (ring) => new MeshBasicMaterial({ color: ring.tint, transparent: true, opacity: 0.75 })
)
const beadGeometry = plan.beadCount > 0 ? new SphereGeometry(BEAD_RADIUS, 12, 8) : null
const beadMaterial = plan.beadCount > 0 ? new MeshBasicMaterial({ color: 0xffffff }) : null

// A plain 20-face gem: flat shading turns each face to the light on its own.
const gemGeometry = plan.gems.length > 0 ? new IcosahedronGeometry(1, 0) : null
const gemMaterial =
  plan.gems.length > 0
    ? surface(
        { color: 0xffffff, flatShading: true },
        { roughness: 0.18, metalness: 0.35 },
        { emissive: 0x6366f1, emissiveIntensity: 0.28 }
      )
    : null

// ---- Halos and dust ----------------------------------------------------------
// One soft radial gradient per halo, drawn once on a tiny canvas. Disposed with
// the scene below, because a texture is not part of the scene graph's geometry.
const glowTextures = []
function glowTexture(color) {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext?.('2d')
  if (!context) return null
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)')
  gradient.addColorStop(0.35, color)
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  const texture = new CanvasTexture(canvas)
  glowTextures.push(texture)
  return texture
}
const haloMaterials = plan.halos.map(
  (halo) =>
    new SpriteMaterial({
      map: glowTexture(halo.color),
      transparent: true,
      opacity: halo.opacity,
      depthWrite: false,
      blending: AdditiveBlending,
    })
)

const dustGeometry = new BufferGeometry()
if (plan.dust.count > 0) {
  dustGeometry.setAttribute('position', new BufferAttribute(plan.dust.positions, 3))
}
const dustMaterial = new PointsMaterial({
  color: 0xffffff,
  size: 0.09,
  transparent: true,
  opacity: 0.8,
  depthWrite: false,
  sizeAttenuation: true,
  blending: AdditiveBlending,
})

// ---- Refs and scratch state -----------------------------------------------------
const cameraRef = ref(null)
const ribbonRefs = ref([])
const knotRef = ref(null)
const shellRef = ref(null)
const ringRefs = ref([])
const beadRef = ref(null)
const gemRef = ref(null)
const haloRefs = ref([])
const lightRefs = ref([])
const pointsRef = ref(null)

const field = { width: 20, height: 12, fit: 1 }
// The framing the page asks for, and the live one easing towards it.
const target = { x: 0, scale: 1, speed: 1 }
const frameNow = { x: 0, scale: 1, speed: 1 }
const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 }
const knotPose = { rx: 0, ry: 0, rz: 0, z: 0 }
const shellPose = { rx: 0, ry: 0, rz: 0, z: 0 }
const ringSlots = []
const beadSlots = []
const gemSlots = []
const lightSlots = []
const tint = new Color()
const dummy = new Object3D()

let elapsed = 0
let frame = 0
let primed = false

function measure() {
  if (typeof window === 'undefined') return
  const width = Math.max(1, Math.round(window.innerWidth || 1))
  const height = Math.max(1, Math.round(window.innerHeight || 1))
  field.height = 2 * Math.tan((CAMERA.fov * Math.PI) / 360) * CAMERA.z
  field.width = field.height * (width / height)
  field.fit = heroFit(field)
  moodFrame(props.mood, field, target)
}

watch(
  () => props.mood,
  () => moodFrame(props.mood, field, target)
)

/** Colours every gem once, the first time its mesh exists. */
function prime() {
  if (plan.gems.length > 0) {
    const mesh = gemRef.value
    if (!mesh) return false
    if (!mesh.userData.tinted) {
      for (let index = 0; index < plan.gems.length; index += 1) {
        mesh.setColorAt(index, tint.setHex(plan.gems[index].tint))
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      mesh.userData.tinted = true
    }
  }
  if (beadRef.value) beadRef.value.instanceMatrix.setUsage(DynamicDrawUsage)
  return true
}

/** Copies one layout slot into an instance matrix. */
function write(mesh, index, slot) {
  dummy.position.set(slot.x, slot.y, slot.z)
  dummy.rotation.set(slot.rx, slot.ry, slot.rz)
  dummy.scale.setScalar(slot.scale)
  dummy.updateMatrix()
  mesh.setMatrixAt(index, dummy.matrix)
}

const { onBeforeRender } = useLoop()

onMounted(() => {
  measure()
  // The first page is framed at once; only a route change eases.
  Object.assign(frameNow, target)
  window.addEventListener('resize', measure)
  window.addEventListener('orientationchange', measure)
  if (props.config.mouseParallax && typeof window !== 'undefined') {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerleave', onPointerLeave)
  }
})

function onPointerMove(event) {
  const width = window.innerWidth || 1
  const height = window.innerHeight || 1
  pointer.targetX = ((event.clientX ?? 0) / width) * 2 - 1
  pointer.targetY = ((event.clientY ?? 0) / height) * 2 - 1
}

function onPointerLeave() {
  pointer.targetX = 0
  pointer.targetY = 0
}

const stopLoop = onBeforeRender((context) => {
  // TresJS reports delta in seconds; guard a millisecond clock just in case.
  const raw = Number(context?.delta) || 0
  const step = raw > 0.5 ? raw / 1000 : raw
  const tick = step > 0 && step < 1 ? step : 1 / 60
  easeFrame(frameNow, target, tick)
  elapsed += tick * frameNow.speed

  if (!primed) primed = prime()
  if (!primed) return

  const ease = Math.min(1, (step > 0 && step < 1 ? step : 0.016) * 2.5)
  pointer.x += (pointer.targetX - pointer.x) * ease
  pointer.y += (pointer.targetY - pointer.y) * ease

  frame += 1
  // Positions move every frame; the gradient, the crest line and the normals are
  // slower-moving and cost the most, so they refresh every other frame.
  const paint = frame % 2 === 0
  const fit = field.fit * frameNow.scale
  const state = { time: elapsed, elapsed, field, pointer, fit }

  if (cameraRef.value) {
    cameraDrift(
      {
        elapsed,
        pointer,
        strength: props.config.mouseParallax ? MAX_PARALLAX : MAX_PARALLAX * 0.35,
        offsetX: frameNow.x,
      },
      cameraRef.value
    )
  }

  for (let index = 0; index < plan.ribbons.length; index += 1) {
    const geometry = ribbonGeometries[index]
    const crest = crestGeometries[index]
    waveRibbon(
      plan.ribbons[index],
      elapsed,
      geometry.attributes.position.array,
      geometry.attributes.color.array,
      crest.attributes.position.array,
      paint
    )
    geometry.attributes.position.needsUpdate = true
    if (paint) {
      geometry.attributes.color.needsUpdate = true
      crest.attributes.position.needsUpdate = true
      if (lit) geometry.computeVertexNormals()
    }
  }

  if (knotRef.value) {
    layoutKnot(state, knotPose)
    knotRef.value.rotation.set(knotPose.rx, knotPose.ry, knotPose.rz)
    knotRef.value.scale.setScalar(fit)
  }

  if (shellRef.value) {
    layoutShell(state, shellPose)
    shellRef.value.rotation.set(shellPose.rx, shellPose.ry, shellPose.rz)
    shellRef.value.scale.setScalar(fit)
  }

  if (plan.rings.length > 0) {
    layoutRings(plan, state, ringSlots, beadSlots)
    for (let index = 0; index < plan.rings.length; index += 1) {
      const mesh = ringRefs.value[index]
      if (mesh) {
        mesh.rotation.set(ringSlots[index].rx, ringSlots[index].ry, ringSlots[index].rz)
        mesh.scale.setScalar(fit)
      }
    }
    if (beadRef.value) {
      for (let index = 0; index < plan.beadCount; index += 1) write(beadRef.value, index, beadSlots[index])
      beadRef.value.instanceMatrix.needsUpdate = true
    }
  }

  if (gemRef.value) {
    const { count } = layoutGems(plan, state, gemSlots)
    for (let index = 0; index < count; index += 1) write(gemRef.value, index, gemSlots[index])
    gemRef.value.instanceMatrix.needsUpdate = true
  }

  if (lightRefs.value.length > 0) {
    lightPositions(state, field, lightSlots)
    for (let index = 0; index < lightRefs.value.length; index += 1) {
      const light = lightRefs.value[index]
      if (light) light.position.set(lightSlots[index].x, lightSlots[index].y, lightSlots[index].z)
    }
  }

  // The core halo breathes; the dust twinkles.
  const core = haloMaterials[2]
  if (core) core.opacity = 0.65 + Math.sin(elapsed * 1.2) * 0.15

  if (pointsRef.value && plan.dust.count > 0) {
    driftDust(plan, state)
    const attribute = dustGeometry.getAttribute('position')
    if (attribute) attribute.needsUpdate = true
    dustMaterial.opacity = 0.65 + Math.sin(elapsed * 1.5) * 0.2
  }
})

onBeforeUnmount(() => {
  if (typeof stopLoop === 'object' && typeof stopLoop.off === 'function') stopLoop.off()
  for (const texture of glowTextures) texture.dispose()
  window.removeEventListener('resize', measure)
  window.removeEventListener('orientationchange', measure)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerleave', onPointerLeave)
})
</script>

<template>
  <TresPerspectiveCamera ref="cameraRef" :position="[0, 0, CAMERA.z]" :fov="CAMERA.fov" :near="CAMERA.near" :far="CAMERA.far" />

  <!-- Ambient plus key stay below 1.0 combined: brighter light clips the colours
       to white and the surfaces read as grey slabs instead of indigo ones. -->
  <TresAmbientLight :intensity="0.75" />
  <TresDirectionalLight :position="[4, 7, 9]" :intensity="0.7" />
  <!-- Three coloured lights wander across the field, high tier only. -->
  <template v-if="config.material === 'standard'">
    <TresPointLight
      v-for="(color, lightIndex) in ['#c4b5fd', '#67e8f9', '#f9a8d4']"
      :key="`light-${lightIndex}`"
      :ref="(instance) => { if (instance) lightRefs[lightIndex] = instance }"
      :color="color"
      :intensity="[1.1, 0.9, 0.7][lightIndex]"
      :decay="0"
      :position="[0, 0, 3]"
    />
  </template>

  <TresSprite
    v-for="(halo, haloIndex) in plan.halos"
    :key="`halo-${haloIndex}`"
    :args="[haloMaterials[haloIndex]]"
    :position="[halo.x, halo.y, halo.z]"
    :scale="[halo.size, halo.size, 1]"
  />

  <TresMesh
    v-for="(ribbon, ribbonIndex) in plan.ribbons"
    :key="`ribbon-${ribbonIndex}`"
    :ref="(instance) => { if (instance) ribbonRefs[ribbonIndex] = instance }"
    :args="[ribbonGeometries[ribbonIndex], ribbonMaterials[ribbonIndex]]"
    :position="[0, ribbon.y, ribbon.z]"
    :rotation="[-0.35, 0, 0]"
    :frustum-culled="false"
  >
    <TresLine :args="[crestGeometries[ribbonIndex], crestMaterials[ribbonIndex]]" :frustum-culled="false" />
  </TresMesh>

  <TresMesh
    v-if="plan.knot"
    ref="knotRef"
    :args="[knotGeometry, knotMaterial]"
    :position="[0, 0, KNOT.z]"
    :frustum-culled="false"
  />

  <TresLineSegments
    v-if="plan.shell"
    ref="shellRef"
    :args="[shellGeometry, shellMaterial]"
    :position="[0, 0, KNOT.z]"
    :frustum-culled="false"
  />

  <TresMesh
    v-for="(ring, ringIndex) in plan.rings"
    :key="`ring-${ringIndex}`"
    :ref="(instance) => { if (instance) ringRefs[ringIndex] = instance }"
    :args="[ringGeometries[ringIndex], ringMaterials[ringIndex]]"
    :position="[0, 0, KNOT.z]"
    :frustum-culled="false"
  />

  <TresInstancedMesh
    v-if="plan.beadCount > 0"
    ref="beadRef"
    :args="[beadGeometry, beadMaterial, plan.beadCount]"
    :frustum-culled="false"
  />

  <TresInstancedMesh
    v-if="plan.gems.length > 0"
    ref="gemRef"
    :args="[gemGeometry, gemMaterial, plan.gems.length]"
    :frustum-culled="false"
  />

  <TresPoints
    v-if="plan.dust.count > 0"
    ref="pointsRef"
    :args="[dustGeometry, dustMaterial]"
    :frustum-culled="false"
  />
</template>
