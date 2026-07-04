---
name: Vite HMR periodic refresh in Replit dev preview
description: Why the PixelCRM dev preview appears to full-refresh periodically, and what does/doesn't fix it
---

# Symptom
User reports the app "refreshes after some time" in the Replit preview. Browser console shows:
`[vite] server connection lost. Polling for restart...` -> `[vite] connecting...` -> `[vite] connected.`

# Root cause
It is a DEV-PREVIEW-ONLY artifact of Vite HMR, not an app bug. Verified: no app code triggers periodic reload (Sidebar `window.location.reload()` fires only on avatar upload; polling refetchIntervals only fetch data; `client/public/sw.js` has no controllerchange/reload). When the Vite dev-server connection drops, Vite's HMR client full-reloads the page on reconnect. Those drops come from workflow restarts (e.g. while editing) and transient Replit proxy websocket blips. Idle for ~95s with no restarts = NO drops, NO reloads (empirically confirmed).
Production is unaffected: the built app uses `serveStatic` (server/vite.ts is dev-only), so there is no HMR websocket and no auto-reload in the published deployment.

# Do NOT do this (proven wrong)
Setting `hmr.clientPort: 443` in `server/vite.ts` serverOptions BREAKS HMR entirely: in middleware mode Vite cannot infer the public host, so the client tries `ws://localhost:443/vite-hmr` -> `net::ERR_CONNECTION_REFUSED`. The default (no clientPort) lets @vite/client infer host/protocol/port from the page `location`, which correctly yields `wss://<proxy-domain>/vite-hmr` and connects.
**Why:** this app runs Vite in middleware mode via `server/vite.ts`, which OVERWRITES `viteConfig.server`, so editing the `server` block in `vite.config.ts` has no effect anyway.

# Practical guidance
There is no clean Vite config to keep HMR yet suppress the reload-on-reconnect. For daily use the reliable answer is the published/deployed app (no HMR, never refreshes). Leave the working default HMR config in place; do not add clientPort/host overrides in middleware mode.
