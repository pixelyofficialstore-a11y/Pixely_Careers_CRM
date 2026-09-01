import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell, ShoppingCart, CreditCard, User, UserCheck, UserX, CheckCheck, CheckCircle, XCircle, PackageCheck, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format, differenceInMinutes, isToday } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

interface Notification {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  priority: string;
  read: boolean;
  relatedId: number | null;
  relatedType: string | null;
  createdAt: string;
}

function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.55);
    setTimeout(() => ctx.close(), 1000);
  } catch (_) {}
}

async function subscribeToWebPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const keyRes = await fetch("/api/push/vapid-public-key");
    if (!keyRes.ok) return;
    const { publicKey } = await keyRes.json();
    const reg = await navigator.serviceWorker.ready;
    const existingSub = await reg.pushManager.getSubscription();
    if (existingSub) {
      await fetch("/api/push/subscribe", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(existingSub.toJSON()),
      });
      return;
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
  } catch (_) {}
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function notifIcon(type: string, priority: string, title: string) {
  const t = (title || "").toLowerCase();
  // Choose the most descriptive icon based on the event, falling back to the type.
  if (t.includes("rejected")) return XCircle;
  if (t.includes("delivered")) return PackageCheck;
  if (t.includes("approved")) return CheckCircle;
  if (t.includes("disabled")) return UserX;
  if (t.includes("enabled")) return UserCheck;
  if (t.includes("assigned")) return UserCheck;
  if (t.includes("remaining") || t.includes("verification")) return AlertTriangle;
  if (type === "order") return ShoppingCart;
  if (type === "payment") return CreditCard;
  if (type === "assignment") return UserCheck;
  if (type === "complaint") return AlertTriangle;
  if (type === "user") return User;
  return Bell;
}

function notifColor(type: string, priority: string, title: string) {
  const t = (title || "").toLowerCase();
  if (priority === "action_required") return "text-rose-300 bg-rose-500/10";
  if (priority === "confirmation" || t.includes("approved") || t.includes("delivered")) {
    return "text-emerald-300 bg-emerald-500/10";
  }
  if (type === "order") return "text-cyan-300 bg-cyan-500/10";
  if (type === "payment") return "text-amber-300 bg-amber-500/10";
  if (type === "assignment") return "text-slate-300 bg-slate-500/10";
  if (type === "complaint") return "text-rose-300 bg-rose-500/10";
  if (type === "user") return "text-cyan-300 bg-cyan-500/10";
  return "text-slate-400 bg-slate-500/10";
}

// Friendly relative time: "Just now", "5 minutes ago", "Today, 3:45 PM", or "Jul 04, 2026".
function formatNotifTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  const mins = differenceInMinutes(new Date(), date);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  if (isToday(date)) return `Today, ${format(date, "h:mm a")}`;
  return format(date, "MMM dd, yyyy");
}

interface NotificationBellProps {
  align?: 'left' | 'right' | 'sidebar';
}

export function NotificationBell({ align = 'right' }: NotificationBellProps = {}) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; left?: number; right?: number }>({ top: 0 });
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null);
  const prevCount = useRef<number>(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const firstLoad = useRef(true);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  useEffect(() => {
    function updatePermission() {
      if ("Notification" in window) {
        const perm = Notification.permission;
        setNotifPermission(perm);
        if (perm === "granted") {
          subscribeToWebPush().catch(() => {});
        }
      }
    }
    updatePermission();
    window.addEventListener('notificationPermissionChanged', updatePermission);
    window.addEventListener('focus', updatePermission);
    return () => {
      window.removeEventListener('notificationPermissionChanged', updatePermission);
      window.removeEventListener('focus', updatePermission);
    };
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const inButton = buttonRef.current?.contains(target);
      const inDropdown = dropdownRef.current?.contains(target);
      if (!inButton && !inDropdown) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // SSE: connect to server-sent events for instant notification delivery
  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnecting = false;

    function connect() {
      reconnecting = false;
      es = new EventSource("/api/notifications/stream", { withCredentials: true });

      es.onopen = () => {
        // Reconcile all server-owned counts after a reconnect so events missed
        // while the browser was offline do not leave stale badges behind.
        queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
        queryClient.invalidateQueries({ queryKey: ["/api/complaints/actionable-count"] });
        queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications/pending-count"] });
      };

      es.onmessage = (event) => {
        let payload: { event?: string; scopes?: string[] } = {};
        try { payload = JSON.parse(event.data); } catch (_) {}
        const scopes = payload.scopes || [];
        if (payload.event === "sync" && scopes.length) {
          if (scopes.includes("complaints")) queryClient.invalidateQueries({ queryKey: ["/api/complaints/actionable-count"] });
          if (scopes.includes("payments")) {
            queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications/pending-count"] });
            queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications"] });
          }
          if (scopes.includes("orders")) queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
          if (scopes.includes("stats")) queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
        }
        // Notification inserts and generic reconciliation both refresh the
        // server-owned bell state.
        queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      };

      es.onerror = () => {
        if (reconnecting) return;
        reconnecting = true;
        es?.close();
        es = null;
        // Reconnect after 5 s on error (guard ensures only one timer is active)
        if (retryTimeout) clearTimeout(retryTimeout);
        retryTimeout = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []);

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    retry: false,
  });

  const { data: notifsList = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    retry: false,
    enabled: open,
  });

  const markAllMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/notifications/mark-all-read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const markOneMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const unreadCount = unreadData?.count ?? 0;

  useEffect(() => {
    if (unreadData === undefined) return;
    if (firstLoad.current) {
      firstLoad.current = false;
      prevCount.current = unreadCount;
      return;
    }
    if (unreadCount > prevCount.current) {
      playNotificationSound();
      // The server is the single owner of browser push delivery. Fetch the
      // latest record only to show one in-app alert and refresh the open panel.
      fetch('/api/notifications', { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then((freshList: Notification[]) => {
          const newest = freshList.find(n => !n.read) ?? freshList[0];
          const notifTitle = newest?.title || "PixelCRM";
          const notifMsg = newest?.message ?? "You have a new notification";
          toast({ title: notifTitle, description: notifMsg });
          // Also update the React Query cache so the panel shows fresh data
          queryClient.setQueryData(["/api/notifications"], freshList);
        })
        .catch(() => {
          toast({ title: "PixelCRM", description: "You have a new notification" });
        });
    }
    prevCount.current = unreadCount;
  }, [unreadCount, unreadData]);

  const handleOpen = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      if (align === 'sidebar') {
        setDropPos({ top: rect.top, left: 264 });
      } else if (align === 'right') {
        setDropPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
      } else {
        setDropPos({ top: rect.bottom + 8, left: rect.left });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    }
    setOpen(o => !o);
  };

  const handleNotifClick = (notif: Notification) => {
    if (!notif.read) markOneMutation.mutate(notif.id);
    setOpen(false);
    if (notif.relatedType === "complaint" && notif.relatedId) {
      setLocation(`/complaints/${notif.relatedId}`);
    } else if (notif.relatedType === "payment_verification" && notif.relatedId) {
      setLocation(`/payments?payment=${notif.relatedId}`);
    } else if (notif.relatedType === "review" && notif.relatedId) {
      setLocation(`/feedback?review=${notif.relatedId}`);
    } else if (notif.relatedType === "suggestion" && notif.relatedId) {
      setLocation(`/feedback?suggestion=${notif.relatedId}`);
    } else if (notif.relatedType === "order" && notif.relatedId) {
      setLocation(`/orders?order=${notif.relatedId}`);
    } else {
      setLocation("/orders");
    }
  };

  const dropdownContent = open ? (
    <div
      ref={dropdownRef}
      style={{
        position: 'fixed',
        top: dropPos.top,
        ...(dropPos.left !== undefined ? { left: dropPos.left } : {}),
        ...(dropPos.right !== undefined ? { right: dropPos.right } : {}),
        zIndex: 9999,
        width: 340,
      }}
       className="bg-[hsl(var(--popover))] border border-border rounded-[.45rem] shadow-2xl shadow-slate-950/40 overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-cyan-300" />
           <span className="text-sm font-semibold text-slate-100">Notifications</span>
          {unreadCount > 0 && (
            <span className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              onClick={() => markAllMutation.mutate()}
              disabled={markAllMutation.isPending}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-800 transition-colors"
              title="Mark all as read"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              All read
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            className="text-slate-500 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {notifPermission === "denied" && (
        <div className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20">
          <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
          <p className="text-xs text-yellow-300">Enable notifications for real-time updates</p>
        </div>
      )}

      <div className="max-h-80 overflow-y-auto">
        {notifsList.length === 0 ? (
          <div className="py-10 text-center text-slate-500 text-sm">
            <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No notifications yet
          </div>
        ) : (
          notifsList.slice(0, 20).map((notif) => {
            const Icon = notifIcon(notif.type, notif.priority, notif.title);
            const colorCls = notifColor(notif.type, notif.priority, notif.title);
            const isActionRequired = notif.priority === "action_required";
            const isConfirmation = notif.priority === "confirmation";
            return (
              <div
                key={notif.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3 border-b border-slate-800/50 transition-colors cursor-pointer hover:bg-slate-800/40",
                  !notif.read && "bg-blue-500/5",
                  isActionRequired && !notif.read && "border-l-2 border-l-red-500",
                  isConfirmation && !notif.read && "border-l-2 border-l-green-500"
                )}
                onClick={() => handleNotifClick(notif)}
              >
                <div className={cn("p-1.5 rounded-lg flex-shrink-0 mt-0.5", colorCls)}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  {notif.title ? (
                    <p className={cn("text-xs font-semibold leading-snug", notif.read ? "text-slate-400" : "text-white")}>
                      {notif.title}
                    </p>
                  ) : null}
                  <p className={cn("text-xs leading-snug mt-0.5", notif.read ? "text-slate-500" : "text-slate-300")}>
                    {notif.message}
                  </p>
                  <p className="text-[10px] text-slate-600 mt-1">
                    {formatNotifTime(notif.createdAt)}
                  </p>
                </div>
                {!notif.read && (
                  <div className={cn(
                    "w-2 h-2 rounded-full flex-shrink-0 mt-1.5",
                    isActionRequired ? "bg-red-500" : isConfirmation ? "bg-green-500" : "bg-blue-500"
                  )} />
                )}
              </div>
            );
          })
        )}
      </div>

      {notifsList.length > 0 && (
        <div className="px-4 py-2 border-t border-slate-800 text-center">
          <p className="text-[10px] text-slate-600">Showing last {Math.min(notifsList.length, 20)} notifications</p>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        title="Notifications"
        data-testid="button-notification-bell"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full animate-pulse"
            data-testid="badge-notification-count"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {createPortal(dropdownContent, document.body)}
    </div>
  );
}
