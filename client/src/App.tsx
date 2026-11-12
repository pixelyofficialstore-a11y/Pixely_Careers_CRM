import { lazy, Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import ChangePasswordScreen from "@/components/ChangePasswordScreen";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/Layout";
import { Loader2 } from "lucide-react";
import { ThemeProvider } from "@/lib/theme";

const AuthPage = lazy(() => import("@/pages/AuthPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const OrdersPage = lazy(() => import("@/pages/OrdersPage"));
const TeamPage = lazy(() => import("@/pages/TeamPage"));
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage"));
const PaymentsPage = lazy(() => import("@/pages/PaymentsPage"));
const AdminSettingsPage = lazy(() => import("@/pages/AdminSettingsPage"));
const ComplaintsPage = lazy(() => import("@/pages/ComplaintsPage"));
const FeedbackPage = lazy(() => import("@/pages/FeedbackPage"));
const WebsiteRequestsPage = lazy(() => import("@/pages/WebsiteRequestsPage"));
const ClientsPage = lazy(() => import("@/pages/ClientsPage"));
const BoardPage = lazy(() => import("@/pages/BoardPage"));
const NotificationSettingsPage = lazy(() => import("@/pages/NotificationSettingsPage"));

// Heavy pages (Orders, Analytics charts, ...) are code-split and loaded on first visit.
function PageSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/auth" />;
  }

  if (user.mustChangePassword) {
    return <ChangePasswordScreen />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/auth">
        {(params) => <PageSuspense><AuthPage /></PageSuspense>}
      </Route>
      <Route path="/">
        <ProtectedRoute>
          <Layout>
            <PageSuspense><DashboardPage /></PageSuspense>
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/orders">
        <ProtectedRoute>
          <Layout>
            <PageSuspense><OrdersPage /></PageSuspense>
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/board">
        <ProtectedRoute>
          <Layout>
            <PageSuspense><BoardPage /></PageSuspense>
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/clients/:key?">
        <ProtectedRoute>
          <Layout>
            <PageSuspense><ClientsPage /></PageSuspense>
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/website-requests">
        <ProtectedRoute>
          <Layout>
            <PageSuspense><WebsiteRequestsPage /></PageSuspense>
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/complaints/:id">
        <ProtectedRoute>
          <Layout>
            <PageSuspense><ComplaintsPage /></PageSuspense>
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/complaints">
        <ProtectedRoute>
          <Layout>
            <PageSuspense><ComplaintsPage /></PageSuspense>
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/feedback">
        <ProtectedRoute>
          <Layout>
            <PageSuspense><FeedbackPage /></PageSuspense>
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/payments">
        <ProtectedRoute>
          <Layout>
            <PageSuspense><PaymentsPage /></PageSuspense>
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/users">
        <ProtectedRoute>
          <Layout>
            <PageSuspense><TeamPage /></PageSuspense>
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/stats">
        <ProtectedRoute>
          <Layout>
            <PageSuspense><AnalyticsPage /></PageSuspense>
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/settings/notifications">
        <ProtectedRoute>
          <Layout>
            <PageSuspense><NotificationSettingsPage /></PageSuspense>
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin-settings">
        <ProtectedRoute>
          <Layout>
            <PageSuspense><AdminSettingsPage /></PageSuspense>
          </Layout>
        </ProtectedRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function ThemedApp() {
  const { user } = useAuth();
  return (
    <ThemeProvider userId={user?.id ?? null}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </ThemeProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemedApp />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
