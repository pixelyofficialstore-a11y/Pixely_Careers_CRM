import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/AuthPage";
import DashboardPage from "@/pages/DashboardPage";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/Layout";
import { Loader2 } from "lucide-react";

import OrdersPage from "@/pages/OrdersPage";
import TeamPage from "@/pages/TeamPage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import PaymentsPage from "@/pages/PaymentsPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/auth" />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/auth">
        {(params) => <AuthPage />}
      </Route>
      <Route path="/">
        <ProtectedRoute>
          <Layout>
            <DashboardPage />
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/orders">
        <ProtectedRoute>
          <Layout>
            <OrdersPage />
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/payments">
        <ProtectedRoute>
          <Layout>
            <PaymentsPage />
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/users">
        <ProtectedRoute>
          <Layout>
            <TeamPage />
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/stats">
        <ProtectedRoute>
          <Layout>
            <AnalyticsPage />
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
