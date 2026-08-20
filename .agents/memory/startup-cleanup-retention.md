---
name: Startup cleanup retention
description: Startup runs a cleanup job that can delete historical notification and payment-verification rows.
---

Treat deletion of notification and payment-verification history as a data-retention policy that requires the owner's approval.

**Why:** Payment verifications feed cash-flow reporting, while the project requires existing CRM data to be preserved.

**How to apply:** Do not change cleanup or retention behavior without explicit approval. When working around startup or publishing issues, avoid triggering potentially destructive retention logic unnecessarily.