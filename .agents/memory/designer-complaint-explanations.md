---
name: Designer complaint explanations
description: Complaint responses from designers are one-time, assigned-designer-only records with optional evidence.
---

A complaint explanation belongs to the designer currently targeted by the complaint; it is recorded once with optional supporting images and an audit event.

**Why:** Allowing arbitrary users or repeated replacement responses would weaken complaint ownership and auditability.

**How to apply:** Authorize by complaintAgainstUserId on the server, keep closed cases read-only, notify management after recording, and expose the response through the existing complaint access projection.