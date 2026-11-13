// The one place that decides how much 3D the app background may draw.
//
// Everything here is a pure function of plain values (device hints, frame
// times), so the tier policy is unit-tested without a GPU, a WebGL context or a
// real Three.js. src/components/AppBackground3D.vue owns the canvas; this module
// owns the budget.
//
// The tiers, from the design brief:
// - high:   up to 60 instanced objects, pixel ratio capped at 1.5, 60 fps target
// - medium: up to 30 instanced objects, pixel ratio capped at 1.0, 30 fps target
// - low:    up to 12 instanced objects, pixel ratio capped at 0.75, 24 fps target
// - static: no WebGL at all, the CSS gradient only
//
// No tier enables shadow maps or post-processing: the background is a full-screen
// decal with nothing to receive a shadow, so both would cost frames for nothing.

export const QUALITY_TIERS = Object.freeze({
  high: Object.freeze({
    name: 'high',
    objectCount: 60,
    cardCount: 44,
    sphereCount: 16,
    pixelRatioCap: 1.5,
    targetFps: 60,
    shadows: false,
    postProcessing: false,
    material: 'standard',
    mouseParallax: true,
    sphereSegments: 20,
  }),
  medium: Object.freeze({
    name: 'medium',
    objectCount: 30,
    cardCount: 22,
    sphereCount: 8,
    pixelRatioCap: 1,
    targetFps: 30,
    shadows: false,
    postProcessing: false,
    material: 'lambert',
    mouseParallax: true,
    sphereSegments: 12,
  }),
  low: Object.freeze({
    name: 'low',
    objectCount: 12,
    cardCount: 9,
    sphereCount: 3,
    pixelRatioCap: 0.75,
    targetFps: 24,
    shadows: false,
    postProcessing: false,
    material: 'basic',
    mouseParallax: false,
    sphereSegments: 8,
  }),
  static: Object.freeze({
    name: 'static',
    objectCount: 0,
    cardCount: 0,
    sphereCount: 0,
    pixelRatioCap: 1,
    targetFps: 0,
    shadows: false,
    postProcessing: false,
    material: 'none',
    mouseParallax: false,
    sphereSegments: 0,
  }),
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
// readability comes from the panels the text sits on instead of from a veil.
// Every surface in src/styles.css is at least this opaque, and none of them
// depends on a backdrop blur.
export const SURFACE_OPACITY = 0.97

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


