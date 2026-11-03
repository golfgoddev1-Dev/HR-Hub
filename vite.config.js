import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// Local development proxies /api to the API Worker (`wrangler dev`), so the
// browser exercises the same code that serves production. `npm run dev` starts
// the Worker and Vite together. Set VITE_API_TARGET to point the proxy
// somewhere else (for example another local Worker port).
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
    },
  },
})
