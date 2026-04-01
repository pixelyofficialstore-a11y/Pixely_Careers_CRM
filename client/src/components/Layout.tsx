import { ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Menu, X } from "lucide-react";
import { useLocation } from "wouter";

export function Layout({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--bg)" }}
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 rounded-full border-2 border-t-blue-500 animate-spin"
            style={{ borderColor: "var(--border)", borderTopColor: "#2563eb" }}
          />
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Loading...
          </p>
        </div>
      </div>
    );
  }

  if (!user || location.startsWith("/auth")) {
    return (
      <main className="min-h-screen" style={{ background: "var(--bg)" }}>
        {children}
      </main>
    );
  }

  return (
    <div
      className="h-screen flex overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
      {/* Mobile top bar */}
      <div
        className="lg:hidden fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-4"
        style={{
          background: "#0d0d10",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-1.5 rounded-md text-gray-400 hover:text-white transition-colors"
          data-testid="button-mobile-menu"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <span className="text-sm font-semibold text-white">Pixely CRM</span>
        <div className="w-8" />
      </div>

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar — fixed on desktop, slide-in on mobile */}
      <div
        className={`fixed lg:relative z-50 lg:z-auto h-full transition-transform duration-200 lg:transform-none ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <Sidebar onNavigate={() => setMobileMenuOpen(false)} />
      </div>

      {/* Page content */}
      <main
        className="flex-1 h-screen overflow-y-auto pt-14 lg:pt-0 page-enter"
        key={location}
      >
        {children}
      </main>
    </div>
  );
}
