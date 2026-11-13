// A count-up for numbers the page already shows (leave totals and the like).
//
// The displayed value only ever steps through numbers that are smaller than the
// target, and the element it feeds keeps its own layout: the page reserves the
// same line height, so nothing moves while the number climbs. Reduced motion
// lands on the final value immediately, and a component that unmounts mid-count
// cancels its frame.
//
// It lives in its own module so the pages that use it (all lazy chunks) pay for
// it, never the entry bundle.
import { onBeforeUnmount, ref, watch } from 'vue'

const DURATION_MS = 700

function reducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
}

/**
 * @param {import('vue').Ref<number|string>|number} target the true value
 * @returns {import('vue').Ref<number>} the value to render, counting up to it
 */
export function useCountUp(target) {
  const read = () => {
    const raw = typeof target === 'object' && target !== null ? target.value : target
    const number = Number(raw)
    return Number.isFinite(number) ? number : 0
  }

  const shown = ref(0)
  let frameId = 0
  let from = 0
  let startedAt = 0

  function stop() {
    if (frameId) cancelAnimationFrame(frameId)
    frameId = 0
  }

  function run() {
    stop()
    const to = read()
    if (reducedMotion() || typeof requestAnimationFrame !== 'function' || to === from) {
      from = to
      shown.value = to
      return
    }

    startedAt = 0
    const start = from
    const step = (now) => {
      if (!startedAt) startedAt = now
      const progress = Math.min(1, (now - startedAt) / DURATION_MS)
      // Ease-out cubic: fast at first, settles on the target.
      const eased = 1 - (1 - progress) ** 3
      shown.value = Math.round(start + (to - start) * eased)
      if (progress < 1) {
        frameId = requestAnimationFrame(step)
        return
      }
      shown.value = to
      from = to
      frameId = 0
    }
    frameId = requestAnimationFrame(step)
  }

  watch(read, run, { immediate: true })
  onBeforeUnmount(stop)

  return shown
}
