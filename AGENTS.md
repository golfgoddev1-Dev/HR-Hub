# HR Hub — agent rules

## 1. UI and motion work: read both design documents first

Before changing any file under src/pages, src/components, src/styles.css, src/lib/background-scene.js, src/lib/motion.js, src/lib/background-quality.js, src/lib/lite-mode.js, or src/lib/dock-entrance.js, you MUST read docs/ai/hr-hub-ui-motion.md AND docs/ai/frontend-design.md and follow every rule in both. In your final report, list which sections you checked. If a requested change conflicts with a rule, stop and ask instead of working around it.

Report contrast ratios, tier used, and screenshot paths for every UI change.

The documents are loaded through the wrappers `.claude/skills/hr-hub-ui-motion/` and `.claude/skills/hr-hub-frontend-design/`. This rule is enforced: `npm run check:ui-skill` (or `node scripts/check-ui-skill.mjs`) and `tests/ui-skill.test.js` fail when it, either document, or either wrapper is missing or damaged.
