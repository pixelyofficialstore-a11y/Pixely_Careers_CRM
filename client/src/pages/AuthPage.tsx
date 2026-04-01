import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Eye, EyeOff, Zap } from "lucide-react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";

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
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: "hsl(222, 47%, 6%)" }}>

      {/* Animated grid background */}
      <div className="absolute inset-0 auth-grid opacity-40" />

      {/* Background glow orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute -top-1/4 -left-1/4 w-[60%] h-[60%] rounded-full"
          style={{ background: "radial-gradient(circle, hsla(221, 83%, 40%, 0.2) 0%, transparent 70%)" }}
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -bottom-1/4 -right-1/4 w-[50%] h-[50%] rounded-full"
          style={{ background: "radial-gradient(circle, hsla(199, 89%, 30%, 0.15) 0%, transparent 70%)" }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40%] h-[40%] rounded-full"
          style={{ background: "radial-gradient(circle, hsla(263, 70%, 40%, 0.08) 0%, transparent 70%)" }}
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        />
      </div>

      {/* Floating particles */}
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-blue-400/30"
          style={{
            left: `${15 + i * 14}%`,
            top: `${20 + (i % 3) * 25}%`,
          }}
          animate={{
            y: [-10, 10, -10],
            opacity: [0.2, 0.6, 0.2],
          }}
          transition={{
            duration: 3 + i * 0.5,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.4,
          }}
        />
      ))}

      {/* Main card */}
      <motion.div
        className="relative z-10 w-full max-w-md"
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Logo & Branding */}
        <motion.div
          className="text-center mb-8"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
        >
          <motion.div
            className="relative inline-block mb-5"
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          >
            <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-xl scale-150" />
            <div className="relative w-20 h-20 mx-auto rounded-2xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, hsla(221,83%,25%,0.6), hsla(222,47%,12%,0.8))", border: "1px solid hsla(221,83%,53%,0.3)", boxShadow: "0 0 30px hsla(221,83%,53%,0.2)" }}>
              <img src={logoUrl} alt="Pixely" className="h-10 w-auto" />
            </div>
          </motion.div>

          <h1 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: "var(--font-display)" }}>
            Welcome Back
          </h1>
          <p className="text-slate-400 text-sm">Sign in to your Pixely CRM dashboard</p>
        </motion.div>

        {/* Form Card */}
        <motion.div
          className="relative rounded-2xl overflow-hidden"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          style={{
            background: "linear-gradient(135deg, hsla(222, 47%, 13%, 0.95) 0%, hsla(222, 47%, 10%, 0.98) 100%)",
            border: "1px solid hsla(217, 33%, 22%, 0.5)",
            boxShadow: "0 24px 60px -12px hsla(222, 47%, 4%, 0.8), 0 0 0 1px hsla(217, 33%, 20%, 0.3), 0 1px 0 hsla(210, 40%, 98%, 0.04) inset",
          }}
        >
          {/* Top shimmer line */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />

          <div className="p-8">
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              {/* Username field */}
              <motion.div
                className="space-y-2"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3, duration: 0.4 }}
              >
                <label className="text-sm font-medium text-slate-300">Username</label>
                <input
                  {...form.register("username")}
                  className="w-full px-4 py-3 rounded-xl text-white placeholder-slate-600 text-sm transition-all duration-200 input-ring"
                  style={{ background: "hsla(222, 47%, 8%, 0.8)", border: "1px solid hsla(217, 33%, 22%, 0.6)" }}
                  placeholder="Enter your username"
                />
                {form.formState.errors.username && (
                  <motion.p
                    className="text-red-400 text-xs flex items-center gap-1"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {form.formState.errors.username.message}
                  </motion.p>
                )}
              </motion.div>
              
              {/* Password field */}
              <motion.div
                className="space-y-2"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35, duration: 0.4 }}
              >
                <label className="text-sm font-medium text-slate-300">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    {...form.register("password")}
                    className="w-full px-4 py-3 pr-12 rounded-xl text-white placeholder-slate-600 text-sm transition-all duration-200 input-ring"
                    style={{ background: "hsla(222, 47%, 8%, 0.8)", border: "1px solid hsla(217, 33%, 22%, 0.6)" }}
                    placeholder="Enter your password"
                    data-testid="input-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                    data-testid="button-toggle-password"
                  >
                    {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                  </button>
                </div>
                {form.formState.errors.password && (
                  <motion.p
                    className="text-red-400 text-xs"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {form.formState.errors.password.message}
                  </motion.p>
                )}
              </motion.div>

              {/* Error message */}
              {loginMutation.isError && (
                <motion.div
                  className="px-4 py-3 rounded-xl text-red-400 text-sm"
                  style={{ background: "hsla(0, 62%, 30%, 0.15)", border: "1px solid hsla(0, 62%, 50%, 0.2)" }}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                >
                  Invalid username or password. Please try again.
                </motion.div>
              )}

              {/* Submit button */}
              <motion.button
                type="submit"
                disabled={loginMutation.isPending}
                className="relative w-full py-3 rounded-xl font-semibold text-white text-sm overflow-hidden transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
                  boxShadow: "0 4px 20px hsla(221, 83%, 53%, 0.3), 0 0 0 1px hsla(221, 83%, 60%, 0.2) inset",
                }}
                whileHover={{ scale: loginMutation.isPending ? 1 : 1.01, boxShadow: "0 6px 25px hsla(221, 83%, 53%, 0.4)" }}
                whileTap={{ scale: loginMutation.isPending ? 1 : 0.99 }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.4 }}
              >
                {/* Hover shimmer */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-200%] hover:translate-x-[200%] transition-transform duration-700" />
                
                <span className="relative flex items-center justify-center gap-2">
                  {loginMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Signing In...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      Sign In
                    </>
                  )}
                </span>
              </motion.button>
            </form>
          </div>
        </motion.div>

        {/* Footer */}
        <motion.p
          className="text-center text-xs text-slate-600 mt-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          Pixely Careers — Internal Agency Platform
        </motion.p>
      </motion.div>
    </div>
  );
}
