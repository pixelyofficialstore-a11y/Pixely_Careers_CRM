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
