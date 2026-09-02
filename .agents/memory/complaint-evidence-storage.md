---
name: Complaint evidence storage
description: Complaint evidence supports multiple immutable image records while retaining legacy single-image compatibility.
---

Complaint evidence must use an additive child-record model for multiple images; keep the legacy single screenshot field readable for older records and APIs.

**Why:** A single URL cannot represent the requested five-image evidence limit, while rewriting legacy complaint rows would risk audit history.

**How to apply:** Add new evidence records transactionally with complaint creation, project legacy screenshot URLs as one evidence item when no child records exist, and preserve role-based case access.