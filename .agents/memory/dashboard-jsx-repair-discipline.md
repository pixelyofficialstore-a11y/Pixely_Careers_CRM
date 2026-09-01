---
name: Dashboard JSX repair discipline
description: A safe editing constraint for the dashboard's mixed wrapper structure.
---

When repairing dashboard JSX, patch a uniquely identified block rather than replacing generic closing tags. The dashboard contains several similar metric grids whose wrappers intentionally use different element types, so a broad replacement can fix one mismatch while corrupting another.

**Why:** A refactor introduced mismatched closing tags in multiple dashboard role blocks, and generic substitutions changed unrelated cash-flow and admin wrappers before the build exposed it.

**How to apply:** Use surrounding component or heading text as patch context, then run `npm run build` immediately before making additional dashboard edits.