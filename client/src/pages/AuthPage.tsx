import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { useLocation } from "wouter";

import logoUrl from "@assets/rr__1500_x_500_px_-removebg-preview_1769447899946.png";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export default function AuthPage() {
  const { user, loginMutation } = useAuth();
  const [, setLocation] = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  
  if (user) {
    setLocation("/");
    return null;
  }

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = (data: z.infer<typeof loginSchema>) => {
    loginMutation.mutate(data);
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-primary/60" />
      <div className="relative z-10 w-full max-w-[390px]">
        <div className="mb-8">
          <div className="mx-auto mb-4">
            <img src={logoUrl} alt="Pixely Careers" className="h-14 w-auto" />
          </div>
          <p className="crm-eyebrow">Internal workspace</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Welcome back</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to continue to Pixely Careers.</p>
        </div>

        <div className="glass-panel rounded-[.5rem] p-6">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Username</label>
              <input
                {...form.register("username")}
                 autoComplete="username"
                 className="crm-control h-10 w-full px-3 text-sm"
                placeholder="Enter your username"
              />
              {form.formState.errors.username && (
                <p className="text-red-400 text-xs">{form.formState.errors.username.message}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  {...form.register("password")}
                   autoComplete="current-password"
                   className="crm-control h-10 w-full px-3 pr-11 text-sm"
                  placeholder="Enter your password"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-200"
                  data-testid="button-toggle-password"
                >
                   {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {form.formState.errors.password && (
                <p className="text-red-400 text-xs">{form.formState.errors.password.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loginMutation.isPending}
               className="w-full py-2.5 rounded-[.38rem] bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Signing In...
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
