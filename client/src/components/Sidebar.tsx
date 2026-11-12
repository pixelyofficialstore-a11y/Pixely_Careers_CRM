import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, FileText, Users, BarChart3, LogOut, CreditCard, Settings, FileWarning,
  MessageSquareHeart, Globe, Contact, BellRing, KanbanSquare, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/lib/theme";

export type NavLink = { href: string; label: string; icon: typeof LayoutDashboard; roles: string[]; match?: (path: string) => boolean };

export const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "support", "designer"] },
  { href: "/orders", label: "Orders", icon: FileText, roles: ["admin", "support", "designer"] },
  { href: "/board", label: "Board", icon: KanbanSquare, roles: ["admin", "support", "designer"] },
  { href: "/clients", label: "Clients", icon: Contact, roles: ["admin", "support"], match: p => p.startsWith("/clients") },
  { href: "/website-requests", label: "Website Requests", icon: Globe, roles: ["admin", "support"] },
  { href: "/payments", label: "Payments", icon: CreditCard, roles: ["admin", "support", "designer"] },
  { href: "/complaints", label: "Complaints", icon: FileWarning, roles: ["admin", "support", "designer"], match: p => p.startsWith("/complaints") },
  { href: "/feedback", label: "Feedback", icon: MessageSquareHeart, roles: ["admin", "support", "designer"] },
  { href: "/users", label: "Team", icon: Users, roles: ["admin"] },
  { href: "/stats", label: "Analytics", icon: BarChart3, roles: ["admin"] },
  { href: "/admin-settings", label: "Settings", icon: Settings, roles: ["admin"] },
  { href: "/settings/notifications", label: "Notifications", icon: BellRing, roles: ["support", "designer"] },
];

/** Badge counts shown next to nav items (shared by sidebar + mobile tabs). */
export function useNavBadges() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canSeeWebsiteRequests = user?.role === "admin" || user?.role === "support";
  const { data: pendingPayments } = useQuery<{ count: number }>({ queryKey: ["/api/payment-verifications/pending-count"], enabled: isAdmin, retry: false });
  const { data: complaints } = useQuery<{ count: number }>({ queryKey: ["/api/complaints/actionable-count"], enabled: Boolean(user), retry: false });
  const { data: wr } = useQuery<{ orders_new: number; reviews_new: number; partners_new: number; awaiting_approval: number }>({
    queryKey: ["/api/website-requests/counts"], enabled: canSeeWebsiteRequests, retry: false,
  });
  const website = (wr?.orders_new ?? 0) + (wr?.reviews_new ?? 0) + (wr?.partners_new ?? 0) + (isAdmin ? wr?.awaiting_approval ?? 0 : 0);
  return {
    "/payments": isAdmin ? pendingPayments?.count ?? 0 : 0,
    "/complaints": complaints?.count ?? 0,
    "/website-requests": website,
  } as Record<string, number>;
}

export function BrandLockup({ collapsed = false }: { collapsed?: boolean }) {
  const { resolved } = useTheme();
  // Only the official files are used. There is no light-on-dark lockup in the brand
  // kit yet, so dark mode shows the "P" mark with the name set in text.
  if (collapsed) return <img src="/brand/icon.png" alt="Pixely Careers" className="h-8 w-auto" />;
  if (resolved === "light") return <img src="/brand/logo.png" alt="Pixely Careers" className="h-8 w-auto" />;
  return (
    <span className="flex items-center gap-2.5">
      <img src="/brand/icon.png" alt="" className="h-8 w-auto" />
      <span className="font-display text-[15px] font-semibold tracking-tight text-foreground">Pixely Careers</span>
    </span>
  );
}

interface SidebarProps {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function Sidebar({ onNavigate, collapsed = false, onToggleCollapsed }: SidebarProps) {
  const [location] = useLocation();
  const { user, logoutMutation } = useAuth();
  const badges = useNavBadges();
  if (!user) return null;

  const links = NAV_LINKS.filter(link => link.roles.includes(user.role));

  return (
    <aside
      className={cn(
        "flex h-[100dvh] flex-col border-r border-border bg-[hsl(var(--sidebar-bg))] transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-[248px]",
      )}
    >
      <div className={cn("flex h-16 items-center", collapsed ? "justify-center px-2" : "justify-between px-4")}>
        <Link href="/" onClick={onNavigate} className="flex items-center" aria-label="Dashboard"><BrandLockup collapsed={collapsed} /></Link>
        {!collapsed && onToggleCollapsed && (
          <button onClick={onToggleCollapsed} className="hidden h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-[hsl(var(--surface-3))] hover:text-foreground lg:flex" aria-label="Collapse sidebar">
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Main">
        {links.map(link => {
          const Icon = link.icon;
          const isActive = link.match ? link.match(location) : location === link.href;
          const count = badges[link.href] ?? 0;
          const item = (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150",
                collapsed && "justify-center px-0",
                isActive ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]" : "text-slate-400 hover:bg-[hsl(var(--surface-3))] hover:text-foreground",
              )}
              data-testid={`nav-${link.href.replace(/\//g, "") || "home"}`}
            >
              {isActive && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-brand-cyan" aria-hidden />}
              <Icon className={cn("h-[18px] w-[18px] shrink-0", isActive ? "text-primary" : "text-slate-500 group-hover:text-foreground")} />
              {!collapsed && <span className="flex-1 truncate">{link.label}</span>}
              {count > 0 && (
                <span
                  className={cn("min-w-[20px] rounded-full bg-danger px-1.5 text-center text-[11px] font-semibold leading-5 text-on-color", collapsed && "absolute right-1.5 top-1 min-w-[16px] px-1 text-[10px] leading-4")}
                  data-testid={link.href === "/payments" ? "badge-pending-payments" : link.href === "/website-requests" ? "badge-website-requests" : "badge-actionable-complaints"}
                >
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </Link>
          );
          return collapsed ? (
            <Tooltip key={link.href} delayDuration={150}>
              <TooltipTrigger asChild>{item}</TooltipTrigger>
              <TooltipContent side="right">{link.label}</TooltipContent>
            </Tooltip>
          ) : item;
        })}
      </nav>

      <div className={cn("border-t border-border p-3", collapsed && "flex flex-col items-center gap-2")}>
        {collapsed && onToggleCollapsed && (
          <button onClick={onToggleCollapsed} className="hidden h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-[hsl(var(--surface-3))] hover:text-foreground lg:flex" aria-label="Expand sidebar">
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
        <div className={cn("flex items-center gap-3", collapsed && "flex-col")}>
          <Avatar className="h-9 w-9 border border-border">
            {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
            <AvatarFallback className="bg-[hsl(var(--surface-3))] text-sm font-medium text-slate-300">{user.name.charAt(0)}</AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-200">{user.name}</p>
              <p className="truncate text-xs capitalize text-slate-500">{user.role}</p>
            </div>
          )}
          <button
            onClick={() => logoutMutation.mutate()}
            className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-rose-500/10 hover:text-rose-400"
            aria-label="Sign out"
            title="Sign out"
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
