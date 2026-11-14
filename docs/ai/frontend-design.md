# HR Hub — frontend design

This is the design intent for the product. The implementation contract — glass
tokens, contrast method, tier budgets, motion rules, verification steps — is
`docs/ai/hr-hub-ui-motion.md`; read the two together. Where they overlap, the
implementation contract wins and this document explains why it exists.

## A. Visual direction

HR Hub is a place people open on a workday to handle leave and people data. It
should feel professional, calm and current — closer to a well-made product than
to an admin panel.

- **Each page gets its own composition, designed around the 3D background.** The
  field is the room; panels are furniture placed in it. A console page, a
  landing page, a form and a print view do not share one card template.
- **Avoid the generic admin-template look:** rows of equal boxes, default grey
  surfaces, heavy borders around everything, a heading followed by four
  identical cards.
- **Build hierarchy with size, weight and space**, not with borders and boxes.
  One clear page title, then sections that read in order.
- **Be generous with spacing.** A calm page has room around its groups; a dense
  one earns its density with alignment, not with smaller type.
- **One strong accent colour:** indigo `#4F46E5`. Violet `#8B5CF6` is
  decoration only — glows, focus rings, gradients — never text.
- The glass is part of the look: panels are frosted so the field stays visible
  around and through them. A solid white page on top of a 3D background is a
  bug, not a style.

## B. Typography

Use the font stack already loaded once in `index.html`:

- `Prompt` — headings and buttons (500/600/700);
- `Sarabun` — Thai body copy (400/500/600/700);
- `IBM Plex Sans` / `IBM Plex Sans Thai` — figures, codes and dense tables;
- `Material Symbols Outlined` — icons, only names in the `icon_names` allowlist
  (61 names today). A name outside it renders as literal text.

Scale — one size per role, and no more than three heading sizes on a page:

| role | size | notes |
| --- | --- | --- |
| page title (`h1`) | 28–32px, weight 600 | one per page |
| section title (`h2`) | 18–20px, weight 600 | groups inside the page |
| body | 16px, line-height 1.55 | **never below 16px on phones** |
| caption / meta | 13px minimum | secondary only, still AA |

- Body copy never goes below 16px on phones, and no text in the product goes
  below 13px.
- Headings use line-height ~1.15, body ~1.55; a text column stops around 68
  characters.
- Never set body text in a colour that fails section C, and never in violet.

## C. Colour tokens and contrast

Put the page's palette on its own root as CSS custom properties, so the glass
tier can change the surface underneath without touching every rule:

```css
.page {
  --ink: #1e1b4b;
  --ink-body: #334155;
  --ink-muted: #475569;
  --accent: #4f46e5;
  --accent-ink: #ffffff;
  --focus: #8b5cf6;
  --surface: rgba(255, 255, 255, 0.95);
  --line: rgba(30, 27, 75, 0.16);
}
```

- **Every text and icon pair meets WCAG AA against its worst-case background**,
  measured on rendered pixels — not against nominal white. The method (ring
  margin, glyph masking, 2nd/98th percentile luminance, 4.5:1 for text, 3:1 for
  large text and UI borders) is `docs/ai/hr-hub-ui-motion.md` section 1. Follow
  it literally and report the ratios.
- **Semantic status colours stay semantic:**
  - approved — green fill `#E6F4EC`, ink `#1C6B3F`;
  - pending — amber fill `#FFF2DF`, ink `#8A4B06`;
  - rejected — red fill `#FDECEC`, ink `#A01B1B`;
  - cancelled — grey fill `#F1F1F1`, ink `#6A6A6A` (4.79:1; do not lighten it).
- **Never use violet for text.** `#8B5CF6` is about 4.23:1 on white, so it is a
  focus ring and a glow, not an ink.
- Indigo carries primary actions and selected state. Status colours are never
  reused for branding, and indigo is never used to mean "approved".
- Borders and control outlines need 3:1 against what is behind them; the
  Vuetify field border is a real boundary, not decoration.

## D. Layout and composition

- Work on a visible grid. The shell caps content at 1120px with 20px padding
  (14px on phones); a page may be narrower, never wider.
- **Desktop may use a two-column console** — filters in a 280–320px rail on the
  left, the working area on the right — when the page is a working surface
  (queues, lists, settings). Reading pages stay single-column.
- **Phones stack vertically in reading order**, with 44px tap targets and no
  control that needs a hover to be found. Tables become cards; dialogs become
  full-screen sheets.
- **Use a spacing scale — 4, 8, 12, 16, 24, 32px — not random values.** 4: icon
  to label. 8: inline gaps. 12: control padding. 16: card padding. 24: between
  groups. 32: between page sections. No 13/19/27px one-offs.
- One left edge per column; align labels, values and actions to it. Do not nest
  cards inside cards more than one level deep.
- The active filter state must be visible without hovering, and the primary
  action of a region sits at its top-right or its foot, not in two places.

## E. Motion design

Motion exists to explain, not to entertain.

- **Entrances are short: under 600ms** (the shell's `panel-rise` is 0.44s) and
  **staggered at most 60ms between items** (the dock uses 40ms steps).
- **Hover and press feedback is immediate: under 150ms** (press is 0.12s).
- Ease-out for entrances, ease-in-out for state changes.
- **Transform and opacity only.** Never animate width, height, top, left,
  margin, padding or font-size.
- **Reduced motion means no motion and the final state immediately** — counts
  painted, cards at rest, no stagger.
- No motion that blocks a click or delays content beyond the entrance duration.
  Nothing loops behind dense data.

## F. 3D and WebGL

- **Only through the existing tier system in `src/lib/background-quality.js`.**
  The tiers own object counts, particles, DPR, frame rate and glass blur; do not
  add objects, particles, shadows or post-processing outside them.
- **Keep Three.js and TresJS lazy-loaded.** The scene is a dynamic import
  (`defineAsyncComponent` in the shell); it must never enter the entry chunk.
- **Scenes are decorative:** `aria-hidden`, `pointer-events: none`, no text
  inside the scene, and no information that exists only in 3D.
- **Never render WebGL on `/login` or public pages.** The 3D background is
  mounted by the signed-in shell (`src/components/AppLayout.vue`); public pages
  use CSS gradients and glows.
- **Dispose everything on unmount:** geometries, materials, textures, the
  renderer, animation frames and listeners. A route change must not leak a WebGL
  context.

## G. Performance budget

- **The entry JS must not grow beyond its current size on `main` (113,404 B).**
  Measure the build before and after, and report both.
- **New animation code goes into lazy chunks.** `src/lib/motion.js` imports GSAP
  with a dynamic import; pages that need a helper load `motion.js` the same way.
  Nothing animation-related enters the entry graph.
- **Report entry JS and the changed chunk sizes for every UI change** — page
  chunk JS and CSS included, plus any token change and its measured ratio.
- Icons stay inside the allowlist, fonts are already loaded once, and no page
  adds a request for images it could draw in CSS.
- Keep per-frame work on the compositor: transform and opacity, no layout reads
  in a scroll or resize handler.

## H. Anti-patterns to avoid

- A full-page translucent white overlay that hides the 3D background.
- Text placed directly on a moving canvas.
- Animating layout properties (width, height, top, left, margin, padding).
- Hover-only controls, or any action a finger cannot reach.
- More than two accent colours on one screen.
- Decorative motion that loops on a page with dense data.
- Adding a third-party UI kit, icon set or animation library without approval.
- Equal boxes in a grid as the answer to every page.
- Opaque white cards that make the scene pointless.
- Status colours reused for branding, or brand colour used for a status.
