/**
 * One live-update connection (SSE) per tab.
 *
 * The server sends small "sync" events with scopes (orders, payments, …) when
 * data changes, and "notification" events for the bell. Each scope invalidates
 * the matching TanStack caches, so pages refetch only what changed.
 *
 * No polling while connected. If the stream is down, a 60 s fallback refresh
 * of the badge counts runs, and only while the tab is visible.
 */
import { useEffect, useRef } from "react";
import { queryClient } from "./queryClient";

export type RealtimePayload = {
  event?: string;
  scopes?: string[];
  [key: string]: unknown;
};

type Listener = (payload: RealtimePayload) => void;
const listeners = new Set<Listener>();

const startsWith = (prefix: string) => ({
  predicate: (q: { queryKey: readonly unknown[] }) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith(prefix),
});

function refreshCounts() {
  queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
  queryClient.invalidateQueries({ queryKey: ["/api/complaints/actionable-count"] });
  queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications/pending-count"] });
  queryClient.invalidateQueries({ queryKey: ["/api/website-requests/counts"] });
}

function applyScopes(scopes: string[]) {
  if (scopes.includes("complaints")) queryClient.invalidateQueries(startsWith("/api/complaints"));
  if (scopes.includes("payments")) queryClient.invalidateQueries(startsWith("/api/payment-verifications"));
  if (scopes.includes("orders")) {
    queryClient.invalidateQueries(startsWith("/api/orders"));
    queryClient.invalidateQueries(startsWith("/api/analytics"));
  }
  if (scopes.includes("stats")) {
    queryClient.invalidateQueries(startsWith("/api/stats"));
    queryClient.invalidateQueries(startsWith("/api/metrics"));
  }
  if (scopes.includes("feedback")) queryClient.invalidateQueries(startsWith("/api/feedback"));
  if (scopes.includes("website_requests")) queryClient.invalidateQueries(startsWith("/api/website-requests"));
}

let source: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let fallbackTimer: ReturnType<typeof setInterval> | null = null;
let connected = false;
let users = 0;

function connect() {
  source = new EventSource("/api/notifications/stream", { withCredentials: true });
  source.onopen = () => {
    connected = true;
    // Catch up on anything missed while disconnected.
    refreshCounts();
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  };
  source.onmessage = event => {
    let payload: RealtimePayload = {};
    try { payload = JSON.parse(event.data); } catch { return; }
    applyScopes(payload.scopes || []);
    queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    listeners.forEach(fn => fn(payload));
  };
  source.onerror = () => {
    connected = false;
    source?.close();
    source = null;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { retryTimer = null; if (users > 0) connect(); }, 5_000);
  };
}

function start() {
  if (users++ > 0) return;
  connect();
  fallbackTimer = setInterval(() => {
    if (!connected && document.visibilityState === "visible") refreshCounts();
  }, 60_000);
}

function stop() {
  if (--users > 0) return;
  source?.close();
  source = null;
  connected = false;
  if (retryTimer) clearTimeout(retryTimer);
  if (fallbackTimer) clearInterval(fallbackTimer);
  retryTimer = fallbackTimer = null;
}

/** Keep the live connection open while a signed-in component is mounted. */
export function useRealtime(enabled: boolean, onEvent?: Listener) {
  useEffect(() => {
    if (!enabled) return;
    start();
    return stop;
  }, [enabled]);
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    const fn: Listener = payload => handler.current?.(payload);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
}
