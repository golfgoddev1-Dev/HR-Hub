<script setup>
// The 3D field, drawn with TresJS components.
//
// TresJS owns the renderer, the scene graph, the camera bookkeeping, the resize
// path and the render loop; this file owns only the content: what is drawn and how
// it moves. All of that content comes from src/lib/background-scene.js, and every
// budget comes from src/lib/background-quality.js, so nothing here decides how much
// may be drawn.
//
// Disposal: TresCanvas disposes on unmount. Its renderer manager calls
// renderer.dispose() and forceContextLoss(), and disposeObject3D() walks the scene
// and releases every geometry and material, so the GPU memory goes with it. The
// only things this component adds are listeners, removed in onBeforeUnmount.
import { TresCanvas } from '@tresjs/core'
import TresBackdropScene from './TresBackdropScene.vue'

defineProps({
  // The tier config from src/lib/background-quality.js.
  config: { type: Object, required: true },
  // The device pixel ratio range, clamped by the tier's pixelRatioCap.
  dpr: { type: [Number, Array], default: 1 },
})

const emit = defineEmits(['failed'])
</script>

<template>
  <TresCanvas
    class="app-background-tres"
    :alpha="true"
    :clear-alpha="0"
    :antialias="config.material !== 'basic'"
    :dpr="dpr"
    :shadows="false"
    :fps-limit="config.targetFps"
    power-preference="low-power"
    :preserve-drawing-buffer="false"
    window-size
    @error="emit('failed')"
  >
    <TresBackdropScene :config="config" />
  </TresCanvas>
</template>

<style scoped>
/* The canvas is a full-screen decal: fixed, click-through, and never in front of
   the content box (the layout keeps z-index 1 there).

   !important on pointer-events: TresJS hands its canvas pointer-events so its
   raycaster can hear clicks. This layer is decoration, and a full-screen canvas
   that eats touch gestures would cost the page its scroll, so it stays
   click-through. The class lands on the canvas element itself. */
.app-background-tres {
  position: fixed !important;
  inset: 0;
  z-index: 0;
  display: block;
  width: 100% !important;
  height: 100% !important;
  pointer-events: none !important;
  background: transparent;
}
</style>
