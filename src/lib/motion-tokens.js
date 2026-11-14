// One motion language for the whole app.
//
// Every page uses these numbers. Nothing else in the tree may invent a duration,
// an easing curve, a lift, a focus ring or a stagger step: a page that needs
// motion asks for the token, and the CSS custom properties of the same names
// (declared in src/styles.css, asserted equal by tests/motion-system.test.js)
// are the same values.
//
// The rules this encodes (docs/ai/hr-hub-ui-motion.md sections 3 and 4,
// docs/ai/frontend-design.md section E):
// - transform and opacity only;
// - entrance under 600ms, stagger at most 60ms;
// - one easing curve, one hover lift, one focus ring;
// - reduced motion is the final state, immediately, with no animation or timer.
//
// GSAP lives behind src/lib/motion.js, so this module stays dependency-free and
// can be imported by a page chunk without touching the entry bundle.

/** Durations in ms. Press and release are under 150ms; entrance is 440ms. */
export const DURATION = Object.freeze({
  press: 120,
  release: 180,
  hover: 240,
  hoverOut: 280,
  route: 320,
  entrance: 440,
})

/** Stagger between siblings: one step, at most 60ms (the rules' ceiling). */
export const STAGGER = Object.freeze({
  step: 40,
  max: 60,
})

/** The one entrance: rise, fade, and the same curve everywhere. */
export const ENTRANCE = Object.freeze({
  rise: 12,
  opacityFrom: 0,
  opacityTo: 1,
  maxDuration: 600,
})

/**
 * The one easing curve, in each engine's spelling.
 *
 * `css` is the canonical curve (ease-out, decelerating); `gsap` is the name of
 * the same decelerating family in GSAP core, because core has no plugin for a
 * literal cubic-bezier. Any new engine must map to `css`, not to a new curve.
 */
export const EASE = Object.freeze({
  css: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  gsap: 'power2.out',
})

/** The one hover lift, for a real mouse only. */
export const LIFT = Object.freeze({
  y: -3,
  rotation: 1.2,
  perspective: 900,
})

/** The one press. */
export const PRESS = Object.freeze({
  scale: 0.97,
})

/** The one focus ring. Violet is an indicator, never an ink. */
export const FOCUS = Object.freeze({
  color: '#8b5cf6',
  width: 2,
  offset: 2,
  /** Full-width rows keep the ring inside their own box. */
  rowOffset: -2,
})

/** The auto-advance chain: 3000ms, one step at a time, on capable tiers only. */
export const CYCLE = Object.freeze({
  ms: 3000,
  tiers: Object.freeze(['high', 'medium']),
})

/** A touch swipe needs this much horizontal travel, and must be flatter than tall. */
export const SWIPE = Object.freeze({
  min: 40,
})

/** The reduced-motion contract, as a value a test can assert. */
export const REDUCED_MOTION = Object.freeze({
  animation: 'none',
  transition: 'none',
  opacity: 1,
  transform: 'none',
})

/** Every tap target on a phone. */
export const TAP = Object.freeze({
  min: 44,
})

/**
 * The tokens as CSS custom properties, for the `:root` block in src/styles.css.
 * One entry per token, so the test can compare the two copies exactly.
 */
export const CSS_TOKENS = Object.freeze({
  '--motion-press': `${DURATION.press}ms`,
  '--motion-release': `${DURATION.release}ms`,
  '--motion-hover': `${DURATION.hover}ms`,
  '--motion-hover-out': `${DURATION.hoverOut}ms`,
  '--motion-route': `${DURATION.route}ms`,
  '--motion-entrance': `${DURATION.entrance}ms`,
  '--motion-stagger': `${STAGGER.step}ms`,
  '--motion-ease': EASE.css,
  '--motion-rise': `${ENTRANCE.rise}px`,
  '--motion-lift': `${LIFT.y}px`,
  '--motion-scale': String(PRESS.scale),
  '--motion-focus': FOCUS.color,
  '--motion-focus-width': `${FOCUS.width}px`,
  '--motion-focus-offset': `${FOCUS.offset}px`,
  '--motion-tap': `${TAP.min}px`,
})

export const MOTION = Object.freeze({
  duration: DURATION,
  stagger: STAGGER,
  entrance: ENTRANCE,
  ease: EASE,
  lift: LIFT,
  press: PRESS,
  focus: FOCUS,
  cycle: CYCLE,
  swipe: SWIPE,
  reducedMotion: REDUCED_MOTION,
  tap: TAP,
})
