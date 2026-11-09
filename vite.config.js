import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { defineConfig } from 'vite'

// Local development proxies /api to the API Worker (`wrangler dev`), so the
// browser exercises the same code that serves production. `npm run dev` starts
// the Worker and Vite together. Set VITE_API_TARGET to point the proxy
// somewhere else (for example another local Worker port).
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  // Vitest covers the browser-side tests in tests/. The Worker tests under
  // worker/tests are node:test files with their own runner (`cd worker && npm test`),
  // so they are deliberately out of scope here.
  test: {
    include: ['tests/**/*.test.js'],
    server: { deps: { inline: ['vuetify'] } },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
    },
  },
})
