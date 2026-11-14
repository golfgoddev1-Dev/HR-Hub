// The card stack: one timer chain, two pages.
//
// /leave and /hr both show a short deck of cards that advances every 3000ms on a
// capable device and waits for a hand everywhere else. The behaviour is
// identical, so it lives here once; each page keeps its own content, its own
// composition and its own labels.
//
// The contract (docs/ai/hr-hub-ui-motion.md section 3, plus the page rules the
// leave stack already shipped):
// - a chained `setTimeout`, never a `setInterval`: a pause drops the pending
//   step instead of letting it fire behind the pointer;
// - pause only for a real mouse (pointerType 'mouse'), never for the
//   synthesized mouseenter a touch tap leaves behind;
// - pause while the keyboard focus is inside the deck (`:focus-visible` only, so
//   a mouse click on the deck's own buttons does not freeze it);
// - pause while the tab is hidden, resume when it is visible again;
// - a lite device, a reduced-motion visitor and the low or static tier keep the
//   first card still and never start the chain;
// - a manual move restarts the full 3000ms;
// - destroy() clears the timer, the observers and the listeners: a route change
//   leaves nothing behind.
import { computed, ref, watch } from 'vue'
import { prefersReducedMotion } from './background-quality.js'
import { isLiteMode } from './lite-mode.js'
import { CYCLE, SWIPE } from './motion-tokens.js'

const FINE_POINTER = '(hover: hover) and (pointer: fine)'

export { SWIPE }

export function readTier() {
  if (typeof document === 'undefined') return 'high'
  return document.documentElement.getAttribute('data-bg-tier') || 'high'
}

export function pageIsVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

export function readFinePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia(FINE_POINTER).matches === true
  } catch {
    return false
  }
}

/** Keyboard focus only: a click that lands on one of the deck's buttons is not a pause. */
export function keyboardFocus(target) {
  try {
    return target?.matches?.(':focus-visible') === true
  } catch {
    return false
  }
}

/**
 * Create one stack controller.
 *
 * @param {object} options
 * @param {import('vue').Ref<Array>} options.items the cards, in order
 * @param {number} [options.cycleMs] the auto-advance step (tokens only)
 * @param {boolean} [options.requireFinePointer] the HR deck cycles on a mouse only
 * @param {number} [options.swipeMin] horizontal travel for a touch swipe
 * @param {(event: PointerEvent) => void} [options.onSwipeEnd] after a real swipe
 */
export function createCardStack(options = {}) {
  const items = options.items ?? ref([])
  const cycleMs = options.cycleMs ?? CYCLE.ms
  const requireFinePointer = options.requireFinePointer === true
  const swipeMin = options.swipeMin ?? SWIPE.min
  const onSwipeEnd = typeof options.onSwipeEnd === 'function' ? options.onSwipeEnd : null

  const index = ref(0)
  const hovered = ref(false)
  const focused = ref(false)
  /** The page's own pause control (the leave deck has one). */
  const paused = ref(false)
  const tier = ref(readTier())
  const finePointer = ref(readFinePointer())
  const canCycle = ref(false)

  let timer = null
  let observer = null
  let swipeStart = null
  let started = false

  const total = computed(() => (Array.isArray(items.value) ? items.value.length : 0))
  const canStep = computed(() => total.value > 1)
  const current = computed(() => items.value?.[index.value] ?? null)

  function tierAllowsCycle() {
    return CYCLE.tiers.includes(tier.value)
  }

  /** Whether the deck may cycle at all on this device, before pause state. */
  function isAllowed() {
    return (
      canStep.value &&
      !isLiteMode() &&
      !prefersReducedMotion() &&
      tierAllowsCycle() &&
      (!requireFinePointer || finePointer.value)
    )
  }

  /** Whether the chain should be running right now. */
  function isRunning() {
    return isAllowed() && !hovered.value && !focused.value && !paused.value && pageIsVisible()
  }

  function stop() {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  function scheduleNextStep() {
    if (timer !== null || !isRunning()) return
    timer = setTimeout(() => {
      timer = null
      if (!isRunning()) return
      advance(1)
      scheduleNextStep()
    }, cycleMs)
  }

  /** One place decides whether the stack auto-advances; every trigger calls it. */
  function sync() {
    canCycle.value = isAllowed()
    if (isRunning()) scheduleNextStep()
    else stop()
  }

  /** One card forward or back, wrapping at both ends, never restarting the chain. */
  function advance(delta) {
    if (total.value < 2) return
    index.value = (index.value + delta + total.value) % total.value
  }

  /** A manual move always restarts the full step and never touches `paused`. */
  function stepBy(delta) {
    advance(delta)
    stop()
    scheduleNextStep()
  }

  function next() {
    stepBy(1)
  }

  function previous() {
    stepBy(-1)
  }

  function goTo(value) {
    const target = Number(value)
    if (!Number.isFinite(target) || total.value === 0) return
    index.value = Math.min(Math.max(Math.trunc(target), 0), total.value - 1)
    stop()
    scheduleNextStep()
  }

  // Hover pauses only for a real mouse. A touch tap emits a synthesized
  // mouseenter with no matching mouseleave, and that used to latch the pause on
  // for good; pointer events carry the type, so a finger or a pen cannot pause.
  function onPointerEnter(event) {
    if (event?.pointerType && event.pointerType !== 'mouse') return
    hovered.value = true
  }

  function onPointerLeave(event) {
    if (event?.pointerType && event.pointerType !== 'mouse') return
    hovered.value = false
  }

  function onFocusIn(event) {
    if (keyboardFocus(event?.target)) focused.value = true
  }

  function onFocusOut() {
    focused.value = false
  }

  function onKeydown(event) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      stepBy(-1)
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      stepBy(1)
    }
  }

  // A touch drag on the card: horizontal travel wins only when it is both long
  // enough and flatter than it is tall, so a vertical page scroll is never eaten.
  function onPointerDown(event) {
    if (event?.pointerType === 'mouse') return
    if (event?.target?.closest?.('button')) return
    swipeStart = { x: event.clientX, y: event.clientY, id: event.pointerId }
  }

  function onPointerUp(event) {
    if (!swipeStart || event.pointerId !== swipeStart.id) return
    const dx = event.clientX - swipeStart.x
    const dy = event.clientY - swipeStart.y
    swipeStart = null
    if (Math.abs(dx) < swipeMin) return
    if (Math.abs(dx) <= Math.abs(dy)) return
    onSwipeEnd?.(event)
    stepBy(dx < 0 ? 1 : -1)
  }

  function onPointerCancel() {
    swipeStart = null
  }

  function onVisibilityChange() {
    sync()
  }

  watch(items, (list) => {
    if (index.value >= list.length) index.value = 0
    sync()
  })

  watch([hovered, focused, paused, tier, finePointer], sync)

  /** Start the chain and the listeners that pause it. Call from onMounted. */
  function start() {
    if (started) return
    started = true
    tier.value = readTier()
    finePointer.value = readFinePointer()
    sync()
    if (typeof document === 'undefined') return
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (typeof MutationObserver !== 'function') return
    observer = new MutationObserver(() => {
      tier.value = readTier()
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-bg-tier'],
    })
  }

  /** Clear the timer, the observer and every listener. Call from onBeforeUnmount. */
  function destroy() {
    started = false
    stop()
    observer?.disconnect()
    observer = null
    swipeStart = null
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }

  return {
    index,
    total,
    current,
    canStep,
    canCycle,
    hovered,
    focused,
    paused,
    tier,
    start,
    destroy,
    sync,
    next,
    previous,
    goTo,
    stepBy,
    handlers: {
      onPointerEnter,
      onPointerLeave,
      onFocusIn,
      onFocusOut,
      onKeydown,
      onPointerDown,
      onPointerUp,
      onPointerCancel,
    },
  }
}
