import { useState, useRef } from "react";
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
  ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { motion, AnimatePresence } from "framer-motion";

import logoUrl from "@assets/rr__1500_x_500_px_-removebg-preview_1769451275347.png";

interface SidebarProps {
  onNavigate?: () => void;
}

const roleColors: Record<string, string> = {
  admin: "text-amber-400",
  support: "text-sky-400",
  designer: "text-violet-400",
};

const roleBg: Record<string, string> = {
  admin: "bg-amber-500/10 border-amber-500/20",
  support: "bg-sky-500/10 border-sky-500/20",
  designer: "bg-violet-500/10 border-violet-500/20",
};

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
      formData.append('avatar', file);
      const res = await fetch('/api/users/me/avatar', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to upload avatar');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Success", description: "Profile photo updated!" });
      window.location.reload();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to upload photo", variant: "destructive" });
    },
  });

  const handleAvatarClick = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) avatarMutation.mutate(file);
  };

  if (!user) return null;

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "support", "designer"] },
    { href: "/orders", label: "Orders", icon: FileText, roles: ["admin", "support", "designer"] },
    { href: "/payments", label: "Payments", icon: CreditCard, roles: ["admin", "support", "designer"] },
    { href: "/users", label: "Team", icon: Users, roles: ["admin"] },
    { href: "/stats", label: "Analytics", icon: BarChart3, roles: ["admin"] },
  ];

  const allowedLinks = links.filter(link => link.roles.includes(user.role));

  return (
    <aside className="flex flex-col w-64 h-screen relative overflow-hidden" style={{
      background: "linear-gradient(180deg, hsl(222, 47%, 7%) 0%, hsl(222, 47%, 8%) 100%)",
      borderRight: "1px solid hsla(217, 33%, 18%, 0.6)",
    }}>
      {/* Top gradient accent */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" />
      
      {/* Background glow */}
      <div className="absolute top-0 left-0 w-full h-48 opacity-30 pointer-events-none"
        style={{ background: "radial-gradient(ellipse 80% 60% at 50% -20%, hsla(221, 83%, 40%, 0.4) 0%, transparent 70%)" }} />

      {/* Logo Section */}
      <div className="relative p-5 pb-4">
        <motion.div 
          className="flex items-center gap-3"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <div className="relative">
            <div className="absolute inset-0 bg-blue-500/20 rounded-xl blur-md" />
            <img src={logoUrl} alt="PixelCRM" className="relative h-8 w-auto" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
              Pixely CRM
            </h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest">Agency Platform</p>
          </div>
        </motion.div>
      </div>

      {/* Divider */}
      <div className="mx-5 h-px bg-gradient-to-r from-transparent via-slate-700/50 to-transparent mb-2" />

      {/* Navigation */}
      <div className="flex-1 px-3 py-2 overflow-y-auto">
        <p className="px-3 text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-2">Navigation</p>
        
        <nav className="space-y-0.5">
          {allowedLinks.map((link, i) => {
            const Icon = link.icon;
            const isActive = location === link.href;
            const showBadge = link.href === "/payments" && isAdmin && pendingPaymentCount > 0;
            
            return (
              <motion.div
                key={link.href}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05, ease: "easeOut" }}
              >
                <Link 
                  href={link.href}
                  onClick={onNavigate}
                  className={cn(
                    "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group overflow-hidden",
                    isActive 
                      ? "text-white" 
                      : "text-slate-400 hover:text-slate-200"
                  )}
                  style={isActive ? {
                    background: "linear-gradient(135deg, hsla(221, 83%, 53%, 0.15) 0%, hsla(221, 83%, 53%, 0.05) 100%)",
                    border: "1px solid hsla(221, 83%, 53%, 0.2)",
                  } : {
                    border: "1px solid transparent",
                  }}
                >
                  {/* Active indicator */}
                  {isActive && (
                    <motion.div 
                      layoutId="activeNav"
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                      style={{ background: "linear-gradient(180deg, #60a5fa, #818cf8)", boxShadow: "0 0 8px #60a5fa80" }}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    />
                  )}

                  {/* Hover background */}
                  {!isActive && (
                    <div className="absolute inset-0 rounded-xl bg-slate-800/0 group-hover:bg-slate-800/50 transition-colors duration-200" />
                  )}

                  <div className={cn(
                    "relative flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200",
                    isActive 
                      ? "bg-blue-500/20 text-blue-400" 
                      : "bg-transparent text-slate-500 group-hover:text-slate-300 group-hover:bg-slate-700/50"
                  )}>
                    <Icon className="w-4 h-4" />
                  </div>

                  <span className="relative flex-1">{link.label}</span>

                  {showBadge && (
                    <Badge 
                      variant="destructive" 
                      className="relative h-5 min-w-[20px] px-1.5 text-xs font-bold badge-pulse"
                      data-testid="badge-pending-payments"
                    >
                      {pendingPaymentCount}
                    </Badge>
                  )}

                  {isActive && (
                    <ChevronRight className="relative w-3.5 h-3.5 text-blue-400/60" />
                  )}
                </Link>
              </motion.div>
            );
          })}
        </nav>
      </div>

      {/* User Section */}
      <div className="relative p-4">
        {/* Divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-slate-700/50 to-transparent mb-4" />

        <input 
          type="file" 
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          data-testid="input-avatar-upload"
        />

        {/* User card */}
        <div className="flex items-center gap-3 mb-3">
          <button 
            onClick={handleAvatarClick}
            className="relative group flex-shrink-0"
            data-testid="button-change-avatar"
            title="Click to change profile photo"
          >
            <div className="absolute inset-0 rounded-full bg-blue-500/20 blur-sm opacity-0 group-hover:opacity-100 transition-opacity" />
            <Avatar className="relative w-9 h-9 ring-2 ring-slate-700 group-hover:ring-blue-500/40 transition-all duration-200">
              {user.avatar ? (
                <AvatarImage src={user.avatar} alt={user.name} />
              ) : null}
              <AvatarFallback className="bg-gradient-to-br from-slate-700 to-slate-800 text-slate-200 text-sm font-semibold">
                {user.name.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div className="absolute inset-0 bg-black/60 rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-200">
              <Camera className="w-3.5 h-3.5 text-white" />
            </div>
            {avatarMutation.isPending && (
              <div className="absolute inset-0 bg-black/70 rounded-full flex items-center justify-center">
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </button>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{user.name}</p>
            <span className={cn(
              "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md border capitalize",
              roleBg[user.role],
              roleColors[user.role]
            )}>
              {user.role}
            </span>
          </div>
        </div>

        <button 
          onClick={() => logoutMutation.mutate()}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-950/20 transition-all duration-200 group"
        >
          <LogOut className="w-4 h-4 group-hover:text-red-400 transition-colors" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
