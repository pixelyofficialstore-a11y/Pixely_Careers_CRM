---
name: Order PATCH role enforcement
description: How PATCH /api/orders/:id restricts sensitive fields by role in PixelCRM
---

# Order edit authorization (PATCH /api/orders/:id)

Rule: all order details are **admin-only** on the backend.
- **Designers**: constrained to an assigned order's production `status` only; every other field, including payment status and services, 403s.
- **Support**: constrained to a strict operational allowlist (`status`, `assignedToId`). They cannot cancel or change any client, package, service, pricing, payment, or notes field.
- **Admin**: full edit, cancellation, and service replacement via `storage.replaceOrderServices`.

**Why:** Support should create and monitor orders, not alter their commercial or client details. A strict allowlist prevents crafted PATCH requests from bypassing the hidden UI, while preserving designated-designer assignment and operational progress updates.

**How to apply:** New order-detail columns default to admin-only. If a support operational action is genuinely needed, explicitly add only that field to the support allowlist and ensure it cannot cancel an order.

# Finance recompute + paid transition
When an admin edits finance, remaining is always recomputed server-side: `finalPayable = max(0, total - discount)`; `remaining = max(0, finalPayable - advance)`. If the same request also transitions pending→paid, collect the full newly-computed payable (`advance = finalPayable`, `remaining = 0`) — do NOT use the pre-edit paid-transition values, or total/advance become inconsistent. Amounts are PKR paisa (÷100 for rupees display).
