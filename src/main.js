import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router.js'
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { defaults, theme } from './theme.js'
import './styles.css'

const vuetify = createVuetify({ components, directives, theme, defaults })
const app = createApp(App)

app.use(vuetify)
app.use(router)
app.mount('#app')

// The service worker only handles Web Push; it caches nothing. Registration is
// quiet on purpose: a failure (unsupported browser, insecure context) must not
// disturb normal use of the app.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
