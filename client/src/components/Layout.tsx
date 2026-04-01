import { ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Menu, X } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

const pageVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

const pageTransition = {
  duration: 0.3,
  ease: [0.16, 1, 0.3, 1],
};

export function Layout({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-full border-2 border-blue-500/20" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 animate-spin" />
          </div>
          <p className="text-slate-500 text-sm animate-pulse">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || location.startsWith("/auth")) {
    return <main className="min-h-screen bg-background">{children}</main>;
  }

  return (
    <div className="h-screen bg-background text-foreground flex overflow-hidden">
      {/* Mobile Navigation Bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-4"
        style={{ background: "hsla(222, 47%, 7%, 0.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid hsla(217, 33%, 18%, 0.6)" }}>
        <div className="flex items-center gap-3">
          <Button 
            variant="ghost" 
            size="icon"
            className="text-slate-400 hover:text-white hover:bg-slate-800"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            data-testid="button-mobile-menu"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={mobileMenuOpen ? "close" : "open"}
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </motion.div>
            </AnimatePresence>
          </Button>
          <span className="text-base font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>Pixely CRM</span>
        </div>
      </div>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div 
            className="lg:hidden fixed inset-0 z-40"
            style={{ background: "hsla(222, 47%, 4%, 0.8)", backdropFilter: "blur(4px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <AnimatePresence mode="wait">
        <motion.div
          className="fixed lg:fixed z-50 lg:z-auto h-full"
          initial={false}
          animate={{
            x: mobileMenuOpen ? 0 : typeof window !== 'undefined' && window.innerWidth < 1024 ? -280 : 0,
          }}
          transition={{ type: "spring", stiffness: 300, damping: 35 }}
        >
          <Sidebar onNavigate={() => setMobileMenuOpen(false)} />
        </motion.div>
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 lg:pl-64 h-screen flex flex-col overflow-y-auto pt-14 lg:pt-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={location}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={pageTransition}
            className="flex-1 min-h-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
