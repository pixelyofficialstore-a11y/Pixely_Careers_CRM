import { ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Menu, X } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

export function Layout({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // If loading or strictly on auth page, render simple layout or spinner
  if (isLoading) {
    return (
        <div className="min-h-[100dvh] bg-background flex items-center justify-center">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[.16em] text-muted-foreground"><span className="h-2 w-2 rounded-full bg-primary" />Loading workspace</div>
      </div>
    );
  }

  // Auth pages don't get the sidebar
  if (!user || location.startsWith("/auth")) {
    return <main className="min-h-screen bg-background">{children}</main>;
  }

  return (
      <div className="min-h-[100dvh] bg-background text-foreground flex overflow-hidden">
      {/* Mobile Navigation Bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 h-14 bg-[hsl(var(--card))] border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            data-testid="button-mobile-menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
           <span className="text-[15px] font-semibold tracking-tight text-foreground">Pixely CRM</span>
        </div>
      </div>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div 
          className="lg:hidden fixed inset-0 z-40 bg-black/50" 
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - hidden on mobile unless menu is open */}
      <div className={`
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} 
        lg:translate-x-0 
        transition-transform duration-200
        fixed lg:fixed
        z-50 lg:z-auto
        h-full
      `}>
        <Sidebar onNavigate={() => setMobileMenuOpen(false)} />
      </div>

      {/* Main Content - scrollable with padding for mobile nav */}
      <main className="flex-1 lg:pl-64 min-h-[100dvh] flex flex-col overflow-y-auto pt-14 lg:pt-0">
        {children}
      </main>
    </div>
  );
}
