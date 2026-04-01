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
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "var(--bg)" }}
    >
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src={logoUrl}
            alt="Pixely Careers"
            className="h-10 w-auto mx-auto mb-5 opacity-90"
          />
          <h1 className="text-xl font-semibold text-white mb-1">
            Sign in to Pixely CRM
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Internal agency management platform
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-xl p-6"
          style={{
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
          }}
        >
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

            {/* Username */}
            <div>
              <label
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--text-primary)" }}
              >
                Username
              </label>
              <input
                {...form.register("username")}
                autoComplete="username"
                placeholder="Enter your username"
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-gray-600 outline-none transition-all"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                }}
                onFocus={e => (e.target.style.borderColor = "var(--accent)")}
                onBlur={e => (e.target.style.borderColor = "var(--border)")}
              />
              {form.formState.errors.username && (
                <p className="mt-1 text-xs text-red-400">
                  {form.formState.errors.username.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--text-primary)" }}
              >
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  {...form.register("password")}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="w-full px-3 py-2.5 pr-10 rounded-lg text-sm text-white placeholder-gray-600 outline-none transition-all"
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                  }}
                  onFocus={e => (e.target.style.borderColor = "var(--accent)")}
                  onBlur={e => (e.target.style.borderColor = "var(--border)")}
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: "var(--text-secondary)" }}
                  data-testid="button-toggle-password"
                >
                  {showPassword
                    ? <EyeOff className="w-4 h-4" />
                    : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {form.formState.errors.password && (
                <p className="mt-1 text-xs text-red-400">
                  {form.formState.errors.password.message}
                </p>
              )}
            </div>

            {/* Error */}
            {loginMutation.isError && (
              <div
                className="px-3 py-2.5 rounded-lg text-sm text-red-400"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.2)",
                }}
              >
                Invalid username or password.
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{ background: "var(--accent)" }}
              onMouseOver={e =>
                !loginMutation.isPending &&
                ((e.target as HTMLElement).style.background = "var(--accent-hover)")
              }
              onMouseOut={e =>
                ((e.target as HTMLElement).style.background = "var(--accent)")
              }
            >
              {loginMutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</>
                : "Sign In"
              }
            </button>
          </form>
        </div>

        <p
          className="text-center text-xs mt-6"
          style={{ color: "var(--text-muted)" }}
        >
          Pixely Careers — Internal Use Only
        </p>
      </div>
    </div>
  );
}
