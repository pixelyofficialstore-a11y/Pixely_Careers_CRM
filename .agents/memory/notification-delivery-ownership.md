---
name: Notification delivery ownership
description: Preventing duplicate browser notifications when realtime UI and web push are both enabled.
---

Browser push notifications must be sent by the server's Web Push delivery path only. The frontend may refresh the notification list and present a single in-app sound/toast, but must not ask the service worker to display the same notification again.

**Why:** A server push and a frontend service-worker message for one saved notification produce two identical operating-system notifications when VAPID is configured.

**How to apply:** Keep notification records and Web Push dispatch behind the backend notification wrapper. When changing the realtime client, use its SSE/polling updates only to refresh UI state and show the in-app alert. Notification dispatch is a best-effort side effect and must never make a committed business mutation return an error.