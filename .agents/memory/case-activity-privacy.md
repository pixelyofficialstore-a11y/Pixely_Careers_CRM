---
name: Case activity privacy
description: Privacy rules shared by standalone case details, nested Order drawers, timelines, and case reports.
---

Case records must use the same role ownership checks whether opened standalone, through an Order, or through a report. Non-admin complaint timelines may retain auditable event types, but complaint actors and note values are private; suggestion Admin-note activity is omitted outside Admin.

**Why:** A Support user could receive an Admin note author through the Order activity and case-report timeline even though the canonical complaint history correctly redacted the same event.

**How to apply:** Route every new case entry point and timeline/export projection through the shared case access and activity projection policy rather than recreating role checks or redaction inline.