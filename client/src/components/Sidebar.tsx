import { useRef } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  LayoutDashboard,
  FileText,
  Users,
  BarChart3,
  LogOut,
  CreditCard,
  Camera,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

import logoUrl from "@assets/rr__1500_x_500_px_-removebg-preview_1769451275347.png";

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const [location] = useLocation();
  const { user, logoutMutation } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = user?.role === "admin";

  const { data: pendingPaymentData } = useQuery<{ count: number }>({
    queryKey: ["/api/payment-verifications/pending-count"],
    refetchInterval: 30000,
    enabled: isAdmin,
    retry: false,
  });
  const pendingPaymentCount = pendingPaymentData?.count || 0;

  const avatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch("/api/users/me/avatar", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to upload avatar");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Photo updated", description: "Profile photo changed successfully." });
      window.location.reload();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to upload photo.", variant: "destructive" });
    },
  });

  if (!user) return null;

  const links = [
    { href: "/",        label: "Dashboard", icon: LayoutDashboard, roles: ["admin","support","designer"] },
    { href: "/orders",  label: "Orders",    icon: FileText,        roles: ["admin","support","designer"] },
    { href: "/payments",label: "Payments",  icon: CreditCard,      roles: ["admin","support","designer"] },
    { href: "/users",   label: "Team",      icon: Users,           roles: ["admin"] },
    { href: "/stats",   label: "Analytics", icon: BarChart3,       roles: ["admin"] },
  ];

  const allowedLinks = links.filter(l => l.roles.includes(user.role));

  return (
    <aside
      className="flex flex-col w-60 h-screen"
      style={{
        background: "#0d0d10",
        borderRight: "1px solid var(--border)",
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2.5 px-4 h-14 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <img src={logoUrl} alt="Pixely" className="h-6 w-auto" />
        <span className="text-sm font-semibold text-white tracking-tight">
          Pixely CRM
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 overflow-y-auto">
        <div className="mb-1 px-2 pt-2 pb-1">
          <span
            className="text-[10px] font-medium uppercase tracking-widest"
            style={{ color: "var(--text-muted)" }}
          >
            Menu
          </span>
        </div>

        <div className="space-y-0.5">
          {allowedLinks.map(link => {
            const Icon = link.icon;
            const isActive = location === link.href;
            const showBadge = link.href === "/payments" && isAdmin && pendingPaymentCount > 0;

            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "text-white"
                    : "text-gray-400 hover:text-white"
                )}
                style={{
                  background: isActive ? "rgba(255,255,255,0.07)" : "transparent",
                }}
                onMouseOver={e => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseOut={e => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <Icon
                  className="w-4 h-4 flex-shrink-0"
                  style={{ color: isActive ? "#60a5fa" : undefined }}
                />
                <span className="flex-1">{link.label}</span>
                {showBadge && (
                  <Badge
                    variant="destructive"
                    className="h-4 min-w-[16px] px-1 text-[10px] font-bold"
                    data-testid="badge-pending-payments"
                  >
                    {pendingPaymentCount}
                  </Badge>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* User */}
      <div
        className="p-3 flex-shrink-0"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) avatarMutation.mutate(file);
          }}
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          data-testid="input-avatar-upload"
        />

        {/* Profile row */}
        <div className="flex items-center gap-2.5 px-1.5 py-1.5 mb-1 rounded-md">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="relative flex-shrink-0 group"
            title="Change profile photo"
            data-testid="button-change-avatar"
          >
            <Avatar className="w-7 h-7">
              {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
              <AvatarFallback
                className="text-xs font-semibold"
                style={{ background: "#1e3a5f", color: "#60a5fa" }}
              >
                {user.name.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <Camera className="w-3 h-3 text-white" />
            </div>
            {avatarMutation.isPending && (
              <div className="absolute inset-0 rounded-full bg-black/70 flex items-center justify-center">
                <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </button>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate leading-tight">
              {user.name}
            </p>
            <p className="text-xs capitalize" style={{ color: "var(--text-muted)" }}>
              {user.role}
            </p>
          </div>
        </div>

        {/* Sign out */}
        <button
          onClick={() => logoutMutation.mutate()}
          className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-sm transition-colors text-gray-500 hover:text-red-400"
          style={{ background: "transparent" }}
          onMouseOver={e => (e.currentTarget.style.background = "rgba(239,68,68,0.06)")}
          onMouseOut={e => (e.currentTarget.style.background = "transparent")}
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
