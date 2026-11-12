/** Live stream (SSE), the notification list and web-push subscriptions. */
import type { Express } from "express";
import { storage } from "../storage";
import { api } from "@shared/routes";
import { type User } from "@shared/schema";
import { addSseClient, removeSseClient } from "../sse";
import { isValidPushEndpoint, requireAuth, sendWebPushToUser } from "./shared";
import { z } from "zod";
import { categoriesForRole, isNotificationCategory } from "@shared/notification-events";
import { getNotificationPrefs, saveNotificationPrefs } from "../notificationPrefs";

/** Bell filter groups → notifications.type values. */
const TYPE_GROUPS: Record<string, string[]> = {
  orders: ["order", "assignment"],
  payments: ["payment", "refund"],
  website: ["website_request"],
  complaints: ["complaint"],
  feedback: ["review", "suggestion"],
  summary: ["summary"],
};

const prefsSchema = z.object({
  mutedEvents: z.array(z.string()).max(50),
  quietStart: z.number().int().min(0).max(1439).nullable(),
  quietEnd: z.number().int().min(0).max(1439).nullable(),
}).strict();

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
    // Last 30 days, unread first. ?offset= for infinite scroll, ?group= to filter.
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const types = TYPE_GROUPS[String(req.query.group || "")];
    const notifs = await storage.getNotifications((req.user as User).id, { limit, offset, types });
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

  // The browser unsubscribes itself (pushManager.unsubscribe). The server row is
  // NOT deleted here: the next push to it returns 404/410 and is then removed by
  // the one allowed automatic cleanup (expired subscriptions the app created).
  app.delete("/api/push/unsubscribe", requireAuth, async (_req, res) => {
    res.json({ success: true });
  });

  // Settings → Notifications (each user edits only their own settings).
  app.get("/api/notification-preferences", requireAuth, async (req, res) => {
    const user = req.user as User;
    const prefs = await getNotificationPrefs(user.id);
    const devices = (await storage.getPushSubscriptionsForUser(user.id)).length;
    res.json({ ...prefs, categories: categoriesForRole(user.role), devices, pushConfigured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) });
  });

  app.put("/api/notification-preferences", requireAuth, async (req, res) => {
    const parsed = prefsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid notification settings" });
    const { mutedEvents, quietStart, quietEnd } = parsed.data;
    if ((quietStart == null) !== (quietEnd == null)) return res.status(400).json({ error: "Set both quiet-hours times, or neither" });
    try {
      const prefs = await saveNotificationPrefs((req.user as User).id, {
        mutedEvents: mutedEvents.filter(isNotificationCategory),
        quietStart,
        quietEnd,
      });
      res.json(prefs);
    } catch (err: any) {
      if (/notification_preferences/.test(String(err?.message))) {
        return res.status(503).json({ error: "Notification settings are not available yet (database update pending)." });
      }
      throw err;
    }
  });

  // Sends a test push to every device of the current user (ignores quiet hours).
  app.post("/api/push/test", requireAuth, async (req, res) => {
    const user = req.user as User;
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return res.status(503).json({ error: "Push is not configured on the server (VAPID keys missing)." });
    }
    const devices = (await storage.getPushSubscriptionsForUser(user.id)).length;
    if (!devices) return res.status(409).json({ error: "This account has no device with push turned on. Enable notifications on this device first." });
    const delivered = await sendWebPushToUser(user.id, {
      title: "🔔 Test notification",
      body: `Push works on this device, ${user.name.split(" ")[0]}.`,
      priority: "update",
      url: "/settings/notifications",
      tag: "px-test",
    });
    res.json({ devices, delivered });
  });
}
