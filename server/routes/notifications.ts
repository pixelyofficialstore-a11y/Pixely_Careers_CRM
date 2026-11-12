/** Live stream (SSE), the notification list and web-push subscriptions. */
import type { Express } from "express";
import { storage } from "../storage";
import { api } from "@shared/routes";
import { type User } from "@shared/schema";
import { addSseClient, removeSseClient } from "../sse";
import { isValidPushEndpoint, requireAuth } from "./shared";

export function registerNotificationRoutes(app: Express) {
  // SSE stream: authenticated users connect here to receive real-time notification events
  app.get("/api/notifications/stream", requireAuth, (req: any, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const userId = (req.user as User).id;
    addSseClient(userId, res);

    // Send an initial heartbeat so the client knows the connection is live
    res.write(`: connected\n\n`);

    const keepAlive = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch (_) {
        clearInterval(keepAlive);
      }
    }, 25000);

    req.on("close", () => {
      clearInterval(keepAlive);
      removeSseClient(userId, res);
    });
  });
  app.get(api.notifications.list.path, requireAuth, async (req, res) => {
    // Paginated (newest 50 by default, ?before=<id> for older pages).
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const before = Number(req.query.before) || undefined;
    const notifs = await storage.getNotifications((req.user as User).id, limit, before);
    res.json(notifs);
  });

  app.get("/api/notifications/unread-count", requireAuth, async (req, res) => {
    const count = await storage.getUnreadNotificationCount((req.user as User).id);
    res.json({ count });
  });

  app.patch("/api/notifications/mark-all-read", requireAuth, async (req, res) => {
    await storage.markAllNotificationsRead((req.user as User).id);
    res.json({ success: true });
  });

  app.patch(api.notifications.markRead.path, requireAuth, async (req, res) => {
    const notif = await storage.markNotificationRead(Number(req.params.id), (req.user as User).id);
    if (!notif) return res.sendStatus(404);
    res.json(notif);
  });

  app.get("/api/push/vapid-public-key", (_req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) return res.status(503).json({ error: "Push not configured" });
    res.json({ publicKey: key });
  });

  app.post("/api/push/subscribe", requireAuth, async (req, res) => {
    const user = req.user as User;
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: "Invalid subscription" });
    }
    if (!isValidPushEndpoint(endpoint)) {
      return res.status(400).json({ error: "Endpoint must be an HTTPS push service URL" });
    }
    const sub = await storage.savePushSubscription(user.id, endpoint, keys.p256dh, keys.auth);
    res.status(201).json(sub);
  });

  app.delete("/api/push/unsubscribe", requireAuth, async (req, res) => {
    const { endpoint } = req.body;
    if (endpoint) await storage.deletePushSubscription(endpoint);
    res.json({ success: true });
  });
}
