---
name: Order PATCH role enforcement
description: How PATCH /api/orders/:id restricts sensitive fields by role in PixelCRM
---

# Order edit authorization (PATCH /api/orders/:id)

Rule: finance fields (`totalPrice`, `discountAmount`, `advanceAmount`, `remainingAmount`), `packageType`, service replacement (`services[]`), and `paymentStatus` are **admin-only** on the backend.
- **Designers**: constrained by a strict allowlist (`['status','paymentStatus']`) that 403s on any other key.
- **Support**: constrained by a **deny-list** — the listed sensitive fields are deleted from `updates` before applying. Support keeps status/assignment/notes edits.
- **Admin**: full edit; service replacement via `storage.replaceOrderServices`.

**Why:** Support historically had no field whitelist on PATCH (only ownership + assignment checks), so a crafted request could set finance/package/paymentStatus — a privilege-escalation hole flagged in code review. Deny-list was chosen over a support allowlist to avoid regressing support's existing status/assignment/notes flows (which have no dedicated edit UI to enumerate).

**How to apply:** When adding any new sensitive order column that admins edit, add it to the support deny-list too. When adding a new support edit capability, prefer widening the deny-list carefully rather than removing it.

# Finance recompute + paid transition
When admin edits finance, remaining is always recomputed server-side: `finalPayable = max(0, total - discount)`; `remaining = max(0, finalPayable - advance)`. If the same request also transitions pending→paid, collect the full newly-computed payable (`advance = finalPayable`, `remaining = 0`) — do NOT use the pre-edit paid-transition values, or total/advance become inconsistent. Amounts are PKR paisa (÷100 for rupees display).
