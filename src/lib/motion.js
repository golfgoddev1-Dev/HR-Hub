// UI motion, in one small module.
//
// GSAP is the animation engine for the interface (not for the 3D field, which
// animates in its own render loop). It is imported lazily, one dynamic import
// inside loadGsap(), so the library keeps its own chunk and the entry bundle never
// sees it. Core only: every animation below is a plain tween, so no plugin is
// needed and none is imported.
//
// Rules this module keeps:
// - transform and opacity only, never width, height, top, left or margin;
// - reduced motion jumps straight to the final state, with no animation at all;
// - failure is silent: if the import throws, every helper is a no-op or paints the
//   final value, and the page still renders and works with no motion.
import { prefersReducedMotion } from './background-quality.js'

const PRESS_SELECTOR = 'button, .v-btn, .primary-link, [data-press]'
const LIFT_SELECTOR = '.card, .summary-item, .push-card, .dock-tile'
const FINE_POINTER = '(hover: hover) and (pointer: fine)'

let gsapPromise = null

function loadGsap() {
  if (!gsapPromise) {
    gsapPromise = import('gsap')
      .then((module) => module.gsap ?? module.default ?? null)
      .catch(() => null)
  }
  return gsapPromise
}

function reduced() {
  return prefersReducedMotion()
}

function finePointer() {
  if (typeof window === 'undefined') return false
  try {
    return window.matchMedia?.(FINE_POINTER)?.matches === true
  } catch {
    return false
  }
}

/**
 * Count a number up to the value the page already shows.
 *
 * The element keeps its own metrics: only its text changes, so nothing reflows.
 * Resolves to the final value, and paints it immediately when the tween cannot
 * run (reduced motion, no GSAP, an unmounted element).
 */
export async function countUp(element, target, options = {}) {
  const to = Number(target)
  const final = Number.isFinite(to) ? to : 0
  if (!element) return final

  const paint = (value) => {
    element.textContent = String(Math.round(value))
  }

  if (reduced()) {
    paint(final)
    return final
  }

  const gsap = await loadGsap()
  if (!gsap || typeof gsap.to !== 'function') {
    paint(final)
    return final
  }

  // Tween a plain counter, never the DOM node's text directly. It starts at zero
  // (or the value the caller asks for) and only steps through lower numbers.
  const counter = { value: options.from ?? 0 }
  try {
    gsap.to(counter, {
      value: final,
      duration: options.duration ?? 0.75,
      ease: 'power2.out',
      overwrite: true,
      onUpdate: () => paint(counter.value),
      onComplete: () => paint(final),
    })
  } catch {
    paint(final)
  }
  return final
}

/** A route change: the new page fades in and slides a few pixels up. */
export async function fadeRoute(element) {
  if (!element) return
  if (reduced()) return

  const gsap = await loadGsap()
  if (!gsap) return
  try {
    gsap.fromTo(
      element,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.32, ease: 'power2.out', overwrite: true, clearProps: 'transform,opacity' }
    )
  } catch {
    // No motion is a valid outcome; the page is already visible.
  }
}

/**
 * Install the interface motion for a signed-in shell: press feedback on controls
 * and a lift on cards, both delegated so they work for pages that mount later.
 * Returns a cleanup that removes the listeners and any running tweens.
 *
 * Reduced motion, a coarse pointer or a failed import all end here with a no-op:
 * the page is usable, it simply does not move.
 */
export async function installUiMotion(root = typeof document === 'undefined' ? null : document) {
  if (!root || reduced()) return () => {}

  const gsap = await loadGsap()
  if (!gsap) return () => {}

  const tweened = new Set()

  const closest = (event, selector) => {
    const target = event.target
    if (!target || typeof target.closest !== 'function') return null
    return target.closest(selector)
  }

  const onPointerDown = (event) => {
    const control = closest(event, PRESS_SELECTOR)
    if (!control) return
    tweened.add(control)
    try {
      gsap.to(control, { scale: 0.97, duration: 0.12, ease: 'power1.out', overwrite: 'auto' })
    } catch {
      // A control that cannot tween keeps its CSS state.
    }
  }

  const release = (event) => {
    const control = closest(event, PRESS_SELECTOR)
    if (!control) return
    try {
      gsap.to(control, { scale: 1, duration: 0.18, ease: 'power2.out', overwrite: 'auto' })
    } catch {
      // Ignore: the control is back to its resting size in CSS.
    }
  }

  // Lift and tilt follow a real mouse only, never a finger.
  const onPointerOver = (event) => {
    if (!finePointer()) return
    const card = closest(event, LIFT_SELECTOR)
    if (!card || card.contains(event.relatedTarget)) return
    tweened.add(card)
    try {
      gsap.to(card, {
        y: -3,
        rotationX: 1.2,
        rotationY: -1.2,
        transformPerspective: 900,
        duration: 0.24,
        ease: 'power2.out',
        overwrite: 'auto',
      })
    } catch {
      // Ignore: the hover lift is decoration.
    }
  }

  const onPointerOut = (event) => {
    if (!finePointer()) return
    const card = closest(event, LIFT_SELECTOR)
    if (!card || card.contains(event.relatedTarget)) return
    try {
      gsap.to(card, {
        y: 0,
        rotationX: 0,
        rotationY: 0,
        duration: 0.28,
        ease: 'power2.out',
        overwrite: 'auto',
      })
    } catch {
      // Ignore.
    }
  }

  root.addEventListener('pointerdown', onPointerDown, true)
  root.addEventListener('pointerup', release, true)
  root.addEventListener('pointercancel', release, true)
  root.addEventListener('pointerover', onPointerOver, true)
  root.addEventListener('pointerout', onPointerOut, true)

  return () => {
    root.removeEventListener('pointerdown', onPointerDown, true)
    root.removeEventListener('pointerup', release, true)
    root.removeEventListener('pointercancel', release, true)
    root.removeEventListener('pointerover', onPointerOver, true)
    root.removeEventListener('pointerout', onPointerOut, true)
    for (const element of tweened) {
      try {
        gsap.killTweensOf(element)
      } catch {
        // Nothing to kill.
      }
    }
    tweened.clear()
  }
}
