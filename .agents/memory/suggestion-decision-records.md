---
name: Suggestion decisions and notes
description: Durable rules for Suggestion outcomes, evidence, private notes, and history.
---

Suggestions move once from New to either Implemented or Rejected. Implementation requires a written summary; rejection requires a written reason. Final decisions are read-only records with their actor and timestamp.

**Why:** A Suggestion is a management improvement record, not a multi-stage workflow. Future readers need to understand the final outcome and rationale without editable historical fields.

**How to apply:** Keep the only final actions as Implement or Reject. Store optional implementation evidence through Cloudinary. Admin notes are separate append-only records, never an editable blob, and must be removed server-side for Designer and Support responses. Note history must not expose note text.