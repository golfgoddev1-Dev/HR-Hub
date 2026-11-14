# HR Hub — agent rules

## 1. UI and motion work: load the skill first

Before you change any file under src/pages, src/components, src/styles.css, src/lib/background-scene.js, src/lib/motion.js, or src/lib/background-quality.js, you MUST load the skill `hr-hub-ui-motion` (.claude/skills/hr-hub-ui-motion/SKILL.md) and follow every rule in it. In your report, state which rules you checked. If a requested change conflicts with a rule, stop and ask instead of working around it.

Report contrast ratios, tier used, and screenshot paths for every UI change.

This rule is enforced: `node scripts/check-ui-skill.mjs` and `tests/ui-skill.test.js` fail when this section or the skill's ten sections are missing.
