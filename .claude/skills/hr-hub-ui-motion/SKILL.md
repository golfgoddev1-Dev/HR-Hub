---
name: hr-hub-ui-motion
description: Use for any change to layout, styling, motion, glass panels, the 3D background, or responsive behaviour in src/pages, src/components, src/styles.css, src/lib/background-scene.js, src/lib/motion.js, or src/lib/background-quality.js.
---

# HR Hub UI, motion and 3D contract

This repository has one visual system: a live 3D field behind every signed-in
page, frosted glass panels on top of it, indigo/violet brand colour, and motion
that is calm, purposeful and optional. These rules describe what is already in
the code. They are not suggestions, and a change that cannot meet them has to be
raised with the user instead of worked around.

Files that own the system:

- `src/styles.css` — the app-wide glass recipe, its tint tokens and the CSS
  entrance animation.
- `src/lib/background-quality.js` — the quality tiers, the glass budget, the
  opening tier and the frame benchmark. Single source of truth.
- `src/lib/background-scene.js` — what the 3D field draws (cards, spheres,
  calendar cells, glints, dust), as plain data.
- `src/lib/motion.js` — the GSAP helpers (`countUp`, `fadeRoute`,
  `installUiMotion`). GSAP itself is imported lazily, one dynamic import.
- `src/components/AppBackground3D.vue` — mounts the scene, publishes the tier on
  `<html data-bg-tier>`, installs the UI motion and fades each route.
- `src/components/background/TresBackdrop.vue` — the TresJS renderer.

## 1. Glass panels

Panels are the only text surface. The 3D field is a backdrop, never a place for
letters.

**Tint.** Translucent white, inside **0.86 to 0.97**. The values in the tree
today:

- app-wide recipe in `src/styles.css`: `--glass-tint: rgba(255,255,255,0.95)`,
  `--glass-tint-strong: rgba(255,255,255,0.97)`; the static tier raises them
  (`0.97`, strong `0.98`), which only matters when there is no scene to frost;
- `src/lib/background-quality.js`: `GLASS.tintMin = 0.9`, `GLASS.tintMax = 0.98`,
  and `SURFACE_OPACITY = GLASS.tintMin` is the app-wide floor;
- a page that needs more of the field to read through may use page-level tokens
  down to **0.86** once the measured contrast below proves AA. Nothing in the
  tree sits below `GLASS.tintMin` (0.9) today, so a page that goes lower owns
  that measurement in its own tests and its report.

Never go below the band to make something look lighter, and never go to a
near-opaque white: "semi-transparent but readable" is the brief.

**Blur.** Exactly the tier's `glassBlur`: **18px at high, 8px at medium and low,
none at static**. The tier is published by `AppBackground3D.vue` as
`data-bg-tier` on `<html>`, so page tokens must follow it:

```css
:root { --page-glass-blur: 18px; --page-glass-filter: blur(var(--page-glass-blur)) saturate(1.1); }
:root[data-bg-tier='medium'], :root[data-bg-tier='low'] { --page-glass-blur: 8px; }
:root[data-bg-tier='static'] { --page-glass-filter: none; }
```

`GLASS.blurMin = 14` and `GLASS.blurMax = 20` bound future tweaks; do not invent
a per-page blur outside the tier. The tier tokens live in an unscoped style
block (`:root`) because Vue scoped CSS cannot match `<html>`.

**Contrast — WCAG AA against the worst case.** Every text and every icon on
glass must reach **4.5:1** (normal text) and **3:1** for large text and for UI
borders/control boundaries. Measure against the *rendered* worst-case background,
not against a nominal white:

1. Render the page at 390 and 1280 (Playwright, system Chrome) with the real 3D
   field behind it, and screenshot the viewport.
2. For each text block, take its box, apply a ring margin (inset past the border
   radius, and never wider than a quarter of the shorter side — a pill's 999px
   radius must not swallow the block) and mask every glyph box
   (`Range.getClientRects()` for text nodes, icon spans, images) plus any painted
   chip inside the block.
3. Sample the remaining pixels, convert to relative luminance, and take the
   **2nd percentile as the darkest** and the **98th percentile as the lightest**
   backdrop the block actually shows.
4. Check every ink in that block (computed `color`, including icon glyphs)
   against both extremes and keep the worse ratio. Text on its own opaque fill
   (a status badge, a chip, a filled button) is measured against that fill, not
   against the panel behind it.
5. Self-check the maths first with known pairs (`#000`/`#fff` = 21,
   `#475569`/`#fff` = 7.58, `#1E1B4B`/`#fff` = 15.99, `#fff`/`#4F46E5` = 6.29) so
   a broken formula cannot report optimistic numbers.

If a block fails: **darken that block's ink first** (a darker slate/indigo token),
then **raise the tint slightly** (still inside 0.86–0.97), then re-measure.
Report the token change old → new and the measured ratio. Never remove the glass,
never drop the blur, and never move the text off the panel to pass.

The violet focus ring (`#8B5CF6`, 2px, offset 2px) is about 3.2:1 against white,
so it is usable as a non-text indicator; keep it 2px and never use violet for
text.

## 2. Quality tiers

`src/lib/background-quality.js` is the only budget. Do not add objects,
particles, draw calls or shadow maps beyond it:

| tier | objects | cards | spheres | glints | calendar cells | particles | DPR | fps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| high | 120 | 60 | 14 | 6 | 40 | 260 | 1.5 | 60 |
| medium | 60 | 30 | 8 | 4 | 18 | 120 | 1.0 | 30 |
| low | 24 | 12 | 3 | 0 | 9 | 32 | 0.75 | 24 |
| static | 0 | 0 | 0 | 0 | 0 | 0 | 1 | — |

- No shadow maps and no post-processing at any tier: the background is a decal
  with nothing to receive a shadow.
- `scenePlan(config)` in `background-scene.js` is tested against the tier's
  counts; every new visual must fit an existing count or come out of one.
- Phones and weak devices default to medium or low: `initialTier()` returns
  medium for a coarse pointer, `deviceMemory <= 4` or `hardwareConcurrency <= 4`,
  and `static` for reduced motion. `src/lib/lite-mode.js` is the page-side twin:
  lite devices never create the HR leave WebGL scene.
- The benchmark (`createBenchmark`) samples 60 frames on its own rAF, drops a
  tier above 24ms, allows one raise below 14ms, and gives up on WebGL above
  40ms while already on low. Do not add a second measurement loop.
- Keep the tier flag, the benchmark and the reduced-motion behaviour unchanged
  unless the task is explicitly about them.

## 3. Motion

- **Transform and opacity only.** Never animate `width`, `height`, `top`,
  `left`, `right`, `bottom`, `margin`, `padding`, `gap` or `font-size` in a
  `transition`, `@keyframes` or GSAP tween. Hover/focus transitions may also
  carry `background-color`, `border-color`, `color`, `box-shadow` and
  `outline-color`, which paint without reflow.
- **Reuse `src/lib/motion.js` first.** `countUp(element, target)` for numbers,
  `fadeRoute(element)` for a route transition, `installUiMotion(root)` for
  delegated press feedback (`scale` 0.97 on pointerdown) and card lift on
  `.card`, `.summary-item`, `.push-card`, `.dock-tile`. Add a helper there only
  when nothing fits, and keep its contract: transform/opacity only, silent
  no-op when GSAP cannot load, final value painted when motion is off.
- GSAP is imported with one dynamic `import('gsap')` inside `motion.js`; never
  import it from a page or component, and never let the entry bundle grow by it.
  A page that wants `countUp` may `await import('../lib/motion.js')` on demand.
- **Reduced motion means no motion and the final state immediately.** Every
  transition and animation that carries meaning is switched off under
  `@media (prefers-reduced-motion: reduce)`; entrance end states become
  `opacity: 1; transform: none`; counts paint their final value; pointer tilt is
  disabled (`src/lib/lite-mode.js`). The CSS entrance in `src/styles.css` lives
  inside `@media (prefers-reduced-motion: no-preference)`.
- **Content must be visible with JavaScript off.** No base `opacity: 0` or
  `visibility: hidden`; hidden states belong only to `*-enter-from` /
  `*-leave-to` transition classes, and entrance animations use `backwards` fill.
- One animation per element: CSS owns hover/focus, GSAP owns press and route
  fades; do not double-animate the same node.
- Keep the rhythm the repo already uses: 0.12s press / 0.18s release, 0.24s
  and 0.28s hover lift, 0.32s route fade, `panel-rise` 0.44s with 0.04 / 0.08 /
  0.24s section delays, dock items at `40ms * i + 120ms`. Nothing loops behind
  text.

## 4. Touch and hover

- **Tap targets are at least 44 × 44px on phones.** `--tap-target: 44px` is the
  page token; apply it to buttons, links, date inputs, pager buttons, row
  actions and dialog controls. Vuetify's inner `input` is a focus proxy: set
  `min-height` on `.field :deep(.v-field)`, not on the proxy, and give a
  `clearable` select's clear button its own hit area.
- **Hover only for precise pointers.** Every `:hover` rule lives inside
  `@media (hover: hover) and (pointer: fine)`. The page source tests (for
  example `tests/hr-leave-3d.test.js`) assert that a page's first `:hover`
  comes after that query. Touch must never depend on hover to reach an action.
- Every action is a real `<button>`, `<a>` or input: no hover-only menus, no
  click handlers on decorative divs. Row-level actions stay reachable from the
  row button or from the detail dialog.
- Focus is visible everywhere: 2px `#8B5CF6` outline, `outline-offset: 2px`
  (inside the element with `-2px` for full-width rows).

## 5. Responsive

- Check **360, 390, 430, 768, 1024, 1280** for every layout change.
- **No horizontal scroll** at any width:
  `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`.
  Note `html { scrollbar-gutter: stable }` and that `window.innerWidth` can be
  ~15px wider than `clientWidth` on desktop; that difference is not a scrollbar
  bug.
- **No clipped text, no unreadable overlap.** Use `minmax(0, 1fr)` grid tracks,
  `min-width: 0` on flex/grid children and `overflow-wrap: anywhere` for long
  Thai names, request codes and date ranges. Nothing may slide under the fixed
  phone dock: the shell reserves `64px + env(safe-area-inset-bottom)`.
- The shell (`src/components/AppLayout.vue`) caps content at 1120px with 20px
  padding (14px phones) and switches its padding and dock at **720px**. The rest
  of the tree already uses 360, 420, 480, 560, 600, 640, 680, 767, 900, 960 and
  1024; reuse the breakpoints the page already has instead of adding a
  near-duplicate (no 1080 next to 1024, no 768 next to 767).
- Test the tablet width (768) as its own layout: two-column desktop
  compositions must have a defined stacked form there.

## 6. Line endings

- `.gitattributes` is `* text=auto eol=lf`. **Edit files as LF.** A Windows
  checkout may still hand back CRLF; do not "fix" that by rewriting unrelated
  files.
- **Tests must read project source through `tests/helpers/read-source.js`**
  (`readSource(path)`), never `readFileSync` directly, so a CRLF checkout cannot
  break a source assertion.
- Check what will actually be committed with `git ls-files --eol <path>`:
  `i/lf` is the blob in the index, `w/lf` or `w/crlf` is the working copy. A
  Windows editor or write tool can produce CRLF even here, so normalise the
  files you touched before staging:

  ```sh
  node -e "const fs=require('fs');for(const p of process.argv.slice(1)){fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/\\r\\n/g,'\\n'))}" src/pages/SomePage.vue
  ```

- A CRLF blob committed next to LF history rewrites the whole file as a diff and
  buries the real change, which is why the rule is about the file and not only
  about the test helper. Do not renormalise unrelated files in the same commit.

## 7. Dependencies

- Do not add a package without first running
  `npm view <pkg> version time --json` and confirming the version you intend to
  use is **at least 14 days old**.
- **Pin it exactly** (no `^`, no `~`) in `package.json`, and keep the lockfile
  consistent with `npm install`.
- Check `peerDependencies` against this project: Vue `^3.5.44`, Vuetify
  `^4.3.1`, Three.js `0.186.1`, Vite `^8.3.5`. A package that wants Vue 2, a
  different Vuetify major or a different Three version is not usable.
- Do not add Playwright as a dependency: browser checks use the installed
  Chrome via `executablePath`, and `playwright install` must never be run.
- Leave `worker/` dependencies alone when the task is front-end only.

## 8. Verification checklist for every UI change

Run all of these and report the numbers:

1. `node scripts/check-ui-skill.mjs` — this skill and the CLAUDE.md rule are
   intact.
2. Unit tests: contrast pairs (all ≥4.5:1 including the maths self-check) and the
   layout/motion rules (no animated layout property, reduced motion off, tap
   targets, hover media query). Then the **full suite**: the baseline count plus
   the new tests, **zero failures**.
3. `npm run build` succeeds. **Entry JS must stay at or below 113,404 B**; page
   work belongs in the page chunk, so report that chunk's size before and after.
   Run the build on the branch's own base, not on another branch's `dist/`.
4. Playwright screenshots at **390 and 1280** (and 768 when the layout changes)
   using the local Chrome:
   `chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })`.
   Never run `playwright install`.
5. Hit-test **every visible control** (`document.elementFromPoint` at its centre,
   skipping controls under the fixed dock) and check the 44px minimum at phone
   widths; confirm no horizontal scroll at the six widths in section 5.
6. **Zero console errors and zero page errors** on every run, including the
   dialog flow and the reduced-motion pass.
7. Exercise the real flows with the API stubbed (route-level `context.route`),
   and confirm request shapes did not change.
8. Report: **contrast ratios, tier used, and screenshot paths** for every UI
   change (plus any token change old → new with its measured ratio).

## 9. Design direction

- **Indigo is the primary:** `#4F46E5` (`--indigo-600`), darker `#4338CA`
  (`--indigo-700`), ink `#1E1B4B` (`--indigo-900`), wash `#EEF2FF`
  (`--indigo-50`).
- **Violet is the accent:** `#8B5CF6`, decorative and focus rings only. At
  4.23:1 on white it is **never** text.
- **Slate is the neutral:** `#F8FAFC`, `#F1F5F9`, `#E2E8F0` for surfaces and
  borders, `#475569` for secondary text, `#334155` for stronger body text.
- **Status colours are semantic and never repurposed:** pending amber
  `#FFF2DF` / `#8A4B06`, approved green `#E6F4EC` / `#1C6B3F`, rejected red
  `#FDECEC` / `#A01B1B`, cancelled grey `#F1F1F1` / `#6A6A6A`. Each pair is AA
  on its own fill; cancelled is the tightest at 4.79:1, so do not lighten it.
- Typography: `Prompt` for headings and buttons, `Sarabun` for body copy,
  `IBM Plex Sans`/`IBM Plex Sans Thai` where the app already uses them, and a
  monospace stack for request codes. Loaded once from `index.html`.
- **Each page is designed for its own layout.** Do not apply one generic card
  template to every screen: a dashboard, an inbox-style HR console and a public
  form need different compositions. Design *to* the 3D field: panels frosted,
  the field visible around and through them, the field never carrying text.
- Decorative layers are `aria-hidden` and carry no information.

## 10. Do not change without explicit approval

- **API calls and request shapes** — URLs, query strings, methods, bodies,
  headers, `credentials`.
- **Approve/reject logic** and any decision rule, including the local
  approval-count patching in `src/lib/shared-data.js`.
- **Roles and route access** — `src/lib/route-access.js`, role guards, what a
  role may open.
- **Routes** — paths, names, nesting, lazy imports, print routes.
- **The Vuetify layer-order line in `index.html`**
  (`@layer vuetify-core, vuetify-components, ...`). Component CSS depends on it.
- **The Google Fonts link and its `icon_names` list** in `index.html`. A name
  outside that list renders as plain text; `tests/asset-allowlists.test.js`
  checks all 61 names. Adding an icon means adding it to that list deliberately,
  not replacing the list.
- Background tiers, the benchmark thresholds, and reduced-motion behaviour.
- Data shape, filters and their behaviour, and the leave retention rules.

If a request conflicts with any rule above, **stop and ask** — do not work around
it, do not weaken a test, and do not remove the glass, the motion guard or a tier
budget to make the change fit.
