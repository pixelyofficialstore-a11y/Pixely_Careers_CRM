import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { Bell, ShoppingCart, CreditCard, User, UserCheck, UserX, CheckCheck, CheckCircle, XCircle, PackageCheck, AlertTriangle, MessageSquare, Lightbulb, X, Settings2, BarChart3, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format, differenceInMinutes, isToday } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useRealtime } from "@/lib/realtime";
import { useAuth } from "@/hooks/use-auth";
import { setAppBadge, syncPushSubscription } from "@/lib/push";

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

interface IncomingNotification {
  event?: string;
  id?: number;
  eventType?: string;
  type?: string;
  title?: string;
  message?: string;
  priority?: string;
  scopes?: string[];
  sound?: boolean;
  alert?: boolean;
  url?: string;
  tag?: string;
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

function notifIcon(type: string, _priority: string, title: string) {
  const t = (title || "").toLowerCase();
  // Choose the most descriptive icon based on the event, falling back to the type.
  if (t.includes("rejected") || t.includes("not approved")) return XCircle;
  if (t.includes("delivered")) return PackageCheck;
  if (t.includes("approved") || t.includes("confirmed")) return CheckCircle;
  if (t.includes("disabled")) return UserX;
  if (t.includes("enabled")) return UserCheck;
  if (t.includes("assigned")) return UserCheck;
  if (t.includes("overdue") || t.includes("due today") || t.includes("verify")) return AlertTriangle;
  if (type === "order") return ShoppingCart;
  if (type === "payment") return CreditCard;
  if (type === "assignment") return UserCheck;
  if (type === "complaint") return AlertTriangle;
  if (type === "review") return MessageSquare;
  if (type === "suggestion") return Lightbulb;
  if (type === "summary") return BarChart3;
  if (type === "website_request") return Globe;
  if (type === "user") return User;
  return Bell;
}

function notifColor(type: string, priority: string, title: string) {
  const t = (title || "").toLowerCase();
  if (type === "complaint") return "text-rose-300 bg-rose-500/10";
  if (type === "payment") return "text-emerald-300 bg-emerald-500/10";
  if (type === "review") return "text-blue-300 bg-blue-500/10";
  if (type === "suggestion") return "text-purple-300 bg-purple-500/10";
  if (priority === "action_required") return "text-rose-300 bg-rose-500/10";
  if (priority === "confirmation" || t.includes("approved") || t.includes("delivered")) {
    return "text-emerald-300 bg-emerald-500/10";
  }
  if (type === "order") return "text-cyan-300 bg-cyan-500/10";
  if (type === "assignment") return "text-slate-300 bg-slate-500/10";
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

/** Same mapping as the server's notificationUrl() (push click-through). */
function notificationHref(n: { relatedType: string | null; relatedId: number | null }): string {
  if (n.relatedType === "complaint" && n.relatedId) return `/complaints/${n.relatedId}`;
  if (n.relatedType === "payment_verification" && n.relatedId) return `/payments?payment=${n.relatedId}`;
  if (n.relatedType === "review" && n.relatedId) return `/feedback?review=${n.relatedId}`;
  if (n.relatedType === "suggestion" && n.relatedId) return `/feedback?suggestion=${n.relatedId}`;
  if (n.relatedType === "order" && n.relatedId) return `/orders?order=${n.relatedId}`;
  if (n.relatedType === "website_request") return "/website-requests";
  if (n.relatedType === "dashboard") return "/";
  return "/orders";
}

// Module scope: several bells can be mounted (sidebar + mobile top bar);
// each live event is toasted / sounded once.
const seenNotificationIds = new Set<number>();

const PAGE = 30;
const FILTERS: { key: string; label: string; roles?: string[] }[] = [
  { key: "", label: "All" },
  { key: "orders", label: "Orders" },
  { key: "payments", label: "Payments", roles: ["admin", "support"] },
  { key: "website", label: "Website", roles: ["admin", "support"] },
  { key: "complaints", label: "Complaints" },
  { key: "feedback", label: "Feedback" },
];

interface NotificationBellProps {
  align?: 'left' | 'right' | 'sidebar';
}

export function NotificationBell({ align = 'right' }: NotificationBellProps = {}) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState("");
  const [dropPos, setDropPos] = useState<{ top: number; left?: number; right?: number }>({ top: 0 });
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasPushRef = useRef(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    function updatePermission() {
      if ("Notification" in window) {
        const perm = Notification.permission;
        setNotifPermission(perm);
        if (perm === "granted") {
          // Keeps the server's copy of this device's subscription current.
          syncPushSubscription().then(ok => { hasPushRef.current = ok; }).catch(() => {});
        }
      }
    }
    updatePermission();
    window.addEventListener("notificationPermissionChanged", updatePermission);
    return () => window.removeEventListener("notificationPermissionChanged", updatePermission);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const inButton = buttonRef.current?.contains(target);
      const inDropdown = dropdownRef.current?.contains(target);
      if (!inButton && !inDropdown) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Live updates: one shared SSE connection (client/src/lib/realtime.ts)
  // refreshes caches; this handler only shows the toast / sound / OS alert.
  useRealtime(Boolean(user), (payload) => {
    const p = payload as IncomingNotification;
    if (p.event !== "notification" || typeof p.id !== "number") return;
    if (seenNotificationIds.has(p.id)) return;
    seenNotificationIds.add(p.id);
    if (seenNotificationIds.size > 500) {
      const oldest = seenNotificationIds.values().next().value;
      if (typeof oldest === "number") seenNotificationIds.delete(oldest);
    }
    const title = p.title || "Pixely";
    const message = p.message || "You have a new notification";
    toast({ title, description: message });
    // Tab in the background on a device without push: show the OS alert from here.
    // (With push, the service worker shows it; the shared tag prevents doubles.)
    if (p.alert !== false && document.visibilityState === "hidden" && !hasPushRef.current
      && "Notification" in window && Notification.permission === "granted") {
      navigator.serviceWorker?.ready.then(reg => reg.active?.postMessage({
        type: "SHOW_NOTIFICATION", title, body: message, priority: p.priority, url: p.url, tag: p.tag,
      })).catch(() => {});
    }
    // The server decides (event matrix + mute + quiet hours).
    if (p.sound) playNotificationSound();
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    retry: false,
  });

  const list = useInfiniteQuery<Notification[]>({
    queryKey: ["/api/notifications", "list", group],
    enabled: open,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(pageParam) });
      if (group) params.set("group", group);
      const res = await fetch(`/api/notifications?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load notifications");
      return res.json();
    },
    getNextPageParam: (last, pages) => (last.length < PAGE ? undefined : pages.length * PAGE),
  });
  const notifsList = list.data?.pages.flat() ?? [];

  // Infinite scroll: load the next page when the bottom comes into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!open || !el) return;
    const io = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
    }, { root: el.parentElement, rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [open, list.hasNextPage, list.isFetchingNextPage, notifsList.length]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  };

  const markAllMutation = useMutation({
    mutationFn: async () => { await apiRequest("PATCH", "/api/notifications/mark-all-read"); },
    onSuccess: invalidate,
  });

  const markOneMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("PATCH", `/api/notifications/${id}/read`); },
    onSuccess: invalidate,
  });

  const unreadCount = unreadData?.count ?? 0;
  const badgeText = unreadCount > 99 ? "99+" : String(unreadCount);
  useEffect(() => { setAppBadge(unreadCount); }, [unreadCount]);

  const panelWidth = () => Math.min(380, window.innerWidth - 16);

  const handleOpen = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      if (window.innerWidth < 640) {
        setDropPos({ top: rect.bottom + 8, left: 8 });
      } else if (align === "sidebar") {
        setDropPos({ top: rect.top, left: 264 });
      } else if (align === "right") {
        setDropPos({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
      } else {
        setDropPos({ top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - panelWidth() - 8) });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    }
    setOpen(o => !o);
  };

  const goToSettings = () => {
    setOpen(false);
    setLocation("/settings/notifications");
  };

  const handleNotifClick = (notif: Notification) => {
    if (!notif.read) markOneMutation.mutate(notif.id);
    setOpen(false);
    setLocation(notificationHref(notif));
  };

  const filters = FILTERS.filter(f => !f.roles || (user && f.roles.includes(user.role)));

  const dropdownContent = open ? (
    <div
      ref={dropdownRef}
      style={{
        position: "fixed",
        top: dropPos.top,
        ...(dropPos.left !== undefined ? { left: dropPos.left } : {}),
        ...(dropPos.right !== undefined ? { right: dropPos.right } : {}),
        zIndex: 9999,
        width: panelWidth(),
      }}
      className="bg-[hsl(var(--popover))] border border-border rounded-[.45rem] shadow-2xl shadow-slate-950/40 overflow-hidden"
      role="dialog"
      aria-label="Notifications"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-cyan-300" />
          <span className="text-sm font-semibold text-slate-100">Notifications</span>
          {unreadCount > 0 && (
            <span className="text-xs bg-red-500 text-on-color px-1.5 py-0.5 rounded-full font-bold">{badgeText}</span>
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
              Mark all read
            </button>
          )}
          <button
            onClick={goToSettings}
            className="text-slate-500 hover:text-white p-1.5 rounded hover:bg-slate-800 transition-colors"
            title="Notification settings"
            aria-label="Notification settings"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="text-slate-500 hover:text-white p-1.5 rounded hover:bg-slate-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto px-3 py-2 border-b border-slate-800/70 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {filters.map(f => (
          <button
            key={f.key || "all"}
            onClick={() => setGroup(f.key)}
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
              group === f.key ? "bg-cyan-400/15 text-cyan-200" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {notifPermission !== null && notifPermission !== "granted" && (
        <button
          onClick={goToSettings}
          className="flex w-full items-center gap-2 px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20 text-left"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
          <span className="text-xs text-yellow-300">Turn on phone &amp; desktop alerts →</span>
        </button>
      )}

      <div className="max-h-[min(26rem,70vh)] overflow-y-auto">
        {list.isLoading ? (
          <div className="py-10 text-center text-slate-500 text-sm">Loading…</div>
        ) : notifsList.length === 0 ? (
          <div className="py-10 text-center text-slate-500 text-sm">
            <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No notifications in the last 30 days
          </div>
        ) : (
          notifsList.map((notif) => {
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
                  isConfirmation && !notif.read && "border-l-2 border-l-green-500",
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
                  <p className={cn("text-xs leading-snug mt-0.5 break-words", notif.read ? "text-slate-500" : "text-slate-300")}>
                    {notif.message}
                  </p>
                  <p className="text-[10px] text-slate-600 mt-1">{formatNotifTime(notif.createdAt)}</p>
                </div>
                {!notif.read && <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5 bg-blue-500" />}
              </div>
            );
          })
        )}
        <div ref={sentinelRef} className="h-1" />
        {list.isFetchingNextPage && <div className="py-3 text-center text-[11px] text-slate-500">Loading more…</div>}
      </div>
    </div>
  ) : null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className="relative flex items-center justify-center w-10 h-10 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        title="Notifications"
        aria-label={unreadCount ? `Notifications, ${badgeText} unread` : "Notifications"}
        data-testid="button-notification-bell"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-red-500 text-on-color text-[10px] font-bold rounded-full"
            data-testid="badge-notification-count"
          >
            {badgeText}
          </span>
        )}
      </button>
      {createPortal(dropdownContent, document.body)}
    </div>
  );
}
