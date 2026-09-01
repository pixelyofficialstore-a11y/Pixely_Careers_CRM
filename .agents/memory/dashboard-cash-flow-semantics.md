---
name: Dashboard cash flow semantics
description: Rules for presenting monthly cash movement separately from retained accounting balances.
---

Dashboard Cash Flow is a gross event-based view: include approved payment events in the reporting month, add the approved advance for direct-admin orders that have no payment event, and subtract refunds recorded in that month exactly once.

**Why:** Retained collected balance already deducts refunds through centralized accounting. Reusing it as cash inflow makes the dashboard understate gross receipts or deduct refunds twice.

**How to apply:** Keep Cash Inflow, Refunds, and Net Cash Flow as separate fields and presentation rows. Use `getOrderAccounting` for retained/receivable totals, not for gross cash-inflow reporting.