import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router.js'
import { verifySession } from './api.js'
import { clearAll } from './lib/data-cache.js'
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import { defaults, theme } from './theme.js'
import './styles.css'

const vuetify = createVuetify({ theme, defaults })
const app = createApp(App)

app.use(vuetify)
app.use(router)
app.mount('#app')

// A page restored from the back/forward cache does not re-run the router guard,
// so the session is checked again before any protected content is shown. A
// revoked session replaces the page instead of painting stale data.
window.addEventListener('pageshow', async (event) => {
  if (!event.persisted) return

  const session = await verifySession()
  if (session) return

  clearAll()
  window.location.replace('/login')
})

// The service worker only handles Web Push; it caches nothing. Registration is
// quiet on purpose: a failure (unsupported browser, insecure context) must not
// disturb normal use of the app.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
