---
name: Retired complaint targets
description: Retention and active-workflow rules for legacy client-target complaint records.
---

Legacy client-target complaint rows and their schema fields are retained for audit/history compatibility, but they are not supported active cases. New creation must be team-member-only, and active lists, counts, analytics, dashboards, case reports, unread notification counts, and mutations must exclude those rows.

**Why:** The feature was retired without permission to delete existing Supabase records or drop database columns, while stale client-target cases must not affect current service-quality workflows.

**How to apply:** Keep the legacy target columns and records untouched; enforce the supported target at API/storage boundaries and filter related notification records when calculating or displaying active notifications.