import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { 
  ShoppingCart, 
  DollarSign, 
  ArrowUpRight,
  Clock,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Calendar,
  Users,
  Activity,
  FileWarning,
  ShieldAlert,
  ClipboardCheck,
  Star,
  MessageSquareHeart,
  Lightbulb
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isToday, startOfMonth } from "date-fns";
import type { OrderWithServices } from "@shared/schema";
import { getMillisecondsUntilNextBusinessDay } from "@shared/business-time";
import { getOrderAccounting } from "@shared/order-accounting";
import { DashboardSkeleton } from "@/components/PageSkeleton";

interface User {
  id: number;
  username: string;
  name: string;
  role: string;
  isActive: boolean;
}

interface DashboardStats {
  finance?: {
    todayCashFlow?: {
      advance: number;
      remaining: number;
      total: number;
    };
  };
  complaints?: {
    all: number;
    confirmed: number;
    dismissed: number;
    resolved: number;
    refund: number;
  };
}

interface FeedbackStats {
  reviews: { all: number; averageRating: number | null; whatsapp: number; facebook: number; video: number };
  suggestions: { all: number; new: number; implemented: number; rejected: number };
}

function ClientExperienceGrid({ stats, role, onOpenFeedback }: { stats?: FeedbackStats; role?: string; onOpenFeedback: (tab: "reviews" | "suggestions") => void }) {
  const reviewTitle = role === "designer" ? "Reviews Received" : role === "support" ? "Reviews Recorded" : "Reviews This Month";
  const suggestionTitle = role === "designer" ? "Related Suggestions" : role === "support" ? "Suggestions Recorded" : "Suggestions This Month";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquareHeart className="h-5 w-5 text-blue-400" />
        <h2 className="text-lg font-semibold text-white">Client Experience</h2>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title={reviewTitle} value={stats?.reviews.all ?? 0} icon={MessageSquareHeart} color="blue" testId="stat-feedback-reviews" onClick={() => onOpenFeedback("reviews")} />
        <StatCard title="Average Client Rating" value={stats?.reviews.averageRating == null ? "—" : `${stats.reviews.averageRating.toFixed(1)}/5`} icon={Star} color="orange" testId="stat-feedback-rating" onClick={() => onOpenFeedback("reviews")} />
        <StatCard title={suggestionTitle} value={stats?.suggestions.all ?? 0} icon={Lightbulb} color="purple" testId="stat-feedback-suggestions" onClick={() => onOpenFeedback("suggestions")} />
        <StatCard title="Implemented Suggestions" value={stats?.suggestions.implemented ?? 0} icon={ClipboardCheck} color="green" testId="stat-feedback-implemented" onClick={() => onOpenFeedback("suggestions")} />
      </div>
    </div>
  );
}

function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  trend, 
  color = "blue",
  testId,
  onClick
}: { 
  title: string; 
  value: string | number; 
  icon: any; 
  trend?: string;
  color?: "blue" | "green" | "purple" | "orange" | "red";
  testId?: string;
  onClick?: () => void;
}) {
  const colors = {
    blue: "bg-blue-500/10 text-blue-500",
    green: "bg-green-500/10 text-green-500",
    purple: "bg-purple-500/10 text-purple-500",
    orange: "bg-orange-500/10 text-orange-500",
    red: "bg-red-500/10 text-red-500",
  };

  return (
    <button type="button" onClick={onClick} className={`glass-panel w-full p-6 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition-colors text-left ${onClick ? "cursor-pointer" : ""}`} data-testid={testId}>
      <div className="flex justify-between items-start mb-4">
        <div className={cn("p-3 rounded-xl", colors[color])}>
          <Icon className="w-6 h-6" />
        </div>
        {trend && (
          <div className="flex items-center gap-1 text-xs font-medium text-green-400 bg-green-400/10 px-2 py-1 rounded-lg">
            <ArrowUpRight className="w-3 h-3" />
            {trend}
          </div>
        )}
      </div>
      <div>
        <p className="text-slate-400 text-sm font-medium mb-1">{title}</p>
        <h3 className="text-2xl font-bold font-display text-white">{value}</h3>
      </div>
      
      <div className={cn(
        "absolute -right-6 -bottom-6 w-24 h-24 rounded-full blur-2xl opacity-0 group-hover:opacity-20 transition-opacity",
        color === "blue" && "bg-blue-500",
        color === "green" && "bg-green-500",
        color === "purple" && "bg-purple-500",
        color === "orange" && "bg-orange-500",
        color === "red" && "bg-red-500",
      )} />
    </button>
  );
}

function CashFlowCard({
  total,
  advance,
  remaining,
}: {
  total: number;
  advance: number;
  remaining: number;
}) {
  const formatAmount = (amount: number) => `₨${Math.round(amount / 100).toLocaleString()}`;

  return (
    <div className="glass-panel p-6 rounded-2xl" data-testid="stat-today-cash-flow">
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-green-500/10 text-green-500">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-display text-white">Today's Cash Flow</h3>
            <p className="text-xs text-slate-500">Approved and received today</p>
          </div>
        </div>
        <span className="text-xl font-bold text-green-400">{formatAmount(total)}</span>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div className="flex items-center justify-between p-4 bg-slate-950/50 rounded-xl border border-slate-800">
          <p className="text-xs text-slate-400">Advance</p>
          <p className="font-bold text-white" data-testid="stat-today-cash-flow-advance">
            {formatAmount(advance)}
          </p>
        </div>
        <div className="flex items-center justify-between p-4 bg-slate-950/50 rounded-xl border border-slate-800">
          <p className="text-xs text-slate-400">Remaining</p>
          <p className="font-bold text-white" data-testid="stat-today-cash-flow-remaining">
            {formatAmount(remaining)}
          </p>
        </div>
      </div>
    </div>
  );
}

function ComplaintStatsGrid({
  stats,
  totalTitle,
}: {
  stats: NonNullable<DashboardStats["complaints"]> | undefined;
  totalTitle: string;
}) {
  const defaultOrder = ["all", "confirmed", "dismissed", "resolved", "refund"] as const;
  type ComplaintMetric = typeof defaultOrder[number];
  const values = stats ?? { all: 0, confirmed: 0, dismissed: 0, resolved: 0, refund: 0 };

  const metrics: Record<ComplaintMetric, {
    title: string;
    value: number;
    description: string;
    icon: typeof FileWarning;
    iconClass: string;
    valueClass: string;
  }> = {
    all: {
      title: totalTitle,
      value: values.all,
      description: "All complaints in the current dashboard view",
      icon: FileWarning,
      iconClass: "bg-red-500/10 text-red-400",
      valueClass: "text-red-300",
    },
    confirmed: {
      title: "Confirmed",
      value: values.confirmed,
      description: "Complaints confirmed for action",
      icon: ShieldAlert,
      iconClass: "bg-orange-500/10 text-orange-400",
      valueClass: "text-orange-300",
    },
    dismissed: {
      title: "Dismissed",
      value: values.dismissed,
      description: "Complaints closed without action",
      icon: XCircle,
      iconClass: "bg-slate-500/10 text-slate-400",
      valueClass: "text-slate-300",
    },
    resolved: {
      title: "Resolved",
      value: values.resolved,
      description: "Complaints completed by the team",
      icon: ClipboardCheck,
      iconClass: "bg-emerald-500/10 text-emerald-400",
      valueClass: "text-emerald-300",
    },
    refund: {
      title: "Refund",
      value: values.refund,
      description: "Closed complaints with a refund outcome",
      icon: DollarSign,
      iconClass: "bg-violet-500/10 text-violet-400",
      valueClass: "text-violet-300",
    },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FileWarning className="w-5 h-5 text-red-400" />
        <h2 className="text-lg font-semibold text-white">Complaint Overview</h2>
      </div>
      <div className="space-y-3">
        {defaultOrder.map((metricKey) => {
          const metric = metrics[metricKey];
          const Icon = metric.icon;
          return (
            <div
              key={metricKey}
              className="group relative flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4 transition-all hover:border-slate-700 hover:bg-slate-900/70"
              data-testid={`stat-complaints-${metricKey}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className={cn("rounded-lg p-2.5", metric.iconClass)}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-slate-200">{metric.title}</p>
                  <p className="truncate text-xs text-slate-500">{metric.description}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <p className={cn("text-2xl font-bold font-display", metric.valueClass)}>{metric.value}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const openFeedback = (tab: "reviews" | "suggestions") => setLocation(`/feedback?tab=${tab}`);
  
  const { data: orders, isLoading } = useQuery<OrderWithServices[]>({
    queryKey: ["/api/orders"],
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  });

  const { data: teamMembers } = useQuery<User[]>({
    queryKey: ["/api/users"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: dashboardStats, refetch: refetchDashboardStats } = useQuery<DashboardStats>({
    queryKey: ["/api/stats"],
    enabled: Boolean(user),
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  });

  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const { data: feedbackStats } = useQuery<FeedbackStats>({
    queryKey: [`/api/feedback/stats?month=${currentMonth}&year=${currentYear}`],
    enabled: Boolean(user),
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (user?.role !== "admin") return;

    let midnightTimer: number;
    const scheduleMidnightRefresh = () => {
      midnightTimer = window.setTimeout(() => {
        void refetchDashboardStats();
        scheduleMidnightRefresh();
      }, getMillisecondsUntilNextBusinessDay() + 250);
    };

    scheduleMidnightRefresh();
    return () => window.clearTimeout(midnightTimer);
  }, [refetchDashboardStats, user?.role]);

  if (isLoading) return <DashboardSkeleton />;

  const isAdmin = user?.role === "admin";
  const isSupport = user?.role === "support";
  const isDesigner = user?.role === "designer";

  // Filter orders for dashboard stats
  // Only approved orders are considered real orders — unapproved are ignored in all stats
  const now = new Date();
  const monthStart = startOfMonth(now);

  const approvedOrders = orders?.filter(o => o.advancePaymentStatus === 'approved') || [];

  // Stat card calculations — all based on approved orders only
  const todayOrders = approvedOrders.filter(o => isToday(new Date(o.createdAt!)));
  const monthlyOrders = approvedOrders.filter(o => new Date(o.createdAt!) >= monthStart);
  const pendingOrders = approvedOrders.filter(o => o.status === 'new' || o.status === 'working');
  const canceledOrders = approvedOrders.filter(o => o.status === 'canceled' && new Date(o.createdAt!) >= monthStart);
  const readyOrders = approvedOrders.filter(o => o.status === 'ready');
  const deliveredOrders = approvedOrders.filter(o => o.status === 'delivered');

  // Ready this month = approved orders created this month with Ready or Delivered status
  const readyThisMonth = approvedOrders.filter(o =>
    new Date(o.createdAt!) >= monthStart &&
    (o.status === 'ready' || o.status === 'delivered')
  );

  // Active Orders = approved orders that have NOT been canceled
  // Decreases dynamically when an order is canceled
  const activeOrders = approvedOrders.filter(o => o.status !== 'canceled');

  // Finance calculations (Admin only)
  // Total Collected = all advance amounts from approved orders (advance + any collected remaining)
  // Total Outstanding = remaining amounts from non-canceled approved orders only
  //   (canceled orders' remaining is excluded — not collected, not outstanding)
  const monthlyApprovedOrders = approvedOrders.filter(o => new Date(o.createdAt!) >= monthStart);

  const totalCollected = approvedOrders.reduce((acc, o) => acc + getOrderAccounting(o).netCollected, 0);
  const outstandingBalance = approvedOrders.reduce((acc, o) => acc + getOrderAccounting(o).remainingReceivable, 0);
  const monthlyCollected = monthlyApprovedOrders.reduce((acc, o) => acc + getOrderAccounting(o).netCollected, 0);
  const monthlyRemaining = monthlyApprovedOrders.reduce((acc, o) => acc + getOrderAccounting(o).remainingReceivable, 0);

  const todayCashFlow = dashboardStats?.finance?.todayCashFlow ?? {
    advance: 0,
    remaining: 0,
    total: 0,
  };

  // Designer Dashboard
  if (isDesigner) {
    return (
      <div className="p-8 space-y-8">
        <div>
          <h1 className="text-3xl font-bold font-display text-white mb-2">My Dashboard</h1>
          <p className="text-slate-400">Welcome back, {user?.name}. Here are your assigned orders.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard 
            title="Today's Orders" 
            value={todayOrders.length} 
            icon={Calendar} 
            color="blue"
            testId="stat-today-orders"
          />
          <StatCard 
            title="This Month's Orders" 
            value={monthlyOrders.length} 
            icon={ShoppingCart}
            color="purple"
            testId="stat-monthly-orders"
          />
          <StatCard 
            title="Pending Orders" 
            value={pendingOrders.length} 
            icon={Clock}
            color="orange"
            testId="stat-pending-orders"
          />
          <StatCard 
            title="Canceled Orders" 
            value={canceledOrders.length} 
            icon={XCircle}
            color="red"
            testId="stat-canceled-orders"
          />
        </div>

        <ClientExperienceGrid stats={feedbackStats} role={user?.role} onOpenFeedback={openFeedback} />
        <ComplaintStatsGrid stats={dashboardStats?.complaints} totalTitle="Complaints About Me" />

        <div className="glass-panel p-6 rounded-2xl">
          <h3 className="text-lg font-bold font-display text-white mb-4">Recent Assigned Orders</h3>
          {orders && orders.length > 0 ? (
            <div className="space-y-3">
              {orders.slice(0, 5).map(order => (
                <div key={order.id} className="flex items-center justify-between p-4 bg-slate-950/50 rounded-xl border border-slate-800">
                  <div>
                    <p className="font-mono text-sm text-blue-400">{order.orderNumber}</p>
                    <p className="text-white font-medium">{order.clientName}</p>
                  </div>
                  <div className="text-right">
                    <p className={cn(
                      "text-sm font-medium",
                      order.status === 'new' && "text-yellow-400",
                      order.status === 'working' && "text-blue-400",
                      order.status === 'ready' && "text-green-400",
                      order.status === 'delivered' && "text-slate-400",
                      order.status === 'canceled' && "text-red-400",
                    )}>
                      {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                    </p>
                    <p className="text-xs text-slate-500">{format(new Date(order.createdAt!), "MMM dd")}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-center py-8">No orders assigned to you yet.</p>
          )}
        </div>
      </div>
    );
  }

  // Support Dashboard
  if (isSupport) {
    return (
      <div className="p-8 space-y-8">
        <div>
          <h1 className="text-3xl font-bold font-display text-white mb-2">Support Dashboard</h1>
          <p className="text-slate-400">Welcome back, {user?.name}. Here's an overview of your orders.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard 
            title="Today's Orders" 
            value={todayOrders.length} 
            icon={Calendar} 
            color="blue"
            testId="stat-today-orders"
          />
          <StatCard 
            title="This Month's Orders" 
            value={monthlyOrders.length} 
            icon={ShoppingCart}
            color="purple"
            testId="stat-monthly-orders"
          />
          <StatCard 
            title="Pending Payment" 
            value={orders?.filter(o => o.paymentStatus === 'pending').length || 0} 
            icon={Clock}
            color="orange"
            testId="stat-pending-payment"
          />
          <StatCard 
            title="Canceled Orders" 
            value={canceledOrders.length} 
            icon={XCircle}
            color="red"
            testId="stat-canceled-orders"
          />
        </div>

        <ClientExperienceGrid stats={feedbackStats} role={user?.role} onOpenFeedback={openFeedback} />
        <ComplaintStatsGrid stats={dashboardStats?.complaints} totalTitle="Complaints Filed" />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-panel p-6 rounded-2xl">
            <h3 className="text-lg font-bold font-display text-white mb-4">Order Status Overview</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                <span className="text-slate-400">New</span>
                <span className="text-white font-bold">{orders?.filter(o => o.status === 'new').length || 0}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                <span className="text-slate-400">Working</span>
                <span className="text-white font-bold">{orders?.filter(o => o.status === 'working').length || 0}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                <span className="text-slate-400">Ready</span>
                <span className="text-white font-bold">{readyOrders.length}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                <span className="text-slate-400">Delivered</span>
                <span className="text-white font-bold">{deliveredOrders.length}</span>
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 rounded-2xl">
            <h3 className="text-lg font-bold font-display text-white mb-4">Payment Status</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span className="text-slate-400">Paid</span>
                </div>
                <span className="text-green-400 font-bold">{orders?.filter(o => o.paymentStatus === 'paid').length || 0}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <span className="text-slate-400">Pending</span>
                </div>
                <span className="text-yellow-400 font-bold">{orders?.filter(o => o.paymentStatus === 'pending').length || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Admin Dashboard (Full access)
  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold font-display text-white mb-2">Admin Dashboard</h1>
        <p className="text-slate-400">Welcome back, {user?.name}. Here's your complete business overview.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard 
          title="Today's Orders" 
          value={todayOrders.length} 
          icon={Calendar} 
          color="blue"
          testId="stat-today-orders"
        />
        <StatCard 
          title="Monthly Orders" 
          value={monthlyOrders.length} 
          icon={ShoppingCart}
          color="purple"
          testId="stat-monthly-orders"
        />
        <StatCard 
          title="Ready This Month" 
          value={readyThisMonth.length} 
          icon={CheckCircle2}
          color="green"
          testId="stat-ready-month"
        />
        <StatCard 
          title="Canceled This Month" 
          value={canceledOrders.length} 
          icon={XCircle}
          color="red"
          testId="stat-canceled-orders"
        />
        <StatCard 
          title="Pending Orders" 
          value={pendingOrders.length} 
          icon={Clock}
          color="orange"
          testId="stat-pending-orders"
        />
        <StatCard 
          title="Active Orders" 
          value={activeOrders.length} 
          icon={Activity}
          color="green"
          testId="stat-active-orders"
        />
      </div>

      <ClientExperienceGrid stats={feedbackStats} role={user?.role} onOpenFeedback={openFeedback} />
      <ComplaintStatsGrid stats={dashboardStats?.complaints} totalTitle="All Complaints" />

      {/* Finance Section - Admin Only */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass-panel p-6 rounded-2xl">
          <h3 className="text-lg font-bold font-display text-white mb-6">Designer Performance</h3>
          <div className="space-y-3">
            {(() => {
              const activeDesigners = teamMembers?.filter(u => u.role === "designer" && u.isActive) || [];
              if (activeDesigners.length === 0) return <p className="text-slate-500 text-center py-4">No designer data available</p>;
              return activeDesigners.map(designer => {
                const designerOrders = orders?.filter(o => o.assignedToId === designer.id) || [];
                const completedCount = designerOrders.filter(o => o.status === 'ready' || o.status === 'delivered').length;
                return (
                  <div key={designer.id} className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs text-white">
                        {designer.name.charAt(0)}
                      </div>
                      <span className="text-slate-300">{designer.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-bold">{completedCount}/{designerOrders.length}</p>
                      <p className="text-xs text-slate-500">completed</p>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
        <div className="glass-panel p-6 rounded-2xl">
          <h3 className="text-lg font-bold font-display text-white mb-6">Financial Summary</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-950/50 rounded-xl border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/10 rounded-lg text-green-500">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Total Collected</p>
                  <p className="font-bold text-white" data-testid="stat-total-collected">₨{Math.round(totalCollected / 100).toLocaleString()}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between p-4 bg-slate-950/50 rounded-xl border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Monthly Collection</p>
                  <p className="font-bold text-white" data-testid="stat-monthly-collected">₨{Math.round(monthlyCollected / 100).toLocaleString()}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between p-4 bg-slate-950/50 rounded-xl border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-500/10 rounded-lg text-red-500">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Monthly Remaining</p>
                  <p className="font-bold text-red-400" data-testid="stat-monthly-remaining">₨{Math.round(monthlyRemaining / 100).toLocaleString()}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between p-4 bg-slate-950/50 rounded-xl border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-500/10 rounded-lg text-orange-500">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Total Outstanding</p>
                  <p className="font-bold text-white" data-testid="stat-outstanding">₨{Math.round(outstandingBalance / 100).toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl">
          <h3 className="text-lg font-bold font-display text-white mb-6">Orders by Status</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
              <span className="text-yellow-400">New</span>
              <span className="text-white font-bold">{orders?.filter(o => o.status === 'new').length || 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
              <span className="text-blue-400">Working</span>
              <span className="text-white font-bold">{orders?.filter(o => o.status === 'working').length || 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
              <span className="text-green-400">Ready</span>
              <span className="text-white font-bold">{readyOrders.length}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
              <span className="text-slate-400">Delivered</span>
              <span className="text-white font-bold">{deliveredOrders.length}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
              <span className="text-red-400">Canceled</span>
              <span className="text-white font-bold">{canceledOrders.length}</span>
            </div>
          </div>
        </div>

        <CashFlowCard
          total={todayCashFlow.total}
          advance={todayCashFlow.advance}
          remaining={todayCashFlow.remaining}
        />
      </div>
    </div>
  );
}
