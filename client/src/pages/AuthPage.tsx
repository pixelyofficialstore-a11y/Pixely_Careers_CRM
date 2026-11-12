import { useEffect, useState } from "react";
import { useAuth, LoginError } from "@/hooks/use-auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { useLocation } from "wouter";


const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  totpCode: z.string().optional(),
});

export default function AuthPage() {
  const { user, loginMutation } = useAuth();
  const [, setLocation] = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    if (user) setLocation("/");
  }, [user, setLocation]);

  useEffect(() => {
    const err = loginMutation.error;
    if (err instanceof LoginError && (err.code === "TOTP_REQUIRED" || err.code === "TOTP_INVALID")) setNeedsCode(true);
  }, [loginMutation.error]);

  if (user) return null;

  const onSubmit = (data: z.infer<typeof loginSchema>) => {
    loginMutation.mutate({
      username: data.username,
      password: data.password,
      ...(needsCode && data.totpCode ? { totpCode: data.totpCode.replace(/\s+/g, "") } : {}),
    });
  };

  const codeError = loginMutation.error instanceof LoginError && loginMutation.error.code === "TOTP_INVALID"
    ? loginMutation.error.message
    : null;

  return (
    <div className="auth-page relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-8">
      <div className="absolute inset-x-0 top-0 h-px bg-primary/60" aria-hidden="true" />
      <div className="absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/[0.035] blur-3xl" aria-hidden="true" />
      <main className="relative z-10 w-full max-w-[390px]">
        <div className="mb-8 text-center">
          <img src="/brand/emblem.png" alt="Pixely Careers" className="mx-auto mb-6 block h-16 w-16 rounded-2xl" />
          <h1 className="text-[1.75rem] font-semibold tracking-tight text-foreground">Welcome Back</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Sign in to continue</p>
        </div>

        <div className="glass-panel auth-card rounded-xl p-7 shadow-xl shadow-slate-950/30">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300" htmlFor="username">Username</label>
              <input
                id="username"
                {...form.register("username")}
                autoComplete="username"
                className="crm-control h-12 w-full px-3 text-sm"
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
                  className="crm-control h-12 w-full px-3 pr-11 text-sm"
                  placeholder="Enter your password"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-2 text-slate-500 hover:text-slate-200"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {form.formState.errors.password && (
                <p className="text-red-400 text-xs">{form.formState.errors.password.message}</p>
              )}
            </div>

            {needsCode && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300" htmlFor="totpCode">Authenticator code</label>
                <input
                  id="totpCode"
                  {...form.register("totpCode")}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={7}
                  className="crm-control h-12 w-full px-3 text-sm tracking-[0.3em]"
                  placeholder="123456"
                  data-testid="input-totp"
                />
                <p className={codeError ? "text-red-400 text-xs" : "text-xs text-muted-foreground"}>
                  {codeError || "Enter the 6-digit code from your authenticator app."}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-[.42rem] bg-primary py-2.5 font-semibold text-on-color transition-colors hover:bg-[hsl(var(--primary-hover))] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Signing In...
                </>
              ) : needsCode ? "Verify & Sign In" : (
                "Sign In"
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
