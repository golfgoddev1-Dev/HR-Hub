// The app background's content plan, separated from the renderer.
//
// Everything the scene draws is described here as plain data and every per-frame
// transform is a pure function of that data and the clock. That keeps the visual
// budget testable without a GPU, and it is what lets the TresJS components stay
// declarative: they render this plan and write the numbers, they do not invent
// geometry.
//
// The motif is "crystal over aurora": five silk ribbons ripple at the back, a
// metallic crystal knot with a faceted shell and three beaded rings turns in the
// middle, gems orbit it in the leave-status colours and brand indigo, soft halos
// glow behind, and star dust drifts up. No lettering is ever drawn.
//
// Budgets come from src/lib/background-quality.js and are never exceeded here:
// every count below is read straight from the tier config.

// Ribbon gradients (start, end): brand indigo and violet carry the field, sky,
// rose and teal are accents.
export const RIBBON_PALETTES = Object.freeze([
  Object.freeze([0x4f46e5, 0x38bdf8]),
  Object.freeze([0x8b5cf6, 0xf472b6]),
  Object.freeze([0x22d3ee, 0x6366f1]),
  Object.freeze([0xa78bfa, 0x34d399]),
  Object.freeze([0x6366f1, 0xf472b6]),
])

// Gems carry the three leave statuses the app already shows (approved green,
// pending amber, rejected red) among the brand colours, so the field still reads
// as a leave tool.
export const GEM_TINTS = Object.freeze([
  0x8b5cf6, 0x38bdf8, 0x34d399, 0xf472b6, 0xfcd34d, 0x16a34a, 0x818cf8, 0xd97706, 0x22d3ee, 0xdc2626,
])

export const RING_TINTS = Object.freeze([0x38bdf8, 0xf472b6, 0xa78bfa])

// Halo colours as canvas gradient stops, and where each one sits in the field.
export const HALOS = Object.freeze([
  Object.freeze({ color: 'rgba(167,139,250,0.55)', size: 30, x: 6, y: 3, z: -16, opacity: 0.55 }),
  Object.freeze({ color: 'rgba(56,189,248,0.5)', size: 26, x: -8, y: -2, z: -14, opacity: 0.45 }),
  Object.freeze({ color: 'rgba(129,140,248,0.9)', size: 7.5, x: 0, y: 0, z: -2, opacity: 0.75 }),
])

export const RIBBON_SIZE = Object.freeze({ width: 38, height: 7 })
export const KNOT = Object.freeze({ radius: 2.1, tube: 0.62, p: 2, q: 3, z: -2 })
export const SHELL_RADIUS = 3.7
export const GEM_BASE = 0.16
export const BEAD_RADIUS = 0.13

// The camera and the depth of the field, in world units.
export const CAMERA = Object.freeze({ fov: 55, z: 11, near: 0.1, far: 80 })
export const SCENE_DEPTH = 7
export const MAX_PARALLAX = 0.85

/** Deterministic pseudo-random in [0, 1): the same tier always draws the same field. */
export function seeded(index) {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

/** Deterministic pseudo-random in [min, max). */
export function between(index, min, max) {
  return min + seeded(index) * (max - min)
}

function toLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

/**
 * 0xRRGGBB to [r, g, b] in 0..1 in the renderer's linear working space. Vertex
 * colours are not converted by Three.js (a Color made from a hex is), so a raw
 * sRGB value would render washed out and grey.
 */
export function hexToRgb(hex) {
  return [
    toLinear(((hex >> 16) & 255) / 255),
    toLinear(((hex >> 8) & 255) / 255),
    toLinear((hex & 255) / 255),
  ]
}

/**
 * How much of the field the crystal group may fill: the whole thing on a wide
 * screen, scaled down on a narrow phone so the knot never swallows the view.
 */
export function heroFit(field) {
  return Math.min(1, Math.max(0.42, field.width / 15))
}

/** Ribbons: wide silk sheets stacked back to front, each with its own gradient. */
export function ribbonField(config) {
  const ribbons = []
  const count = Math.max(0, config.ribbonCount)
  for (let index = 0; index < count; index += 1) {
    const [from, to] = RIBBON_PALETTES[index % RIBBON_PALETTES.length]
    ribbons.push({
      index,
      cols: config.ribbonCols,
      rows: config.ribbonRows,
      from: hexToRgb(from),
      to: hexToRgb(to),
      crest: to,
      y: (index - (count - 1) / 2) * 1.9,
      z: -5 - index * 1.4,
      opacity: 0.55 - index * 0.04,
    })
  }
  return ribbons
}

export function ringField(config) {
  const rings = []
  for (let index = 0; index < config.ringCount; index += 1) {
    rings.push({
      index,
      radius: 4.2 + index * 1.1,
      tint: RING_TINTS[index % RING_TINTS.length],
      beads: config.beadsPerRing,
    })
  }
  return rings
}

/** Gems: each circles the knot on its own tilted orbit and turns as it goes. */
export function gemField(config) {
  const gems = []
  for (let index = 0; index < config.gemCount; index += 1) {
    gems.push({
      radius: 4.8 + (index % 8) * 0.55,
      angle: index * 0.7,
      tilt: (index % 6) * 0.45,
      speed: 0.15 + (index % 9) * 0.04,
      scale: GEM_BASE + (index % 4) * 0.07,
      tint: GEM_TINTS[index % GEM_TINTS.length],
    })
  }
  return gems
}

export function haloField(config) {
  return HALOS.slice(0, Math.max(0, config.haloCount))
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
  const ribbons = ribbonField(config)
  const rings = ringField(config)
  const gems = gemField(config)
  const halos = haloField(config)
  const dust = dustField(config)
  const knot =
    config.knotSegments > 0
      ? { ...KNOT, segments: config.knotSegments, radial: config.knotRadial }
      : null
  const shell = knot !== null && config.shell === true ? { radius: SHELL_RADIUS } : null
  const beadCount = rings.reduce((total, ring) => total + ring.beads, 0)

  const objectCount =
    ribbons.length +
    (knot ? 1 : 0) +
    (shell ? 1 : 0) +
    rings.length +
    beadCount +
    gems.length +
    halos.length

  return {
    ribbons,
    knot,
    shell,
    rings,
    beadCount,
    gems,
    halos,
    dust,
    objectCount,
    particleCount: dust.count,
  }
}

// ---- Per-frame layout -------------------------------------------------------
// Pure functions of (plan, clock, pointer, field). They write into reusable
// arrays so a frame allocates nothing; the components only copy the numbers into
// geometry attributes and instance matrices.

function slot(out, index) {
  if (!out[index]) out[index] = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
  return out[index]
}

/**
 * Ripples one ribbon. `positions` is the plane's position attribute (x and y are
 * the flat sheet, z is written here). With `paint` the gradient is re-mixed and
 * the glowing crest line (the sheet's top edge) is refreshed too; both are
 * slower-moving, so the renderer asks for them every other frame.
 */
export function waveRibbon(ribbon, time, positions, colors, crest, paint) {
  const k = ribbon.index
  const total = positions.length / 3
  for (let i = 0; i < total; i += 1) {
    const at = i * 3
    const x = positions[at]
    const v = positions[at + 1]
    const w =
      Math.sin(x * 0.28 + time * 0.7 + k) * 1.5 +
      Math.sin(x * 0.6 - time * 1.1 + k * 2) * 0.55 +
      Math.sin(x * 1.3 + time * 1.9 + k) * 0.12
    positions[at + 2] = w + v * 0.25 * Math.sin(time * 0.5 + x * 0.2)

    if (paint && colors) {
      const mix = 0.5 + 0.5 * Math.sin(x * 0.18 + time * 0.4 + v * 0.3)
      colors[at] = ribbon.from[0] + (ribbon.to[0] - ribbon.from[0]) * mix
      colors[at + 1] = ribbon.from[1] + (ribbon.to[1] - ribbon.from[1]) * mix
      colors[at + 2] = ribbon.from[2] + (ribbon.to[2] - ribbon.from[2]) * mix
    }
  }

  if (paint && crest) {
    // The first row of a PlaneGeometry is its top edge: cols + 1 vertices.
    for (let i = 0; i <= ribbon.cols; i += 1) {
      const at = i * 3
      crest[at] = positions[at]
      crest[at + 1] = positions[at + 1]
      crest[at + 2] = positions[at + 2] + 0.02
    }
  }
}

/** The knot turns slowly on two axes and rocks a little on the third. */
export function layoutKnot(state, out) {
  const { time } = state
  out.rx = time * 0.22
  out.ry = time * 0.31
  out.rz = Math.sin(time * 0.2) * 0.2
  out.z = KNOT.z
  return out
}

/** The faceted shell counter-rotates against the knot. */
export function layoutShell(state, out) {
  const { time } = state
  out.rx = -time * 0.12
  out.ry = -time * 0.17
  out.rz = 0
  out.z = KNOT.z
  return out
}

/**
 * Rings tilt and spin, and each bead rides its ring. A bead's position is the
 * ring's own rotation (Euler XYZ, like the torus mesh it rides on) applied to a
 * point on the circle, so the bead stays exactly on the drawn ring.
 */
export function layoutRings(plan, state, ringOut, beadOut) {
  const { time } = state
  const fit = state.fit ?? 1
  let bead = 0

  for (const ring of plan.rings) {
    const spin = time * (0.2 + ring.index * 0.07) * (ring.index % 2 ? -1 : 1)
    const rx = 0.6 + ring.index * 0.7 + Math.sin(time * 0.3 + ring.index) * 0.25
    const ry = spin
    const rz = ring.index * 0.5
    const target = slot(ringOut, ring.index)
    target.x = 0
    target.y = 0
    target.z = KNOT.z
    target.rx = rx
    target.ry = ry
    target.rz = rz
    target.scale = fit

    const cx = Math.cos(rx)
    const sx = Math.sin(rx)
    const cy = Math.cos(ry)
    const sy = Math.sin(ry)
    const cz = Math.cos(rz)
    const sz = Math.sin(rz)

    for (let k = 0; k < ring.beads; k += 1) {
      const angle = time * (0.9 + ring.index * 0.25) + k * ((Math.PI * 2) / ring.beads)
      const px = Math.cos(angle) * ring.radius * fit
      const py = Math.sin(angle) * ring.radius * fit
      // Rz, then Ry, then Rx.
      const x1 = px * cz - py * sz
      const y1 = px * sz + py * cz
      const x2 = x1 * cy
      const z2 = -x1 * sy
      const y3 = y1 * cx - z2 * sx
      const z3 = y1 * sx + z2 * cx
      const out = slot(beadOut, bead)
      out.x = x2
      out.y = y3
      out.z = z3 + KNOT.z
      out.rx = 0
      out.ry = 0
      out.rz = 0
      out.scale = fit
      bead += 1
    }
  }

  return { rings: plan.rings.length, beads: bead }
}

/** Gems circle the knot, bob on a tilted orbit and turn on two axes. */
export function layoutGems(plan, state, out) {
  const { time, pointer } = state
  const fit = state.fit ?? 1

  for (let index = 0; index < plan.gems.length; index += 1) {
    const gem = plan.gems[index]
    const target = slot(out, index)
    const angle = gem.angle + time * gem.speed
    target.x = Math.cos(angle) * gem.radius * fit + pointer.x * 0.25
    target.y = Math.sin(angle * 1.3 + gem.tilt) * 2.8 * fit - pointer.y * 0.2
    target.z = Math.sin(angle) * gem.radius * 0.6 * fit + KNOT.z
    target.rx = time * 0.6 + gem.angle
    target.ry = time * 0.4
    target.rz = 0
    target.scale = gem.scale * fit * (1 + Math.sin(time * 0.8 + gem.angle) * 0.08)
  }

  return { count: plan.gems.length }
}

/** The three wandering lights that make the metal and the facets shimmer. */
export function lightPositions(state, field, out) {
  const { time } = state
  out[0] = out[0] || { x: 0, y: 0, z: 0 }
  out[1] = out[1] || { x: 0, y: 0, z: 0 }
  out[2] = out[2] || { x: 0, y: 0, z: 0 }
  out[0].x = Math.cos(time * 0.6) * field.width * 0.36
  out[0].y = Math.sin(time * 0.45) * field.height * 0.34
  out[0].z = KNOT.z + 4
  out[1].x = Math.cos(time * 0.4 + 2) * -field.width * 0.36
  out[1].y = Math.sin(time * 0.5) * field.height * 0.34
  out[1].z = KNOT.z + 3
  out[2].x = Math.sin(time * 0.33) * field.width * 0.25
  out[2].y = Math.cos(time * 0.7) * -field.height * 0.3
  out[2].z = KNOT.z + 5
  return out
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
    positions[at + 1] += speed * 0.024
    if (positions[at + 1] > halfHeight + 1) positions[at + 1] = -halfHeight - 1
    positions[at] += Math.sin(time * 0.6 + seeds[index] * 6.28) * 0.007
    if (positions[at] > halfWidth + 1) positions[at] = -halfWidth - 1
    if (positions[at] < -halfWidth - 1) positions[at] = halfWidth + 1
  }

  return positions
}

/** The camera drifts on its own around the knot, then leans towards the pointer. */
export function cameraDrift(state, camera) {
  const { elapsed, pointer, strength } = state
  const x = Math.sin(elapsed * 0.15) * 1.6 + pointer.x * strength
  const y = Math.cos(elapsed * 0.12) * 0.9 - pointer.y * strength * 0.7
  camera.position.x = x
  camera.position.y = y
  camera.lookAt(0, 0, KNOT.z)
}
