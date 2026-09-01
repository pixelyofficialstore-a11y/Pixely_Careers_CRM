---
name: Post-merge migrations
description: How the project's post-merge hook must invoke database migrations.
---

The post-merge hook must call the exported migration function through a dedicated CLI wrapper; importing the migration module alone exits successfully without applying anything.

**Why:** The migration module is intentionally reusable by application startup and does not execute work at import time. A shell command that only imports or runs that module can report success while skipping schema synchronization.

**How to apply:** Keep post-merge setup non-interactive and idempotent: install from the lockfile, run the migration wrapper, then build.