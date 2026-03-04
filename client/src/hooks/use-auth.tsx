import { createContext, ReactNode, useContext } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User } from "@shared/schema";
import { api } from "@shared/routes";
import { useLocation } from "wouter";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";

type LoginData = z.infer<typeof api.auth.login.input>;

interface AuthContextType {
  user: User | null;
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
        if (res.status === 401) throw new Error("Invalid username or password");
        throw new Error("Login failed");
      }
      
      return api.auth.login.responses[200].parse(await res.json());
    },
    onSuccess: (user) => {
      queryClient.setQueryData([api.auth.me.path], user);
      toast({ title: "Welcome back", description: `Signed in as ${user.name}` });
      // Redirect based on role
      setLocation("/");
    },
    onError: (error: Error) => {
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
      return api.auth.me.responses[200].parse(await res.json());
    },
    retry: false,
  });

  const { loginMutation, logoutMutation } = useAuthMutation();

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
