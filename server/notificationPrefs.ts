/**
 * Phase 3: per-user notification settings (Settings → Notifications).
 * No row = defaults. Reads are cached briefly; a missing table (migration 0003
 * not applied yet) falls back to defaults so notifications never break.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { notificationPreferences } from "@shared/schema";
import { isNotificationCategory, isWithinQuietHours, type NotificationCategory } from "@shared/notification-events";

export type NotificationPrefs = { mutedEvents: NotificationCategory[]; quietStart: number | null; quietEnd: number | null };

export const DEFAULT_PREFS: NotificationPrefs = { mutedEvents: [], quietStart: null, quietEnd: null };

const TTL_MS = 60_000;
const cache = new Map<number, { at: number; prefs: NotificationPrefs }>();

export async function getNotificationPrefs(userId: number): Promise<NotificationPrefs> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.prefs;
  let prefs = DEFAULT_PREFS;
  try {
    const [row] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1);
    if (row) {
      prefs = {
        mutedEvents: (row.mutedEvents || []).filter(isNotificationCategory),
        quietStart: row.quietStart ?? null,
        quietEnd: row.quietEnd ?? null,
      };
    }
  } catch (err: any) {
    if (!/notification_preferences/.test(String(err?.message))) console.error("[notification-prefs] read failed:", err?.message || err);
  }
  cache.set(userId, { at: Date.now(), prefs });
  return prefs;
}

/** Creates or updates the user's OWN settings row (never deletes). */
export async function saveNotificationPrefs(userId: number, prefs: NotificationPrefs): Promise<NotificationPrefs> {
  const values = {
    userId,
    mutedEvents: Array.from(new Set(prefs.mutedEvents.filter(isNotificationCategory))),
    quietStart: prefs.quietStart,
    quietEnd: prefs.quietEnd,
  };
  await db.insert(notificationPreferences).values(values).onConflictDoUpdate({
    target: notificationPreferences.userId,
    set: { mutedEvents: values.mutedEvents, quietStart: values.quietStart, quietEnd: values.quietEnd, updatedAt: sql`now()` },
  });
  cache.delete(userId);
  return getNotificationPrefs(userId);
}

/** Should this category alert (push + sound) right now for these settings? */
export function shouldAlert(prefs: NotificationPrefs, category: NotificationCategory, now = new Date()): boolean {
  if (prefs.mutedEvents.includes(category)) return false;
  return !isWithinQuietHours(prefs.quietStart, prefs.quietEnd, now);
}
