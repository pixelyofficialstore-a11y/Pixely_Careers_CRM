import type { Response } from "express";

const clients = new Map<number, Set<Response>>();

export function addSseClient(userId: number, res: Response) {
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  clients.get(userId)!.add(res);
}

export function removeSseClient(userId: number, res: Response) {
  const set = clients.get(userId);
  if (set) {
    set.delete(res);
    if (set.size === 0) clients.delete(userId);
  }
}

export function hasSseClient(userId: number): boolean {
  const set = clients.get(userId);
  return Boolean(set && set.size > 0);
}

export function emitNotification(userId: number, data: Record<string, unknown>) {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch (_) {
      set.delete(res);
    }
  }
}

export function emitRealtime(userId: number, scopes: string[]) {
  emitNotification(userId, { event: "sync", scopes });
}

// Broadcast a data-free "something changed" event to every connected CRM tab.
// Bursts (e.g. an order + its services + a payment) are merged into one event
// per 400 ms. Each client then refetches only what it is allowed to see.
let pendingScopes = new Set<string>();
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
export function broadcastRealtime(scopes: string[]) {
  scopes.forEach(s => pendingScopes.add(s));
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    const payload = { event: "sync", scopes: Array.from(pendingScopes) };
    pendingScopes = new Set();
    broadcastTimer = null;
    clients.forEach((_set, userId) => emitNotification(userId, payload));
  }, 400);
  broadcastTimer.unref?.();
}

/** Which live-update scopes a successful write to an API path affects. */
export function scopesForPath(path: string): string[] {
  if (/^\/api\/orders\/\d+\/refunds/.test(path) || path.startsWith("/api/refunds")) return ["refunds", "orders", "stats"];
  if (/^\/api\/(orders|order-services)(\/|$)/.test(path)) return ["orders", "stats"];
  if (path.startsWith("/api/payment-verifications")) return ["payments", "orders", "stats"];
  if (path.startsWith("/api/complaints")) return ["complaints", "stats"];
  if (path.startsWith("/api/website-requests")) return ["website_requests", "orders", "stats"];
  if (path.startsWith("/api/feedback")) return ["feedback", "stats"];
  return [];
}
