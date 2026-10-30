# Vuetify registration fix

## Changed lines (old → new)

`src/main.js`
- Old: `import { vuetify } from './theme.js'`
- New: `import { createVuetify } from 'vuetify'`; `import 'vuetify/styles'`; `import * as components from 'vuetify/components'`; `import * as directives from 'vuetify/directives'`; `import { defaults, theme } from './theme.js'`.
- Old: `createApp(App).use(vuetify).use(router).mount('#app')`
- New: `const vuetify = createVuetify({ components, directives, theme, defaults })`; `const app = createApp(App)`; `app.use(vuetify)`; `app.use(router)`; `app.mount('#app')`.

`src/theme.js`
- Old: `import { createVuetify } from 'vuetify'`; `import 'vuetify/styles'`; `export const vuetify = createVuetify({`; theme option began `theme: {`; defaults were inside the Vuetify options; file ended with `})`.
- New: removed the Vuetify import and stylesheet import from this module; changed `export const vuetify = createVuetify({` to `export const theme = {`; moved existing component defaults into `export const defaults = { ... }`; theme values and defaults are unchanged.

`src/App.vue`
- Old: `  <v-app>`, `    <RouterView />`, `  </v-app>`.
- New: `  <v-app>`, `    <v-main>`, `      <RouterView />`, `    </v-main>`, `  </v-app>`. 

`src/App.vue`
- Old: `<v-app><RouterView /></v-app>`.
- New: `<v-app><v-main><RouterView /></v-main></v-app>`.

LoginPage and LockoutDialog Vuetify component markup was inspected and left unchanged.

## Verification exit codes
- typecheck: 0
- test: 0
- build: 0

## Build output — last 10 lines
```text
+ ... $testCode}; & "C:\Program Files\nodejs\npm.cmd" run build > "reports\ ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: ([plugin builtin:vite-reporter] :String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: 
https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
```
