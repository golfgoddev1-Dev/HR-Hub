// The one place that decides how much 3D the app background may draw.
//
// Everything here is a pure function of plain values (device hints, frame
// times), so the tier policy is unit-tested without a GPU, a WebGL context or a
// real Three.js. src/components/AppBackground3D.vue owns the canvas; this module
// owns the budget.
//
// The tiers, from the design brief. `objectCount` is the cap on every instanced
// object in the scene (cards on the three depth planes + spheres + glints +
// calendar cells); particles are counted separately because they are one draw
// call of point sprites. `glassBlur` is the CSS cost the panels may spend at that
// tier, so a mid or low device pays less for the frosting than for the scene.
//
// - high:   up to 120 objects, up to 300 particles, pixel ratio 1.5, 60 fps
// - medium: up to 60 objects, up to 120 particles, pixel ratio 1.0, 30 fps
// - low:    up to 24 objects, up to 40 particles, pixel ratio 0.75, 24 fps
// - static: no WebGL at all, the CSS gradient only, no glass blur
//
// No tier enables shadow maps or post-processing: the background is a full-screen
// decal with nothing to receive a shadow, so both would cost frames for nothing.
export const QUALITY_TIERS = Object.freeze({
  high: Object.freeze({
    name: 'high',
    objectCount: 120,
    cardCount: 60,
    sphereCount: 14,
    glintCount: 6,
    calendarCellCount: 40,
    planeCount: 3,
    particleCount: 260,
    pixelRatioCap: 1.5,
    targetFps: 60,
    shadows: false,
    postProcessing: false,
    material: 'standard',
    mouseParallax: true,
    cardTilt: true,
    glassBlur: 18,
    sphereSegments: 20,
  }),
  medium: Object.freeze({
    name: 'medium',
    objectCount: 60,
    cardCount: 30,
    sphereCount: 8,
    glintCount: 4,
    calendarCellCount: 18,
    planeCount: 3,
    particleCount: 120,
    pixelRatioCap: 1,
    targetFps: 30,
    shadows: false,
    postProcessing: false,
    material: 'lambert',
    mouseParallax: false,
    cardTilt: false,
    glassBlur: 8,
    sphereSegments: 12,
  }),
  low: Object.freeze({
    name: 'low',
    objectCount: 24,
    cardCount: 12,
    sphereCount: 3,
    glintCount: 0,
    calendarCellCount: 9,
    planeCount: 3,
    particleCount: 32,
    pixelRatioCap: 0.75,
    targetFps: 24,
    shadows: false,
    postProcessing: false,
    material: 'basic',
    mouseParallax: false,
    cardTilt: false,
    glassBlur: 8,
    sphereSegments: 8,
  }),
  static: Object.freeze({
    name: 'static',
    objectCount: 0,
    cardCount: 0,
    sphereCount: 0,
    glintCount: 0,
    calendarCellCount: 0,
    planeCount: 0,
    particleCount: 0,
    pixelRatioCap: 1,
    targetFps: 0,
    shadows: false,
    postProcessing: false,
    material: 'none',
    mouseParallax: false,
    cardTilt: false,
    glassBlur: 0,
    sphereSegments: 0,
  }),
})

// The glass panels: a blur inside the 14-20px band at high, the reduced 8px on
// medium and low, and no blur at all on the static tier. The tint is never below
// GLASS_TINT.min, which is what keeps muted text at AA over the darkest scene
// pixel that can show through.
export const GLASS = Object.freeze({
  blurMin: 14,
  blurMax: 20,
  reducedBlur: 8,
  tintMin: 0.9,
  tintMax: 0.98,
})

/** Descending quality: every step down is final for the session. */
export const TIER_SEQUENCE = Object.freeze(['high', 'medium', 'low', 'static'])

// The benchmark window and its three thresholds, from the brief:
// drop one tier above 24 ms, allow one raise below 14 ms, and give up on WebGL
// above 40 ms while already on the lowest 3D tier.
export const BENCHMARK = Object.freeze({
  frames: 60,
  dropAboveMs: 24,
  raiseBelowMs: 14,
  staticAboveMs: 40,
})

// A device hint only counts when it is a usable positive number.
export const DEVICE_HINT_LIMITS = Object.freeze({
  maxMemoryGb: 4,
  maxCores: 4,
})

// Nothing is painted over the canvas: the scene is the visible backdrop, and
// readability comes from the frosted panels the text sits on. The panels use a
// translucent white tint over a backdrop blur, so the number below is the floor a
// panel tint may not go under regardless of tier.
export const SURFACE_OPACITY = GLASS.tintMin

function defaultWindow() {
  return typeof window === 'undefined' ? null : window
}

function mediaMatches(win, query) {
  const media = win?.matchMedia
  if (typeof media !== 'function') return false
  try {
    return media.call(win, query)?.matches === true
  } catch {
    return false
  }
}

function finitePositive(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

/** True when the visitor asked the system for less animation. */
export function prefersReducedMotion(win = defaultWindow()) {
  return mediaMatches(win, '(prefers-reduced-motion: reduce)')
}

/** True when the primary pointer cannot point precisely (touch, pen). */
export function hasCoarsePointer(win = defaultWindow()) {
  return mediaMatches(win, '(pointer: coarse)')
}

/** True when a precise pointer is available, so mouse parallax is meaningful. */
export function hasFinePointer(win = defaultWindow()) {
  return mediaMatches(win, '(pointer: fine)')
}

/** The four hints the tier choice is built from, read once at mount. */
export function deviceHints(win = defaultWindow()) {
  const navigator = win?.navigator
  return {
    deviceMemory: finitePositive(navigator?.deviceMemory),
    hardwareConcurrency: finitePositive(navigator?.hardwareConcurrency),
    coarsePointer: hasCoarsePointer(win),
    finePointer: hasFinePointer(win),
    reducedMotion: prefersReducedMotion(win),
  }
}

export function normalizedTier(value) {
  return TIER_SEQUENCE.includes(value) ? value : 'static'
}

export function nextTierDown(tier) {
  const index = TIER_SEQUENCE.indexOf(normalizedTier(tier))
  return TIER_SEQUENCE[Math.min(index + 1, TIER_SEQUENCE.length - 1)]
}

export function nextTierUp(tier) {
  const index = TIER_SEQUENCE.indexOf(normalizedTier(tier))
  return TIER_SEQUENCE[Math.max(index - 1, 0)]
}

/**
 * The opening tier, from device hints only.
 *
 * - reduced motion wins: the scene is static, no WebGL, no motion.
 * - a coarse pointer, 4 GB of memory or 4 cores starts at medium, never high.
 * - everything else starts at high.
 */
export function initialTier(hints = {}) {
  if (hints.reducedMotion === true) return 'static'

  const memory = finitePositive(hints.deviceMemory)
  const cores = finitePositive(hints.hardwareConcurrency)

  if (hints.coarsePointer === true) return 'medium'
  if (memory !== null && memory <= DEVICE_HINT_LIMITS.maxMemoryGb) return 'medium'
  if (cores !== null && cores <= DEVICE_HINT_LIMITS.maxCores) return 'medium'

  return 'high'
}

/**
 * The benchmark that runs on the first frames and may only ever walk down the
 * tier list, with one exception: a device that started at medium or low because
 * of a hint, and turns out to be fast, may move up exactly one tier. Once
 * anything has been dropped, nothing is raised for the rest of the session, and
 * a tier that has been raised once is never measured for another raise.
 *
 * push(frameMs) is fed one frame time per animation frame. It returns
 * { tier, decided, average, done }: `decided` means the caller must rebuild the
 * scene for the new tier, `done` means the benchmark has finished for good.
 */
export function createBenchmark(startTier, options = {}) {
  const coarsePointer = options.coarsePointer === true
  let tier = normalizedTier(startTier)
  let frames = 0
  let total = 0
  let dropped = false
  let raised = false
  let done = tier === 'static' || options.reducedMotion === true

  const verdict = (decided, average) => ({ tier, decided, average, done })

  return {
    get tier() {
      return tier
    },
    get done() {
      return done
    },
    get dropped() {
      return dropped
    },
    push(frameMs) {
      if (done) return verdict(false, null)

      const ms = Number(frameMs)
      if (!Number.isFinite(ms) || ms <= 0) return verdict(false, null)

      frames += 1
      total += ms
      if (frames < BENCHMARK.frames) return verdict(false, null)

      const average = total / frames
      frames = 0
      total = 0

      // The lowest 3D tier gives up entirely, but only past its own threshold:
      // between 24 and 40 ms it stays at low, which is what low is for.
      if (tier === 'low') {
        if (average > BENCHMARK.staticAboveMs) {
          tier = 'static'
          dropped = true
          done = true
          return verdict(true, average)
        }
      } else if (average > BENCHMARK.dropAboveMs) {
        tier = nextTierDown(tier)
        dropped = true
        done = tier === 'static'
        return verdict(true, average)
      }

      if (
        average < BENCHMARK.raiseBelowMs &&
        !dropped &&
        !raised &&
        !coarsePointer &&
        (tier === 'low' || tier === 'medium')
      ) {
        tier = nextTierUp(tier)
        raised = true
        // One raise is all a session gets: after that the tier is settled.
        done = true
        return verdict(true, average)
      }

      done = true
      return verdict(false, average)
    },
  }
}


