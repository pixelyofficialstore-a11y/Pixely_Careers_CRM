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
  Settings
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NotificationBell } from "./NotificationBell";

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

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      avatarMutation.mutate(file);
    }
  };

  if (!user) return null;

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "support", "designer"] },
    { href: "/orders", label: "Orders", icon: FileText, roles: ["admin", "support", "designer"] },
    { href: "/payments", label: "Payments", icon: CreditCard, roles: ["admin", "support", "designer"] },
    { href: "/users", label: "Team", icon: Users, roles: ["admin"] },
    { href: "/stats", label: "Analytics", icon: BarChart3, roles: ["admin"] },
    { href: "/admin-settings", label: "Settings", icon: Settings, roles: ["admin"] },
  ];

  const allowedLinks = links.filter(link => link.roles.includes(user.role));

  const handleLinkClick = () => {
    if (onNavigate) onNavigate();
  };

  return (
    <aside className="flex flex-col w-64 bg-slate-950 border-r border-slate-800 h-screen">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-8">
          <img src={logoUrl} alt="PixelCRM" className="h-8 w-auto" />
          <h1 className="text-xl font-bold font-display tracking-tight text-white flex-1">Pixely_CRM</h1>
          <NotificationBell />
        </div>

        <div className="flex flex-col gap-6">
          <div className="space-y-1">
            <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Menu</p>
            {allowedLinks.map((link) => {
              const Icon = link.icon;
              const isActive = location === link.href;
              const showBadge = link.href === "/payments" && isAdmin && pendingPaymentCount > 0;
              
              return (
                <Link 
                  key={link.href} 
                  href={link.href} 
                  onClick={handleLinkClick}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 group",
                    isActive 
                      ? "bg-blue-600/10 text-blue-400" 
                      : "text-slate-400 hover:text-white hover:bg-slate-900"
                  )}
                >
                  <Icon className={cn("w-5 h-5", isActive ? "text-blue-400" : "text-slate-500 group-hover:text-white")} />
                  <span className="flex-1">{link.label}</span>
                  {showBadge && (
                    <Badge 
                      variant="destructive" 
                      className="h-5 min-w-[20px] px-1.5 text-xs font-bold"
                      data-testid="badge-pending-payments"
                    >
                      {pendingPaymentCount}
                    </Badge>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-auto p-6 border-t border-slate-800">
        <input 
          type="file" 
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          data-testid="input-avatar-upload"
        />
        <div className="flex items-center gap-3 mb-4">
          <button 
            onClick={handleAvatarClick}
            className="relative group"
            data-testid="button-change-avatar"
            title="Click to change profile photo"
          >
            <Avatar className="w-10 h-10 border border-slate-700">
              {user.avatar ? (
                <AvatarImage src={user.avatar} alt={user.name} />
              ) : null}
              <AvatarFallback className="bg-slate-800 text-slate-300 font-medium">
                {user.name.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div className="absolute inset-0 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <Camera className="w-4 h-4 text-white" />
            </div>
            {avatarMutation.isPending && (
              <div className="absolute inset-0 bg-black/70 rounded-full flex items-center justify-center">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{user.name}</p>
            <p className="text-xs text-slate-500 truncate capitalize">{user.role}</p>
          </div>
        </div>
        
        <button 
          onClick={() => logoutMutation.mutate()}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-red-400 hover:bg-red-950/20 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
