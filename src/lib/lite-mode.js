// "Lite mode" is the one decision that keeps the HR leave page cheap on phones,
// weak machines and for anyone who asked for less motion. It is a pure function
// of the window so the page (tilt) and the 3D layer (WebGL) agree, and so tests
// can pass a fake window instead of resizing a real one.
//
// Lite mode is chosen when ANY of these is true:
// - the pointing device is coarse (touch first),
// - the viewport is narrower than 768px,
// - navigator.deviceMemory is set and 4 GB or less,
// - navigator.hardwareConcurrency is 4 or less,
// - the visitor prefers reduced motion.

const LITE_MAX_MEMORY_GB = 4
const LITE_MAX_CORES = 4
const LITE_MIN_WIDTH = 768

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

/** True when the visitor asked the system for less animation. */
export function prefersReducedMotion(win = defaultWindow()) {
  return mediaMatches(win, '(prefers-reduced-motion: reduce)')
}

/** True when the primary pointer cannot hover precisely (touch, pen). */
export function hasCoarsePointer(win = defaultWindow()) {
  return mediaMatches(win, '(pointer: coarse)')
}

function finitePositive(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

/**
 * True when the page must skip WebGL entirely and stay on a static gradient.
 * A missing window (SSR, odd test) is treated as lite: no scene is better than
 * a scene that cannot be measured.
 */
export function isLiteMode(win = defaultWindow()) {
  if (!win) return true

  if (prefersReducedMotion(win)) return true
  if (hasCoarsePointer(win)) return true

  const width = finitePositive(win.innerWidth)
  if (width !== null && width < LITE_MIN_WIDTH) return true

  const memory = finitePositive(win.navigator?.deviceMemory)
  if (memory !== null && memory <= LITE_MAX_MEMORY_GB) return true

  const cores = finitePositive(win.navigator?.hardwareConcurrency)
  if (cores !== null && cores <= LITE_MAX_CORES) return true

  return false
}

/**
 * Pointer tilt on the leave cards follows the same rule: a lite device keeps a
 * flat, still list, so reduced motion also turns the tilt off.
 */
export function allowsPointerTilt(win = defaultWindow()) {
  return !isLiteMode(win)
}
