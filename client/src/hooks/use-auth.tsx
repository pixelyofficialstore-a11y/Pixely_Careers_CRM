import { createContext, ReactNode, useContext, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import type { api as apiContract } from "@shared/routes";
import { useLocation } from "wouter";
import type { z } from "zod";
import { useToast } from "@/hooks/use-toast";

type LoginData = z.infer<typeof apiContract.auth.login.input>;

// Plain paths (not the @shared/routes value) keep drizzle and the schema out of the main bundle.
const api = {
  auth: {
    login: { path: "/api/login", method: "POST" },
    logout: { path: "/api/logout", method: "POST" },
    me: { path: "/api/user", method: "GET" },
  },
} as const;

/** User as returned by the API (secrets stripped, flags as booleans). */
export type SessionUser = Omit<User, "password" | "totpSecret" | "sessionsValidAfter" | "mustChangePassword" | "totpEnabled"> & {
  mustChangePassword: boolean;
  totpEnabled: boolean;
};

/** Login failure with the server error code (e.g. TOTP_REQUIRED, LOGIN_LOCKED). */
export class LoginError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

interface AuthContextType {
  user: SessionUser | null;
  isLoading: boolean;
  error: Error | null;
  loginMutation: ReturnType<typeof useAuthMutation>["loginMutation"];
  logoutMutation: ReturnType<typeof useAuthMutation>["logoutMutation"];
}

const AuthContext = createContext<AuthContextType | null>(null);

function useAuthMutation() {
  const queryClient = useQueryClient();
  const setLocation = useLocation()[1];
  const { toast } = useToast();

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginData) => {
      const res = await fetch(api.auth.login.path, {
        method: api.auth.login.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });

      if (!res.ok) {
        let serverMessage = "";
        let code: string | undefined;
        try {
          const data = await res.json();
          serverMessage = data?.message || "";
          code = data?.code;
        } catch {
          serverMessage = "";
        }
        if (res.status === 403) {
          throw new LoginError(serverMessage || "Your account has been disabled. Please contact the admin.", code);
        }
        if (res.status === 401) throw new LoginError(serverMessage || "Invalid username or password", code);
        throw new LoginError(serverMessage || "Login failed", code);
      }

      return (await res.json()) as SessionUser;
    },
    onSuccess: (user) => {
      queryClient.setQueryData([api.auth.me.path], user);
      toast({ title: "Welcome back", description: `Signed in as ${user.name}` });
      // Request browser notification permission after login; dispatch event so NotificationBell updates
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission()
          .then(() => {
            window.dispatchEvent(new CustomEvent('notificationPermissionChanged'));
          })
          .catch(() => {});
      }
      setLocation("/");
    },
    onError: (error: Error) => {
      // The login form asks for the 2FA code itself.
      if (error instanceof LoginError && error.code === "TOTP_REQUIRED") return;
      toast({
        title: "Login Failed",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(api.auth.logout.path, {
        method: api.auth.logout.method,
      });
      if (!res.ok) throw new Error("Logout failed");
    },
    onSuccess: () => {
      queryClient.setQueryData([api.auth.me.path], null);
      queryClient.clear();
      setLocation("/auth");
    },
  });

  return { loginMutation, logoutMutation };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user, isLoading, error } = useQuery({
    queryKey: [api.auth.me.path],
    queryFn: async () => {
      const res = await fetch(api.auth.me.path);
      if (res.status === 401) return null;
      if (!res.ok) throw new Error("Failed to fetch user");
      return (await res.json()) as SessionUser;
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const { loginMutation, logoutMutation } = useAuthMutation();
  const queryClient = useQueryClient();

  // The server answered 403 PASSWORD_CHANGE_REQUIRED: reload the user so the
  // forced change-password screen shows.
  useEffect(() => {
    const onRequired = () => queryClient.invalidateQueries({ queryKey: [api.auth.me.path] });
    window.addEventListener("pixely:password-change-required", onRequired);
    return () => window.removeEventListener("pixely:password-change-required", onRequired);
  }, [queryClient]);

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        error: error as Error | null,
        loginMutation,
        logoutMutation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
