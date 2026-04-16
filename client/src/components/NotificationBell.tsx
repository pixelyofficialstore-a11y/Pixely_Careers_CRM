import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell, ShoppingCart, CreditCard, User, CheckCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";

interface Notification {
  id: number;
  userId: number;
  type: string;
  message: string;
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

function showBrowserNotification(title: string, body: string) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico", tag: "pixelcrm-notification" });
  } catch (_) {}
}

function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

function notifIcon(type: string) {
  if (type === "order") return ShoppingCart;
  if (type === "payment") return CreditCard;
  if (type === "assignment") return User;
  return Bell;
}

function notifColor(type: string) {
  if (type === "order") return "text-blue-400 bg-blue-500/10";
  if (type === "payment") return "text-yellow-400 bg-yellow-500/10";
  if (type === "assignment") return "text-purple-400 bg-purple-500/10";
  return "text-slate-400 bg-slate-500/10";
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const prevCount = useRef<number>(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const firstLoad = useRef(true);

  useEffect(() => {
    requestNotificationPermission();
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    refetchInterval: 15000,
    retry: false,
  });

  const { data: notifsList = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    refetchInterval: open ? 15000 : 60000,
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

  const unreadCount = unreadData?.count || 0;

  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      prevCount.current = unreadCount;
      return;
    }
    if (unreadCount > prevCount.current) {
      playNotificationSound();
      const newNotifications = notifsList.filter(n => !n.read);
      const newest = newNotifications[0];
      if (newest) {
        showBrowserNotification("PixelCRM", newest.message);
      } else {
        showBrowserNotification("PixelCRM", "You have a new notification");
      }
    }
    prevCount.current = unreadCount;
  }, [unreadCount, notifsList]);

  const handleOpen = () => {
    setOpen(o => !o);
    if (!open) {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    }
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
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

      {open && (
        <div className="absolute left-0 top-full mt-2 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-semibold text-white">Notifications</span>
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

          <div className="max-h-80 overflow-y-auto">
            {notifsList.length === 0 ? (
              <div className="py-10 text-center text-slate-500 text-sm">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No notifications yet
              </div>
            ) : (
              notifsList.slice(0, 20).map((notif) => {
                const Icon = notifIcon(notif.type);
                const colorCls = notifColor(notif.type);
                return (
                  <div
                    key={notif.id}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3 border-b border-slate-800/50 transition-colors cursor-pointer hover:bg-slate-800/40",
                      !notif.read && "bg-blue-500/5"
                    )}
                    onClick={() => !notif.read && markOneMutation.mutate(notif.id)}
                  >
                    <div className={cn("p-1.5 rounded-lg flex-shrink-0 mt-0.5", colorCls)}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-xs leading-snug", notif.read ? "text-slate-400" : "text-slate-200 font-medium")}>
                        {notif.message}
                      </p>
                      <p className="text-[10px] text-slate-600 mt-1">
                        {notif.createdAt
                          ? formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })
                          : ""}
                      </p>
                    </div>
                    {!notif.read && (
                      <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
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
      )}
    </div>
  );
}
