---
name: User response sanitization
description: Security boundary for user records returned by CRM APIs.
---

Full User records are server-internal authentication data. Every API response must explicitly project a safe user shape, including nested assignees, actors, creators, reviewers, and payment users.

**Why:** Password hashes were exposed not only by the users endpoint, but also indirectly through nested order and related-record objects. Fixing one endpoint is insufficient when storage objects carry full users.

**How to apply:** Keep password-bearing records inside authentication and storage code. Before serializing any direct or nested user, pass it through the centralized safe-user or summary projection and verify fresh server logs contain no password field.