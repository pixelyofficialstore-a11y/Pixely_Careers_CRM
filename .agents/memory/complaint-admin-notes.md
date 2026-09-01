---
name: Complaint admin notes
description: Durable privacy and history rules for internal complaint notes.
---

Complaint admin notes are append-only historical case records. Existing notes remain read-only, and each new note is stored as a separate entry with its author and timestamp. Legacy single-field text is migrated once with an explicitly unknown author rather than attributing it to an unverified user.

**Why:** Overwriting the old single note erased management history and could falsely attribute migrated text. Complaint records require an auditable note trail without exposing internal content.

**How to apply:** Any complaint-note UI or API must add a new note instead of updating or deleting an old one. Notes and note authors are Admin-only; Designer and Support responses must omit them server-side.