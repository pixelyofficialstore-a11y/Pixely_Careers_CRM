---
name: Railway stale source snapshots
description: How to recognize and recover when Railway deploys an older GitHub source archive.
---

When a Railway deployment log shows an earlier Dockerfile revision or an unexpectedly large old build context, treat the service's GitHub source snapshot as stale rather than repeatedly changing the image.

**Why:** GitHub commit statuses can be created for new commits even when Railway's service still builds an archived source snapshot; this makes valid Dockerfile fixes appear ineffective.

**How to apply:** Confirm the Dockerfile's unique build marker in the Railway log. If it is stale, reconnect the service to the intended repository and branch, apply the staged source change, then use Railway's “Deploy Latest Commit” action rather than redeploying the prior snapshot.