/**
 * Web push on this device: permission, subscription, and keeping the server's
 * copy in sync. The global fetch wrapper (lib/http.ts) adds the CSRF header.
 */

export type PushState = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  isIOS: boolean;
  standalone: boolean;
  /** iOS only supports push for an app added to the Home Screen (iOS 16.4+). */
  needsHomeScreen: boolean;
};

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

const pushApisPresent = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function getPushState(): Promise<PushState> {
  const ios = isIOS();
  const standalone = isStandalone();
  if (!pushApisPresent()) {
    return { supported: false, permission: "unsupported", subscribed: false, isIOS: ios, standalone, needsHomeScreen: ios && !standalone };
  }
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    subscribed = Boolean(await reg?.pushManager.getSubscription());
  } catch (_) {}
  return { supported: true, permission: Notification.permission, subscribed, isIOS: ios, standalone, needsHomeScreen: false };
}

async function sendToServer(sub: PushSubscription) {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  if (!res.ok) throw new Error("The server did not accept this device.");
}

/** Subscribe (or re-send the existing subscription). Needs permission already granted. */
export async function syncPushSubscription(): Promise<boolean> {
  if (!pushApisPresent() || Notification.permission !== "granted") return false;
  const keyRes = await fetch("/api/push/vapid-public-key");
  if (!keyRes.ok) return false; // push not configured on the server
  const { publicKey } = await keyRes.json();
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource });
  }
  await sendToServer(sub);
  return true;
}

/** Ask for permission (must run from a click) and subscribe this device. */
export async function enablePush(): Promise<{ ok: boolean; message?: string }> {
  if (isIOS() && !isStandalone()) {
    return { ok: false, message: "On iPhone, first add Pixely to your Home Screen (Share → Add to Home Screen), then open it from there." };
  }
  if (!pushApisPresent()) return { ok: false, message: "This browser does not support push notifications." };
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  window.dispatchEvent(new CustomEvent("notificationPermissionChanged"));
  if (permission !== "granted") {
    return { ok: false, message: "Notifications are blocked for this site. Allow them in the browser's site settings, then try again." };
  }
  try {
    const ok = await syncPushSubscription();
    return ok ? { ok: true } : { ok: false, message: "Push is not configured on the server yet." };
  } catch (err: any) {
    return { ok: false, message: err?.message || "Could not turn on push for this device." };
  }
}

/** Stop push on this device only (the browser drops the subscription). */
export async function disablePushOnThisDevice(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
}

/** Home-screen icon badge (where supported). */
export function setAppBadge(count: number) {
  const nav = navigator as any;
  try {
    if (count > 0) nav.setAppBadge?.(count);
    else nav.clearAppBadge?.();
  } catch (_) {}
}
