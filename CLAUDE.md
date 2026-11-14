# HR Hub — agent rules

## 1. UI and motion work: read both design documents first

Before you change any file under src/pages, src/components, src/styles.css, src/lib/background-scene.js, src/lib/motion.js, or src/lib/background-quality.js, you MUST read docs/ai/hr-hub-ui-motion.md AND docs/ai/frontend-design.md and follow every rule in both. In your report, state which rules you checked. If a requested change conflicts with a rule, stop and ask instead of working around it.

Report contrast ratios, tier used, and screenshot paths for every UI change.

The same documents are loaded through the Claude skills `.claude/skills/hr-hub-ui-motion/` and `.claude/skills/hr-hub-frontend-design/`. This rule is enforced: `node scripts/check-ui-skill.mjs` and `tests/ui-skill.test.js` fail when it, either document, or the skill's ten sections is missing.
