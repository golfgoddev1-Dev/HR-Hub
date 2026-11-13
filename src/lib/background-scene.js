// The app background's content plan, separated from the renderer.
//
// Everything the scene draws is described here as plain data (positions, tilts,
// tints, sizes) and every per-frame transform is a pure function of that data and
// the clock. That keeps the visual budget testable without a GPU, and it is what
// lets the TresJS components stay declarative: they render this plan and write the
// matrices, they do not invent geometry.
//
// The brief's motif: floating glass cards in three depth planes, soft spheres,
// light glints, drifting dust and a month-grid calendar. The cards carry the three
// leave-status colours the app already uses (approved green, pending amber,
// rejected red) among the brand indigo/violet, so the field reads as a leave tool.
// No lettering is ever drawn.
//
// Budgets come from src/lib/background-quality.js and are never exceeded here:
// every count below is read straight from the tier config.

// Brand indigo and violet, plus the leave statuses the app already shows.
export const CARD_TINTS = Object.freeze([
  0x3730a3, 0x6d28d9, 0x818cf8, 0x4f46e5, 0x16a34a, 0x6d28d9, 0x818cf8, 0x3730a3,
  0xd97706, 0x4f46e5, 0x16a34a, 0x818cf8, 0xdc2626, 0x6d28d9, 0x3730a3, 0x4f46e5,
])

export const SPHERE_TINTS = Object.freeze([0x8b5cf6, 0x818cf8, 0x34d399])

export const CALENDAR_TINTS = Object.freeze([0xc7d2fe, 0x86efac, 0xfcd34d, 0xddd6fe, 0xa5b4fc, 0xfca5a5])

export const CARD_SIZE = Object.freeze({ width: 1.7, height: 1.05, radius: 0.22 })
export const CALENDAR_CELL_SIZE = Object.freeze({ width: 0.52, height: 0.34, radius: 0.07 })
export const GLINT_SIZE = Object.freeze({ width: 2.4, height: 0.16, radius: 0.08 })

// The camera and the depth of the field, in world units.
export const CAMERA = Object.freeze({ fov: 55, z: 14, near: 0.1, far: 80 })
export const SCENE_DEPTH = 7
export const MAX_PARALLAX = 0.85
export const CALENDAR_COLUMNS = 7

/** Deterministic pseudo-random in [0, 1): the same tier always draws the same field. */
export function seeded(index) {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

/** Deterministic pseudo-random in [min, max). */
export function between(index, min, max) {
  return min + seeded(index) * (max - min)
}

/** Every card sits on one of three depth planes, each with its own parallax share. */
export function cardPlanes(config) {
  // The static tier draws nothing: no planes, no cards.
  if (config.cardCount <= 0 || config.planeCount <= 0) return []

  const planeCount = Math.max(1, config.planeCount)
  const perPlane = Math.max(1, Math.floor(config.cardCount / planeCount))
  const planes = []

  for (let plane = 0; plane < planeCount; plane += 1) {
    const cards = []
    for (let index = 0; index < perPlane; index += 1) {
      const seed = plane * 97 + index
      cards.push({
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
      })
    }
    planes.push({
      index: plane,
      // 0 for the far plane, 1 for the nearest: the parallax share.
      depth: planeCount === 1 ? 1 : plane / (planeCount - 1),
      // Nearer planes are denser, which is what reads as depth.
      opacity: 0.46 + plane * 0.13,
      cards,
    })
  }

  return planes
}

export function sphereField(config) {
  const spheres = []
  for (let index = 0; index < config.sphereCount; index += 1) {
    spheres.push({
      nx: between(index * 17 + 3, -0.9, 0.9),
      ny: between(index * 19 + 5, -0.9, 0.9),
      nz: between(index * 23 + 7, -1, 0),
      scale: between(index * 29 + 11, 0.22, 0.62),
      phase: between(index * 31 + 13, 0, Math.PI * 2),
      tint: SPHERE_TINTS[index % SPHERE_TINTS.length],
    })
  }
  return spheres
}

/** The month grid: a shape made of cells, never a date or a label. */
export function calendarField(config) {
  if (config.calendarCellCount <= 0) return { columns: 0, rows: 0, cells: [] }

  const cells = []
  const rows = Math.ceil(config.calendarCellCount / CALENDAR_COLUMNS)
  for (let index = 0; index < config.calendarCellCount; index += 1) {
    const column = index % CALENDAR_COLUMNS
    const row = Math.floor(index / CALENDAR_COLUMNS)
    cells.push({
      x: (column - (CALENDAR_COLUMNS - 1) / 2) * 0.62,
      y: ((rows - 1) / 2 - row) * 0.44,
      phase: between(index * 37 + 3, 0, Math.PI * 2),
      tint: CALENDAR_TINTS[index % CALENDAR_TINTS.length],
    })
  }

  return { columns: CALENDAR_COLUMNS, rows, cells }
}

/** Additive streaks that sweep across the field and fade in and out by scale. */
export function glintStreaks(config) {
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
  return streaks
}

/** Drifting motes, one Points draw call. Positions are seeded and wrapped in place. */
export function dustField(config) {
  const count = Math.max(0, config.particleCount)
  const positions = new Float32Array(count * 3)
  const seeds = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = between(index * 59 + 3, -1, 1) * 11
    positions[index * 3 + 1] = between(index * 61 + 5, -1, 1) * 7
    positions[index * 3 + 2] = between(index * 67 + 7, -1, 0) * SCENE_DEPTH - 1
    seeds[index] = between(index * 71 + 11, 0, 1)
  }

  return { count, positions, seeds }
}

/**
 * The whole plan for one tier. `objectCount` and `particleCount` are what the tier
 * budget test compares against the config, so a tier can never quietly draw more
 * than it promised.
 */
export function scenePlan(config) {
  const planes = cardPlanes(config)
  const spheres = sphereField(config)
  const calendar = calendarField(config)
  const glints = glintStreaks(config)
  const dust = dustField(config)

  const cardCount = planes.reduce((total, plane) => total + plane.cards.length, 0)
  const objectCount = cardCount + spheres.length + calendar.cells.length + glints.length

  return { planes, spheres, calendar, glints, dust, cardCount, objectCount, particleCount: dust.count }
}

// ---- Per-frame layout -------------------------------------------------------
// Pure functions of (plan, clock, pointer, field). They write into reusable
// arrays so a frame allocates nothing; the components only copy the numbers into
// instance matrices.

function slot(out, index) {
  if (!out[index]) out[index] = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
  return out[index]
}

/** Cards: bob, sway, a little lean, and a share of the pointer offset by depth. */
export function layoutCards(plan, state, out) {
  const { time, field, pointer, tilt } = state
  const halfWidth = field.width / 2
  const halfHeight = field.height / 2
  // Cards keep their proportion on a narrow phone screen.
  const size = Math.min(1.2, Math.max(0.42, field.width / 22))
  let index = 0

  for (const plane of plan.planes) {
    const share = 0.16 + plane.depth * 0.5
    const baseZ = -2.2 - (1 - plane.depth) * 4.4

    for (const card of plane.cards) {
      const target = slot(out, index)
      const bob = Math.sin(time * 0.26 + card.phase)
      const sway = Math.cos(time * 0.19 + card.phase)
      target.x = card.nx * halfWidth * 0.94 + sway * 0.5 + pointer.x * share
      target.y = card.ny * halfHeight * 0.94 + bob * card.bob - pointer.y * share * 0.7
      target.z = card.nz * SCENE_DEPTH * 0.8 + baseZ
      target.rx = card.tiltX + bob * 0.05
      target.ry = card.tiltY + sway * 0.09
      target.rz = card.tiltZ + bob * 0.04
      target.scale = card.scale * size * (1 + bob * 0.015) * (0.72 + plane.depth * 0.28)
      index += 1
    }
  }

  return { count: index, tilt }
}

export function layoutSpheres(plan, state, out) {
  const { time, field, pointer } = state
  const halfWidth = field.width / 2
  const halfHeight = field.height / 2

  for (let index = 0; index < plan.spheres.length; index += 1) {
    const sphere = plan.spheres[index]
    const target = slot(out, index)
    const drift = Math.sin(time * 0.21 + sphere.phase)
    target.x = sphere.nx * halfWidth * 0.82 + drift * 0.3 + pointer.x * 0.4
    target.y =
      sphere.ny * halfHeight * 0.82 +
      Math.cos(time * 0.17 + sphere.phase) * 0.4 -
      pointer.y * 0.3
    target.z = sphere.nz * SCENE_DEPTH - 4
    target.rx = 0
    target.ry = 0
    target.rz = 0
    target.scale = sphere.scale * (1 + drift * 0.06)
  }

  return { count: plan.spheres.length }
}

/** The calendar sits behind everything, slanting very slightly like a sheet. */
export function layoutCalendar(plan, state, out) {
  const { time, field, pointer } = state
  const halfHeight = field.height / 2
  const lean = Math.sin(time * 0.17) * 0.06
  const compact = Math.min(1, halfHeight / 4.2)

  for (let index = 0; index < plan.calendar.cells.length; index += 1) {
    const cell = plan.calendar.cells[index]
    const target = slot(out, index)
    target.x = cell.x * compact + pointer.x * 0.2
    target.y = cell.y * compact + Math.sin(time * 0.3 + cell.phase) * 0.04 - pointer.y * 0.15
    target.z = -8.6
    target.rx = lean
    target.ry = lean * 0.6
    target.rz = 0
    target.scale = 0.9
  }

  return { count: plan.calendar.cells.length }
}

export function layoutGlints(plan, state, out) {
  const { time, field } = state
  const halfWidth = field.width / 2
  const halfHeight = field.height / 2

  for (let index = 0; index < plan.glints.length; index += 1) {
    const streak = plan.glints[index]
    const travel = (time * streak.speed + streak.phase) % 1
    const fade = Math.sin(travel * Math.PI)
    const target = slot(out, index)
    target.x = travel * halfWidth * 2.4 - halfWidth * 1.2
    target.y = streak.y * halfHeight * 0.9 + Math.sin(travel * Math.PI * 2) * 0.4
    target.z = -3.4 - streak.level * 0.5
    target.rx = 0
    target.ry = 0
    target.rz = streak.lean * 0.5
    // Never exactly zero: a zero scale is a degenerate matrix.
    target.scale = Math.max(0.001, fade)
  }

  return { count: plan.glints.length }
}

/** Dust drifts up and wraps at the edge of the field, in place. */
export function driftDust(plan, state) {
  const { time, field } = state
  const positions = plan.dust.positions
  const seeds = plan.dust.seeds
  const halfWidth = field.width / 2
  const halfHeight = field.height / 2

  for (let index = 0; index < plan.dust.count; index += 1) {
    const at = index * 3
    const speed = 0.16 + seeds[index] * 0.34
    positions[at + 1] += speed * 0.014
    if (positions[at + 1] > halfHeight + 1) positions[at + 1] = -halfHeight - 1
    positions[at] += Math.sin(time * 0.4 + seeds[index] * 6.28) * 0.004
    if (positions[at] > halfWidth + 1) positions[at] = -halfWidth - 1
    if (positions[at] < -halfWidth - 1) positions[at] = halfWidth + 1
  }

  return positions
}

/** The camera drifts on its own, then leans towards the pointer. */
export function cameraDrift(state, camera) {
  const { elapsed, pointer, strength } = state
  const x = Math.sin(elapsed * 0.16) * 0.55 + pointer.x * strength
  const y = Math.cos(elapsed * 0.12) * 0.4 - pointer.y * strength * 0.7
  camera.position.x = x
  camera.position.y = y
  camera.lookAt(0, 0, 0)
}
