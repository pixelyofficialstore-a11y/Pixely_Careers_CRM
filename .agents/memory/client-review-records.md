---
name: Client reviews are records
description: Business rule for treating client reviews as received feedback rather than a workflow.
---

Client Reviews are consolidated records of feedback already received for an Order. They must not expose or require workflow stages, progress controls, progress bars, or progress timelines.

**Why:** Rating, feedback text, channels, evidence, permission, designer, Order, recorder, and dates are the useful business data. Progress stages incorrectly make a testimonial record look like a task-management process.

**How to apply:** Preserve the legacy progress column only for database compatibility. Do not advance it, accept it in Review APIs, include it in reports, generate progress activity, calculate metrics from it, or render it in Review interfaces.