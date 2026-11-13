<script setup>
// The scene graph itself, declared as TresJS components.
//
// Declarative: the depth planes, spheres, calendar grid, glints and dust are
// <TresInstancedMesh> / <TresPoints> elements with their geometry, material and
// instance count taken from the plan for this tier. There is no renderer, no
// camera setup, no scene construction and no manual render() call here - TresJS
// does all of that. What is left is the per-frame animation, which writes instance
// matrices from the pure layout functions in src/lib/background-scene.js.
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, Object3D, PointsMaterial, Shape, ShapeGeometry, SphereGeometry } from 'three'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useLoop } from '@tresjs/core'
import {
  CAMERA,
  CARD_SIZE,
  CALENDAR_CELL_SIZE,
  GLINT_SIZE,
  MAX_PARALLAX,
  cameraDrift,
  driftDust,
  layoutCalendar,
  layoutCards,
  layoutGlints,
  layoutSpheres,
  scenePlan,
} from '../../lib/background-scene.js'

const props = defineProps({
  config: { type: Object, required: true },
})

const plan = scenePlan(props.config)

// A rounded rectangle, flat: one cheap shape for every card instance.
function roundedGeometry({ width, height, radius }) {
  const halfWidth = width / 2
  const halfHeight = height / 2
  const r = Math.min(radius, halfWidth, halfHeight)
  const shape = new Shape()
  shape.moveTo(-halfWidth + r, -halfHeight)
  shape.lineTo(halfWidth - r, -halfHeight)
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + r)
  shape.lineTo(halfWidth, halfHeight - r)
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - r, halfHeight)
  shape.lineTo(-halfWidth + r, halfHeight)
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - r)
  shape.lineTo(-halfWidth, -halfHeight + r)
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + r, -halfHeight)
  return new ShapeGeometry(shape, 8)
}

// MeshStandardMaterial at high, Lambert at medium, Basic at low: the tier decides
// how much light maths each card may cost.
function makeMaterial(config, opacity) {
  const options = {
    color: 0xffffff,
    transparent: true,
    opacity,
    depthWrite: false,
    side: DoubleSide,
  }
  if (config.material === 'standard') {
    return new MeshStandardMaterial({ ...options, roughness: 0.45, metalness: 0.05 })
  }
  if (config.material === 'lambert') return new MeshLambertMaterial(options)
  return new MeshBasicMaterial(options)
}

const cardGeometry = roundedGeometry(CARD_SIZE)
const planeMaterials = plan.planes.map((plane) => makeMaterial(props.config, plane.opacity))
const sphereGeometry = new SphereGeometry(
  1,
  Math.max(6, props.config.sphereSegments),
  Math.max(5, Math.round(props.config.sphereSegments * 0.65))
)
const sphereMaterial = makeMaterial(props.config, 0.7)
const calendarGeometry = roundedGeometry(CALENDAR_CELL_SIZE)
const calendarMaterial = plan.calendar.cells.length > 0 ? makeMaterial(props.config, 0.42) : null
const glintGeometry = roundedGeometry(GLINT_SIZE)
const glintMaterial =
  plan.glints.length > 0
    ? new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.32,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      })
    : null

const dustGeometry = new BufferGeometry()
if (plan.dust.count > 0) {
  dustGeometry.setAttribute('position', new BufferAttribute(plan.dust.positions, 3))
}
const dustMaterial = new PointsMaterial({
  color: 0xffffff,
  size: 0.055,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  sizeAttenuation: true,
})

const cameraRef = ref(null)
const planeRefs = ref([])
const sphereRef = ref(null)
const calendarRef = ref(null)
const glintRef = ref(null)
const pointsRef = ref(null)

const field = { width: 20, height: 12 }
const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 }
const cardSlots = []
const sphereSlots = []
const calendarSlots = []
const glintSlots = []
const tint = new Color()

let elapsed = 0
let primed = false

function measure() {
  if (typeof window === 'undefined') return
  const width = Math.max(1, Math.round(window.innerWidth || 1))
  const height = Math.max(1, Math.round(window.innerHeight || 1))
  field.height = 2 * Math.tan((CAMERA.fov * Math.PI) / 360) * CAMERA.z
  field.width = field.height * (width / height)
}

/**
 * Tints every instance once, per mesh. Each mesh is tinted the first time it is
 * seen, so a mesh that TresJS mounts a frame later still gets its colours; a mesh
 * with no colours would render white, which is not a card in this palette.
 */
function tintMesh(mesh, items) {
  if (!mesh || mesh.userData.tinted) return
  for (let index = 0; index < items.length; index += 1) {
    mesh.setColorAt(index, tint.setHex(items[index].tint))
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.userData.tinted = true
}

/** True once every mesh this tier draws exists and carries its tint. */
function prime() {
  let ready = plan.planes.length > 0
  for (let planeIndex = 0; planeIndex < plan.planes.length; planeIndex += 1) {
    const mesh = planeRefs.value[planeIndex]
    if (!mesh) ready = false
    tintMesh(mesh, plan.planes[planeIndex].cards)
  }

  if (plan.spheres.length > 0) {
    if (!sphereRef.value) ready = false
    tintMesh(sphereRef.value, plan.spheres)
  }

  if (plan.calendar.cells.length > 0) {
    if (!calendarRef.value) ready = false
    tintMesh(calendarRef.value, plan.calendar.cells)
  }

  if (glintRef.value) glintRef.value.instanceMatrix.setUsage(DynamicDrawUsage)
  return ready
}

/** Copies one layout slot into an instance matrix. */
function write(mesh, index, slot, dummy) {
  dummy.position.set(slot.x, slot.y, slot.z)
  dummy.rotation.set(slot.rx, slot.ry, slot.rz)
  dummy.scale.setScalar(slot.scale)
  dummy.updateMatrix()
  mesh.setMatrixAt(index, dummy.matrix)
}

const { onBeforeRender } = useLoop()

// One scratch object, reused every frame, so the loop allocates nothing.
const dummy = new Object3D()

onMounted(() => {
  measure()
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
  elapsed += step > 0 && step < 1 ? step : 1 / 60

  if (!primed) primed = prime()
  if (!primed) return

  const ease = Math.min(1, (step > 0 && step < 1 ? step : 0.016) * 2.5)
  pointer.x += (pointer.targetX - pointer.x) * ease
  pointer.y += (pointer.targetY - pointer.y) * ease

  const state = { time: elapsed, elapsed, field, pointer }

  if (cameraRef.value) {
    cameraDrift(
      { elapsed, pointer, strength: props.config.mouseParallax ? MAX_PARALLAX : MAX_PARALLAX * 0.35 },
      cameraRef.value
    )
  }

  for (let index = 0; index < plan.planes.length; index += 1) {
    const mesh = planeRefs.value[index]
    if (!mesh) continue
    const { count } = layoutCards({ planes: [plan.planes[index]] }, state, cardSlots)
    for (let card = 0; card < count; card += 1) write(mesh, card, cardSlots[card], dummy)
    mesh.instanceMatrix.needsUpdate = true
    // The near planes lean with the pointer at the top tier only.
    if (props.config.cardTilt === true) mesh.rotation.y = pointer.x * 0.04
  }

  if (sphereRef.value) {
    const { count } = layoutSpheres(plan, state, sphereSlots)
    for (let index = 0; index < count; index += 1) write(sphereRef.value, index, sphereSlots[index], dummy)
    sphereRef.value.instanceMatrix.needsUpdate = true
  }

  if (calendarRef.value) {
    const { count } = layoutCalendar(plan, state, calendarSlots)
    for (let index = 0; index < count; index += 1) write(calendarRef.value, index, calendarSlots[index], dummy)
    calendarRef.value.instanceMatrix.needsUpdate = true
  }

  if (glintRef.value) {
    const { count } = layoutGlints(plan, state, glintSlots)
    for (let index = 0; index < count; index += 1) write(glintRef.value, index, glintSlots[index], dummy)
    glintRef.value.instanceMatrix.needsUpdate = true
  }

  if (pointsRef.value && plan.dust.count > 0) {
    driftDust(plan, state)
    const attribute = dustGeometry.getAttribute('position')
    if (attribute) attribute.needsUpdate = true
  }
})

onBeforeUnmount(() => {
  if (typeof stopLoop === 'object' && typeof stopLoop.off === 'function') stopLoop.off()
  window.removeEventListener('resize', measure)
  window.removeEventListener('orientationchange', measure)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerleave', onPointerLeave)
})
</script>

<template>
  <TresPerspectiveCamera ref="cameraRef" :position="[0, 0, CAMERA.z]" :fov="CAMERA.fov" :near="CAMERA.near" :far="CAMERA.far" />

  <!-- Ambient plus key stay below 1.0 combined: brighter light clips the instance
       colours to white and the cards read as grey slabs instead of indigo ones. -->
  <TresAmbientLight :intensity="0.62" />
  <TresDirectionalLight :position="[4, 7, 9]" :intensity="0.5" />

  <TresInstancedMesh
    v-for="(plane, planeIndex) in plan.planes"
    :key="`plane-${planeIndex}`"
    :ref="(instance) => { if (instance) planeRefs[planeIndex] = instance }"
    :args="[cardGeometry, planeMaterials[planeIndex], plane.cards.length]"
    :frustum-culled="false"
  />

  <TresInstancedMesh
    v-if="plan.spheres.length > 0"
    ref="sphereRef"
    :args="[sphereGeometry, sphereMaterial, plan.spheres.length]"
    :frustum-culled="false"
  />

  <TresInstancedMesh
    v-if="plan.calendar.cells.length > 0"
    ref="calendarRef"
    :args="[calendarGeometry, calendarMaterial, plan.calendar.cells.length]"
    :frustum-culled="false"
  />

  <TresInstancedMesh
    v-if="plan.glints.length > 0"
    ref="glintRef"
    :args="[glintGeometry, glintMaterial, plan.glints.length]"
    :frustum-culled="false"
  />

  <TresPoints
    v-if="plan.dust.count > 0"
    ref="pointsRef"
    :args="[dustGeometry, dustMaterial]"
    :frustum-culled="false"
  />
</template>
