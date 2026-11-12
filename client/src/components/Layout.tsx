import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { CreditCard, FileText, Globe, KanbanSquare, LayoutDashboard, Menu, Plus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sidebar, BrandLockup, useNavBadges } from "./Sidebar";
import { NotificationBell } from "./NotificationBell";
import { InstallPrompt } from "./InstallPrompt";
import { GlobalSearch } from "./GlobalSearch";
import { ThemeToggle } from "./ThemeToggle";

const COLLAPSE_KEY = "px-sidebar-collapsed";

export function Layout({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });
  const badges = useNavBadges();

  useEffect(() => { setMobileMenuOpen(false); }, [location]);
  const toggleCollapsed = () => setCollapsed(c => {
    try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* ignore */ }
    return !c;
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <img src="/brand/icon.png" alt="" className="h-10 w-auto animate-pulse" />
      </div>
    );
  }

  if (!user || location.startsWith("/auth")) {
    return <main className="min-h-screen bg-background">{children}</main>;
  }

  const canCreate = user.role === "admin" || user.role === "support";
  const newOrder = () => setLocation("/orders?new=1");

  // Mobile bottom tabs: Home, Orders, Requests, Payments, More.
  const tabs = [
    { href: "/", label: "Home", icon: LayoutDashboard },
    { href: "/orders", label: "Orders", icon: FileText },
    user.role === "designer"
      ? { href: "/board", label: "Board", icon: KanbanSquare }
      : { href: "/website-requests", label: "Requests", icon: Globe },
    { href: "/payments", label: "Payments", icon: CreditCard },
  ];

  return (
    <div className="flex min-h-[100dvh] bg-background text-foreground">
      {/* Desktop sidebar */}
      <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">
        <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </div>

      {/* Mobile drawer ("More") */}
      {mobileMenuOpen && <div className="fixed inset-0 z-50 bg-black/40 animate-fade-in lg:hidden" onClick={() => setMobileMenuOpen(false)} />}
      <div className={cn("fixed inset-y-0 left-0 z-50 transition-transform duration-200 lg:hidden", mobileMenuOpen ? "translate-x-0" : "-translate-x-full")}>
        <Sidebar onNavigate={() => setMobileMenuOpen(false)} />
      </div>

      <div className={cn("flex min-h-[100dvh] min-w-0 flex-1 flex-col transition-[padding] duration-200", collapsed ? "lg:pl-[72px]" : "lg:pl-[248px]")}>
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:px-4 lg:h-16 lg:px-6">
          <Link href="/" className="flex items-center lg:hidden" aria-label="Dashboard"><BrandLockup collapsed /></Link>
          <div className="hidden flex-1 lg:block"><GlobalSearch /></div>
          <div className="flex-1 lg:hidden" />
          <div className="lg:hidden"><GlobalSearch compact /></div>
          <ThemeToggle />
          <NotificationBell align="right" />
          {canCreate && (
            <Button onClick={newOrder} className="ml-1 hidden lg:inline-flex" data-testid="button-topbar-new-order">
              <Plus className="h-4 w-4" />New order
            </Button>
          )}
        </header>

        <main className="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">{children}</main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur lg:hidden" aria-label="Main">
        <div className="grid h-16 grid-cols-5">
          {tabs.map(t => {
            const active = location === t.href;
            const count = badges[t.href] ?? 0;
            return (
              <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
                className={cn("relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-primary" : "text-slate-500")}
                data-testid={`tab-${t.label.toLowerCase()}`}>
                <t.icon className="h-5 w-5" />
                {t.label}
                {count > 0 && <span className="absolute left-1/2 top-2 ml-2 min-w-[16px] rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-on-color">{count > 99 ? "99+" : count}</span>}
              </Link>
            );
          })}
          <button onClick={() => setMobileMenuOpen(true)} className="flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-slate-500" data-testid="button-mobile-menu">
            <Menu className="h-5 w-5" />More
          </button>
        </div>
      </nav>
      <InstallPrompt />
    </div>
  );
}
