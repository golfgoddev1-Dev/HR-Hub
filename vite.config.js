import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The default API target is the Express dev server. Set VITE_API_TARGET to
// point the proxy at the Worker (for example http://localhost:8787) when
// testing routes that only exist in worker/src.
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3001'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
    },
  },
})
