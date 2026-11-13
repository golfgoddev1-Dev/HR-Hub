<script setup>
// The app-wide decorative background on signed-in screens.
//
// It is mounted by src/components/AppLayout.vue only: employee, HR and admin
// pages get it, while /login, /set-pin, /change-pin, /pending, the public meeting
// registration page and the printed leave form never render that layout, so no
// canvas is ever created there. The same holds for the GSAP motion helpers, which
// are installed from here - so the anonymous pages get neither the scene nor the
// motion, and neither library is fetched for them.
//
// The layer is aria-hidden, fixed, pointer-events: none and painted at z-index 0
// under the content box, so it can never cover a link, a field or the dock.
//
// The 3D field itself is TresJS (see ./background/TresBackdrop.vue): this file owns
// the tier decision, the benchmark, the CSS tier flag and the fallback to the flat
// gradient. src/lib/background-quality.js stays the single source of truth for the
// budgets, and src/lib/background-scene.js for what is drawn.
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  QUALITY_TIERS,
  createBenchmark,
  deviceHints,
  initialTier,
  normalizedTier,
} from '../lib/background-quality.js'
import { fadeRoute, installUiMotion } from '../lib/motion.js'

// Loaded only for a tier that actually draws, so a reduced-motion or static visitor
// never downloads TresJS at all.
const TresBackdrop = defineAsyncComponent(() => import('./background/TresBackdrop.vue'))

// The root element is aria-hidden because the layer carries no information:
// every text node, button and leave row stays ordinary HTML on top of it.
const hints = deviceHints()
// Decided before the first paint, so a phone or a reduced-motion visitor never
// flashes a canvas.
const tier = ref(initialTier(hints))

// Undefined outside a router (unit tests mount this on its own).
const route = useRoute()

const config = computed(() => QUALITY_TIERS[tier.value])
const isStatic = computed(() => tier.value === 'static')
// TresJS clamps devicePixelRatio to this range; low drops below 1 on purpose.
const dpr = computed(() => {
  const cap = config.value.pixelRatioCap
  return cap < 1 ? [cap, cap] : [1, cap]
})

// The panels' frosting is CSS, so the tier is published on <html>: medium and low
// drop to an 8px blur (and lose tilt), static drops the blur entirely. Removing the
// attribute on unmount sends the panels back to the full-strength default, which is
// also what /login (no background at all) uses.
watch(
  tier,
  (value) => {
    if (typeof document === 'undefined') return
    document.documentElement.dataset.bgTier = value
  },
  { immediate: true }
)

let benchmark = null
let probeId = 0
let lastProbeAt = 0
let releaseMotion = () => {}

/**
 * The tier benchmark. It samples raw frame times on its own rAF for at most one
 * 60-frame window, so the tier's own frame cap can never flatter the measurement,
 * and it stops by itself: nothing keeps ticking after the verdict.
 */
function probe(now) {
  probeId = 0
  if (!benchmark || benchmark.done) return

  const delta = lastProbeAt > 0 ? now - lastProbeAt : 0
  lastProbeAt = now

  if (delta > 0) {
    const verdict = benchmark.push(delta)
    if (verdict.decided) {
      switchTo(verdict.tier)
      return
    }
    if (verdict.done) return
  }

  probeId = requestAnimationFrame(probe)
}

function startProbe() {
  if (probeId || !benchmark || benchmark.done) return
  lastProbeAt = 0
  probeId = requestAnimationFrame(probe)
}

function switchTo(name) {
  const next = normalizedTier(name)
  if (next === tier.value) return
  // The scene re-renders for the new budget; static unmounts the canvas entirely.
  tier.value = next
}

function fallbackToStatic() {
  if (probeId) cancelAnimationFrame(probeId)
  probeId = 0
  benchmark = null
  tier.value = 'static'
}

/** The route change: fade the new page in, once per navigation. */
async function onRouteChange() {
  await nextTick()
  const page =
    document.querySelector('.app-layout-inner > main') ||
    document.querySelector('.app-layout-inner > *:last-child')
  await fadeRoute(page)
}

onMounted(() => {
  benchmark = createBenchmark(tier.value, {
    coarsePointer: hints.coarsePointer,
    reducedMotion: hints.reducedMotion,
  })
  if (!isStatic.value) startProbe()

  // Interface motion (GSAP) is installed from the signed-in shell only, and only
  // after its lazy import resolves. A failure leaves a working, still page.
  installUiMotion().then((release) => {
    if (typeof release === 'function') releaseMotion = release
  })
  onRouteChange()
})

watch(() => route?.path, onRouteChange)

onBeforeUnmount(() => {
  if (probeId) cancelAnimationFrame(probeId)
  probeId = 0
  benchmark = null
  releaseMotion()
  releaseMotion = () => {}
  if (typeof document !== 'undefined') delete document.documentElement.dataset.bgTier
})
</script>

<template>
  <div
    class="app-background"
    :class="`app-background--${tier}`"
    :data-tier="tier"
    data-app-background
    aria-hidden="true"
  >
    <TresBackdrop v-if="!isStatic" :key="tier" :config="config" :dpr="dpr" @failed="fallbackToStatic" />
    <!-- A slow light sweep over the gradient. Purely CSS, transparent, and drawn
         under every panel; the static and reduced-motion tiers switch it off. -->
    <div class="app-background-sweep" aria-hidden="true"></div>
  </div>
</template>

<style scoped>
/* Fixed, full viewport, behind the content box (which is z-index 1 in the
   layout). pointer-events: none means even a stray click passes through. */
.app-background {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  /* Also the whole of the "static" tier: no canvas, just this indigo-to-violet
     field. It is the visible backdrop, so it is not toned down by a veil. */
  background:
    radial-gradient(115% 105% at 4% -6%, rgba(79, 70, 229, 0.95) 0%, rgba(79, 70, 229, 0) 56%),
    radial-gradient(120% 115% at 98% 104%, rgba(139, 92, 246, 0.9) 0%, rgba(139, 92, 246, 0) 58%),
    linear-gradient(135deg, #c7d2fe 0%, #e0e7ff 46%, #ddd6fe 100%);
}

.app-background-sweep {
  position: absolute;
  inset: -30%;
  pointer-events: none;
  background: conic-gradient(
    from 120deg at 50% 50%,
    rgba(255, 255, 255, 0) 0deg,
    rgba(255, 255, 255, 0.16) 60deg,
    rgba(255, 255, 255, 0) 140deg,
    rgba(199, 210, 254, 0.16) 220deg,
    rgba(255, 255, 255, 0) 320deg
  );
  mix-blend-mode: screen;
  will-change: transform;
  animation: background-sweep 26s linear infinite;
}

@keyframes background-sweep {
  from { transform: rotate(0turn) scale(1.05); }
  to { transform: rotate(1turn) scale(1.05); }
}

.app-background--static .app-background-sweep { display: none; }

@media (prefers-reduced-motion: reduce) {
  .app-background-sweep { animation: none; }
}
</style>
