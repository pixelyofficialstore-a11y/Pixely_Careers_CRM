import { useQuery } from "@tanstack/react-query";
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
  Activity
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isToday, startOfMonth } from "date-fns";
import type { OrderWithServices } from "@shared/schema";

function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  trend, 
  color = "blue",
  testId
}: { 
  title: string; 
  value: string | number; 
  icon: any; 
  trend?: string;
  color?: "blue" | "green" | "purple" | "orange" | "red";
  testId?: string;
}) {
  const colors = {
    blue: "bg-blue-500/10 text-blue-500",
    green: "bg-green-500/10 text-green-500",
    purple: "bg-purple-500/10 text-purple-500",
    orange: "bg-orange-500/10 text-orange-500",
    red: "bg-red-500/10 text-red-500",
  };

  return (
    <div className="glass-panel p-6 rounded-2xl relative overflow-hidden group hover:border-slate-700 transition-colors" data-testid={testId}>
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
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  
  const { data: orders, isLoading } = useQuery<OrderWithServices[]>({
    queryKey: ["/api/orders"],
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  });

  if (isLoading) return null;

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

  const nonCanceledApproved = approvedOrders.filter(o => o.status !== 'canceled');
  const totalCollected = approvedOrders.reduce((acc, o) => acc + (o.advanceAmount || 0), 0);
  const outstandingBalance = nonCanceledApproved.reduce((acc, o) => acc + (o.remainingAmount || 0), 0);
  const monthlyCollected = monthlyApprovedOrders.reduce((acc, o) => acc + (o.advanceAmount || 0), 0);
  const monthlyRemaining = monthlyApprovedOrders
    .filter(o => o.status !== 'canceled')
    .reduce((acc, o) => acc + (o.remainingAmount || 0), 0);

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

      {/* Finance Section - Admin Only */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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

        <div className="glass-panel p-6 rounded-2xl">
          <h3 className="text-lg font-bold font-display text-white mb-6">Designer Performance</h3>
          <div className="space-y-3">
            {orders && orders.length > 0 ? (
              Array.from(new Set(orders.filter(o => o.assignee).map(o => o.assignee?.id))).slice(0, 5).map(designerId => {
                const designer = orders.find(o => o.assignee?.id === designerId)?.assignee;
                const designerOrders = orders.filter(o => o.assignedToId === designerId);
                const completedCount = designerOrders.filter(o => o.status === 'ready' || o.status === 'delivered').length;
                return (
                  <div key={designerId} className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs text-white">
                        {designer?.name?.charAt(0) || "?"}
                      </div>
                      <span className="text-slate-300">{designer?.name || "Unknown"}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-bold">{completedCount}/{designerOrders.length}</p>
                      <p className="text-xs text-slate-500">completed</p>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-slate-500 text-center py-4">No designer data available</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
