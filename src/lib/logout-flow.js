// The logout choreography: feedback first, then the real request, then a
// navigation that waits for the feedback instead of racing it.
//
// It lives outside the component so the timing is testable without a DOM; the
// dock only supplies the request, the navigation and the visual callbacks.
export const LOGOUT_MIN_MS = 900
export const LOGOUT_FALLBACK_MS = 4000

/**
 * Top-left corner and side of a round ripple that starts at the pointer and
 * covers the button's larger side.
 */
export function ripplePlacement(rect, point) {
  const size = Math.max(rect.width, rect.height)
  const x = (point?.x ?? rect.left + rect.width / 2) - rect.left - size / 2
  const y = (point?.y ?? rect.top + rect.height / 2) - rect.top - size / 2
  return { size, x, y }
}

const noop = () => {}
const defaultWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Builds a one-shot logout function.
 *
 * The request starts on the click. Navigation waits for both the minimum delay
 * (so the feedback is visible) and the request settling, with a hard cap so a
 * request that never settles still ends on /login. A second call while one is
 * running is ignored, so a double click cannot send a second POST.
 *
 * @param {object} options
 * @param {() => Promise<unknown>} options.request
 * @param {() => void} options.navigate
 * @param {(ms: number) => Promise<unknown>} [options.wait]
 * @param {() => boolean} [options.isReducedMotion]
 * @param {() => void} [options.onStart] pending state, always runs
 * @param {(event?: MouseEvent) => void} [options.onRipple] skipped in reduced motion
 * @param {() => void} [options.onFlash] skipped in reduced motion
 */
export function createLogoutFlow({
  request,
  navigate,
  wait = defaultWait,
  isReducedMotion = () => false,
  onStart = noop,
  onRipple = noop,
  onFlash = noop,
}) {
  let running = false

  return function logout(event) {
    if (running) return null
    running = true

    onStart()
    if (!isReducedMotion()) {
      onRipple(event)
      onFlash()
    }

    // The POST starts on the click itself, not on a later microtask.
    let settled
    try {
      settled = Promise.resolve(request()).then(noop, noop)
    } catch {
      settled = Promise.resolve()
    }
    // Both timers start at the click: the minimum keeps the feedback visible,
    // and the cap keeps the user from being stuck on a request that never ends.
    const minimum = wait(LOGOUT_MIN_MS)
    const capped = Promise.race([settled, wait(LOGOUT_FALLBACK_MS)])

    return capped.then(() => minimum).then(() => navigate())
  }
}
