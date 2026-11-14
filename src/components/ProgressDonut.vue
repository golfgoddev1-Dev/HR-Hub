<script setup>
// One percentage, one ring, one label beside it.
//
// The ring is drawn once with a conic gradient (a paint, not an animation). The
// motion is a rotating marker and a fade of the ring: `transform` and `opacity`
// only, so nothing here can start a layout or a paint every frame — no
// stroke-dashoffset, no width, no height, no clip angle tween.
//
// The number is the label's text, so it is readable in any state: the ring is
// decoration (`aria-hidden`), and the percentage and its caption are real text
// that a screen reader reads once.
//
// This is a primitive, not a page element: it does not read the network and it
// does not know what the percentage means. Its caller supplies the value and the
// caption.
import { computed } from 'vue'

const props = defineProps({
  /** 0–100. Anything outside the range is clamped. */
  value: { type: Number, default: 0 },
  /** The caption beside the number, e.g. "ใช้ไปแล้ว". */
  label: { type: String, default: '' },
  /** Ring diameter in px; the type beside it stays on the page's own scale. */
  size: { type: Number, default: 56 },
})

const percent = computed(() => {
  const value = Number(props.value)
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(Math.round(value), 0), 100)
})

// The marker travels clockwise from the top; 3.6° per percent, rounded to a
// tenth so the value never carries floating-point noise into the style attribute.
const angle = computed(() => `${Math.round(percent.value * 36) / 10}deg`)
</script>

<template>
  <div class="donut-row">
    <div
      class="donut"
      aria-hidden="true"
      :style="{ '--donut-size': `${size}px`, '--donut-pct': percent, '--donut-angle': angle }"
    >
      <span class="donut-ring"></span>
      <span class="donut-marker"></span>
      <span class="donut-hole"></span>
    </div>
    <div class="donut-copy">
      <p class="donut-value">{{ percent }}%</p>
      <p v-if="label" class="donut-label">{{ label }}</p>
    </div>
  </div>
</template>

<style scoped>
.donut-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.donut {
  position: relative;
  flex: 0 0 auto;
  width: var(--donut-size);
  height: var(--donut-size);
}

/* The arc itself: painted once at the final percentage. */
.donut-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(
    var(--donut-accent, #4f46e5) calc(var(--donut-pct) * 1%),
    var(--donut-track, #e2e8f0) 0
  );
  opacity: 1;
}

.donut-hole {
  position: absolute;
  inset: 9px;
  border-radius: 50%;
  background: var(--donut-hole, rgba(255, 255, 255, 0.92));
}

/* The only moving part: a dot that rotates into place. Transform only. */
.donut-marker {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  transform: rotate(var(--donut-angle));
  transform-origin: 50% 50%;
  transition: transform var(--motion-entrance, 440ms) var(--motion-ease, cubic-bezier(0.22, 0.61, 0.36, 1));
}

.donut-marker::after {
  content: '';
  position: absolute;
  top: -2px;
  left: 50%;
  width: 6px;
  height: 6px;
  margin-left: -3px;
  border-radius: 50%;
  background: var(--donut-accent, #4f46e5);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9);
}

.donut-copy {
  min-width: 0;
}

.donut-value {
  margin: 0;
  font-family: 'IBM Plex Sans Thai', 'Sarabun', sans-serif;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  color: var(--donut-ink, #1e1b4b);
}

.donut-label {
  margin: 2px 0 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--donut-muted, #475569);
}

/* Reduced motion: the ring is already at its final percentage, the marker at its
   final angle, and nothing transitions. */
@media (prefers-reduced-motion: reduce) {
  .donut-marker {
    transition: none;
  }
}
</style>
