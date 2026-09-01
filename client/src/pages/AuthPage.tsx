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
    <div className="auth-page relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-8">
      <div className="absolute inset-x-0 top-0 h-px bg-primary/60" aria-hidden="true" />
      <div className="absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/[0.035] blur-3xl" aria-hidden="true" />
      <main className="relative z-10 w-full max-w-[336px]">
        <div className="mb-6 text-center">
          <img src={logoUrl} alt="Pixely Careers" className="mx-auto mb-5 block h-[72px] w-[72px] object-contain" />
          <h1 className="text-[1.45rem] font-semibold tracking-tight text-foreground">Welcome Back</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">Sign in to access your dashboard</p>
        </div>

        <div className="glass-panel auth-card rounded-xl p-6 shadow-xl shadow-slate-950/30">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300" htmlFor="username">Username</label>
              <input
                id="username"
                {...form.register("username")}
                autoComplete="username"
                className="crm-control h-11 w-full px-3 text-sm"
                placeholder="Enter your username"
              />
              {form.formState.errors.username && (
                <p className="text-red-400 text-xs">{form.formState.errors.username.message}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300" htmlFor="password">Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  {...form.register("password")}
                  autoComplete="current-password"
                  className="crm-control h-11 w-full px-3 pr-11 text-sm"
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
                className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-[.42rem] bg-[#2d63e8] py-2.5 font-semibold text-white transition-colors hover:bg-[#3c70f4] disabled:cursor-not-allowed disabled:opacity-50"
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
      </main>
    </div>
  );
}
