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
  Sparkles,
  Activity
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isToday, startOfMonth } from "date-fns";
import type { OrderWithServices } from "@shared/schema";
import { motion } from "framer-motion";

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
};

const colorMap = {
  blue:   { bg: "hsla(221,83%,53%,0.08)", border: "hsla(221,83%,53%,0.2)", icon: "hsla(221,83%,53%,0.15)", text: "#60a5fa", glow: "hsla(221,83%,53%,0.15)" },
  green:  { bg: "hsla(142,76%,36%,0.08)", border: "hsla(142,76%,36%,0.2)", icon: "hsla(142,76%,36%,0.15)", text: "#4ade80", glow: "hsla(142,76%,36%,0.15)" },
  purple: { bg: "hsla(263,70%,50%,0.08)", border: "hsla(263,70%,50%,0.2)", icon: "hsla(263,70%,50%,0.15)", text: "#a78bfa", glow: "hsla(263,70%,50%,0.15)" },
  orange: { bg: "hsla(25,95%,53%,0.08)",  border: "hsla(25,95%,53%,0.2)",  icon: "hsla(25,95%,53%,0.15)",  text: "#fb923c", glow: "hsla(25,95%,53%,0.15)"  },
  red:    { bg: "hsla(0,62%,50%,0.08)",   border: "hsla(0,62%,50%,0.2)",   icon: "hsla(0,62%,50%,0.15)",   text: "#f87171", glow: "hsla(0,62%,50%,0.15)"   },
  cyan:   { bg: "hsla(199,89%,48%,0.08)", border: "hsla(199,89%,48%,0.2)", icon: "hsla(199,89%,48%,0.15)", text: "#38bdf8", glow: "hsla(199,89%,48%,0.15)" },
};

function StatCard({ title, value, icon: Icon, trend, color = "blue", testId }: {
  title: string;
  value: string | number;
  icon: any;
  trend?: string;
  color?: keyof typeof colorMap;
  testId?: string;
}) {
  const c = colorMap[color];

  return (
    <motion.div
      variants={itemVariants}
      className="relative rounded-2xl p-5 overflow-hidden group cursor-default"
      style={{
        background: `linear-gradient(135deg, hsla(222,47%,13%,0.9) 0%, hsla(222,47%,10%,0.95) 100%)`,
        border: `1px solid ${c.border}`,
        boxShadow: `0 4px 24px -8px hsla(222,47%,4%,0.5), 0 0 0 1px hsla(217,33%,20%,0.2)`,
      }}
      whileHover={{ 
        y: -3,
        boxShadow: `0 8px 32px -8px hsla(222,47%,4%,0.6), 0 0 0 1px ${c.border}, 0 0 20px ${c.glow}`,
        transition: { duration: 0.2, ease: "easeOut" }
      }}
      data-testid={testId}
    >
      {/* Background glow on hover */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl"
        style={{ background: `radial-gradient(ellipse at top right, ${c.glow}, transparent 60%)` }} />

      <div className="relative flex justify-between items-start mb-4">
        <div className="p-2.5 rounded-xl" style={{ background: c.icon, border: `1px solid ${c.border}` }}>
          <Icon className="w-5 h-5" style={{ color: c.text }} />
        </div>
        {trend && (
          <div className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg"
            style={{ background: "hsla(142,76%,36%,0.1)", color: "#4ade80", border: "1px solid hsla(142,76%,36%,0.2)" }}>
            <ArrowUpRight className="w-3 h-3" />
            {trend}
          </div>
        )}
      </div>

      <div className="relative">
        <p className="text-slate-400 text-xs font-medium mb-1.5 uppercase tracking-wide">{title}</p>
        <h3 className="text-3xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>{value}</h3>
      </div>
    </motion.div>
  );
}

function SectionCard({ title, icon: Icon, children, className }: {
  title: string;
  icon?: any;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={itemVariants}
      className={cn("rounded-2xl overflow-hidden", className)}
      style={{
        background: "linear-gradient(135deg, hsla(222,47%,13%,0.9) 0%, hsla(222,47%,10%,0.95) 100%)",
        border: "1px solid hsla(217,33%,22%,0.4)",
        boxShadow: "0 4px 24px -8px hsla(222,47%,4%,0.5)",
      }}
    >
      <div className="px-6 py-4 border-b border-slate-800/50 flex items-center gap-2.5">
        {Icon && <Icon className="w-4 h-4 text-slate-400" />}
        <h3 className="font-semibold text-white text-sm" style={{ fontFamily: "var(--font-display)" }}>{title}</h3>
      </div>
      <div className="p-6">{children}</div>
    </motion.div>
  );
}

function StatusRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl transition-colors hover:bg-slate-800/30"
      style={{ border: "1px solid transparent" }}>
      <div className="flex items-center gap-2.5">
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}60` }} />
        <span className="text-slate-400 text-sm">{label}</span>
      </div>
      <span className="text-white font-bold text-sm">{value}</span>
    </div>
  );
}

function FinanceRow({ label, value, color = "text-white", icon: Icon, iconBg }: {
  label: string;
  value: string;
  color?: string;
  icon: any;
  iconBg: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3.5 rounded-xl hover:bg-slate-800/30 transition-colors">
      <div className="p-2 rounded-lg flex-shrink-0" style={{ background: iconBg }}>
        <Icon className="w-4 h-4" style={{ color: iconBg.includes("green") ? "#4ade80" : iconBg.includes("blue") ? "#60a5fa" : iconBg.includes("red") ? "#f87171" : "#fb923c" }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500 mb-0.5">{label}</p>
        <p className={cn("font-bold text-sm", color)}>{value}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  
  const { data: orders, isLoading } = useQuery<OrderWithServices[]>({
    queryKey: ["/api/orders"],
  });

  const isAdmin = user?.role === "admin";
  const isSupport = user?.role === "support";
  const isDesigner = user?.role === "designer";

  const now = new Date();
  const monthStart = startOfMonth(now);
  
  const approvedOrders = orders?.filter(o => o.advancePaymentStatus === 'approved') || [];
  const todayOrders = approvedOrders.filter(o => isToday(new Date(o.createdAt!)));
  const monthlyOrders = approvedOrders.filter(o => new Date(o.createdAt!) >= monthStart);
  const pendingOrders = approvedOrders.filter(o => o.status === 'new' || o.status === 'working');
  const canceledOrders = approvedOrders.filter(o => o.status === 'canceled');
  const readyOrders = approvedOrders.filter(o => o.status === 'ready');
  const deliveredOrders = approvedOrders.filter(o => o.status === 'delivered');
  
  const monthlyApprovedOrders = approvedOrders.filter(o => new Date(o.createdAt!) >= monthStart);
  const totalCollected = approvedOrders.reduce((acc, o) => acc + (o.advanceAmount || 0), 0);
  const outstandingBalance = approvedOrders.reduce((acc, o) => acc + (o.remainingAmount || 0), 0);
  const monthlyCollected = monthlyApprovedOrders.reduce((acc, o) => acc + (o.advanceAmount || 0), 0);
  const monthlyRemaining = monthlyApprovedOrders.reduce((acc, o) => acc + (o.remainingAmount || 0), 0);
  const readyThisMonth = approvedOrders.filter(o => 
    new Date(o.createdAt!) >= monthStart && (o.status === 'ready' || o.status === 'delivered')
  );

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <div className="h-8 w-64 rounded-xl shimmer" />
        <div className="h-4 w-80 rounded-xl shimmer" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 rounded-2xl shimmer" />
          ))}
        </div>
      </div>
    );
  }

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  // === DESIGNER DASHBOARD ===
  if (isDesigner) {
    const myOrders = orders?.filter(o => o.assignedToId === user?.id) || [];
    const myPending = myOrders.filter(o => o.status === 'new' || o.status === 'working');
    const myCompleted = myOrders.filter(o => o.status === 'ready' || o.status === 'delivered');

    return (
      <div className="p-6 lg:p-8 space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-violet-400" />
            <span className="text-violet-400 text-sm font-medium">{greeting()}</span>
          </div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>
            {user?.name}'s Dashboard
          </h1>
          <p className="text-slate-400 text-sm mt-1">Here's what's happening with your orders today.</p>
        </motion.div>

        <motion.div
          className="grid grid-cols-2 lg:grid-cols-4 gap-4"
          variants={containerVariants}
          initial="hidden"
          animate="show"
        >
          <StatCard title="Today's Orders" value={todayOrders.length} icon={Calendar} color="blue" testId="stat-today-orders" />
          <StatCard title="Monthly Orders" value={monthlyOrders.length} icon={ShoppingCart} color="purple" testId="stat-monthly-orders" />
          <StatCard title="Active Orders" value={myPending.length} icon={Clock} color="orange" testId="stat-pending-orders" />
          <StatCard title="Completed" value={myCompleted.length} icon={CheckCircle2} color="green" />
        </motion.div>

        <motion.div variants={containerVariants} initial="hidden" animate="show">
          <SectionCard title="My Assigned Orders" icon={Activity}>
            {myOrders.length > 0 ? (
              <div className="space-y-2">
                {myOrders.slice(0, 8).map((order, i) => (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center justify-between p-3.5 rounded-xl transition-colors hover:bg-slate-800/40"
                    style={{ border: "1px solid hsla(217,33%,20%,0.3)" }}
                  >
                    <div>
                      <p className="font-mono text-xs font-semibold" style={{ color: "#60a5fa" }}>{order.orderNumber}</p>
                      <p className="text-white text-sm font-medium mt-0.5">{order.clientName}</p>
                    </div>
                    <div className="text-right">
                      <StatusBadge status={order.status} />
                      <p className="text-xs text-slate-500 mt-1">{format(new Date(order.createdAt!), "MMM dd")}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center">
                <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: "hsla(263,70%,50%,0.1)" }}>
                  <CheckCircle2 className="w-6 h-6 text-violet-400" />
                </div>
                <p className="text-slate-400 text-sm">No orders assigned to you yet</p>
              </div>
            )}
          </SectionCard>
        </motion.div>
      </div>
    );
  }

  // === SUPPORT DASHBOARD ===
  if (isSupport) {
    return (
      <div className="p-6 lg:p-8 space-y-6">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-sky-400" />
            <span className="text-sky-400 text-sm font-medium">{greeting()}</span>
          </div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>Support Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">Welcome back, {user?.name}. Here's your daily overview.</p>
        </motion.div>

        <motion.div className="grid grid-cols-2 lg:grid-cols-4 gap-4" variants={containerVariants} initial="hidden" animate="show">
          <StatCard title="Today's Orders" value={todayOrders.length} icon={Calendar} color="blue" testId="stat-today-orders" />
          <StatCard title="Monthly Orders" value={monthlyOrders.length} icon={ShoppingCart} color="purple" testId="stat-monthly-orders" />
          <StatCard title="Pending Payment" value={orders?.filter(o => o.paymentStatus === 'pending').length || 0} icon={Clock} color="orange" testId="stat-pending-payment" />
          <StatCard title="Canceled" value={canceledOrders.length} icon={XCircle} color="red" testId="stat-canceled-orders" />
        </motion.div>

        <motion.div className="grid grid-cols-1 lg:grid-cols-2 gap-4" variants={containerVariants} initial="hidden" animate="show">
          <SectionCard title="Order Status" icon={Activity}>
            <div className="space-y-1">
              <StatusRow label="New" value={orders?.filter(o => o.status === 'new').length || 0} color="#facc15" />
              <StatusRow label="Working" value={orders?.filter(o => o.status === 'working').length || 0} color="#60a5fa" />
              <StatusRow label="Ready" value={readyOrders.length} color="#4ade80" />
              <StatusRow label="Delivered" value={deliveredOrders.length} color="#94a3b8" />
              <StatusRow label="Canceled" value={canceledOrders.length} color="#f87171" />
            </div>
          </SectionCard>

          <SectionCard title="Payment Status" icon={DollarSign}>
            <div className="space-y-1">
              <StatusRow label="Paid" value={orders?.filter(o => o.paymentStatus === 'paid').length || 0} color="#4ade80" />
              <StatusRow label="Pending" value={orders?.filter(o => o.paymentStatus === 'pending').length || 0} color="#facc15" />
              <StatusRow label="Partial" value={orders?.filter(o => o.paymentStatus === 'partial').length || 0} color="#60a5fa" />
            </div>
          </SectionCard>
        </motion.div>
      </div>
    );
  }

  // === ADMIN DASHBOARD ===
  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span className="text-amber-400 text-sm font-medium">{greeting()}</span>
        </div>
        <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>Admin Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">Welcome back, {user?.name}. Here's your complete business overview.</p>
      </motion.div>

      {/* Stats row */}
      <motion.div
        className="grid grid-cols-2 lg:grid-cols-5 gap-4"
        variants={containerVariants}
        initial="hidden"
        animate="show"
      >
        <StatCard title="Today's Orders" value={todayOrders.length} icon={Calendar} color="blue" testId="stat-today-orders" />
        <StatCard title="Monthly Orders" value={monthlyOrders.length} icon={ShoppingCart} color="purple" testId="stat-monthly-orders" />
        <StatCard title="Ready This Month" value={readyThisMonth.length} icon={CheckCircle2} color="green" testId="stat-ready-month" />
        <StatCard title="Canceled" value={canceledOrders.length} icon={XCircle} color="red" testId="stat-canceled-orders" />
        <StatCard title="Active Orders" value={pendingOrders.length} icon={Clock} color="orange" testId="stat-pending-orders" />
      </motion.div>

      {/* Details Section */}
      <motion.div
        className="grid grid-cols-1 lg:grid-cols-3 gap-4"
        variants={containerVariants}
        initial="hidden"
        animate="show"
      >
        {/* Financial Summary */}
        <SectionCard title="Financial Summary" icon={DollarSign}>
          <div className="space-y-1">
            <FinanceRow
              label="Total Collected"
              value={`₨${(totalCollected / 100).toLocaleString()}`}
              color="text-green-400"
              icon={DollarSign}
              iconBg="hsla(142,76%,36%,0.1)"
            />
            <FinanceRow
              label="Monthly Collection"
              value={`₨${(monthlyCollected / 100).toLocaleString()}`}
              icon={TrendingUp}
              iconBg="hsla(221,83%,53%,0.1)"
              color="text-blue-400"
            />
            <FinanceRow
              label="Monthly Remaining"
              value={`₨${(monthlyRemaining / 100).toLocaleString()}`}
              icon={Clock}
              iconBg="hsla(0,62%,50%,0.1)"
              color="text-red-400"
            />
            <FinanceRow
              label="Total Outstanding"
              value={`₨${(outstandingBalance / 100).toLocaleString()}`}
              icon={Clock}
              iconBg="hsla(25,95%,53%,0.1)"
              color="text-orange-400"
            />
          </div>
        </SectionCard>

        {/* Orders by Status */}
        <SectionCard title="Orders by Status" icon={Activity}>
          <div className="space-y-1">
            <StatusRow label="New" value={orders?.filter(o => o.status === 'new').length || 0} color="#facc15" />
            <StatusRow label="Working" value={orders?.filter(o => o.status === 'working').length || 0} color="#60a5fa" />
            <StatusRow label="Ready" value={readyOrders.length} color="#4ade80" />
            <StatusRow label="Delivered" value={deliveredOrders.length} color="#94a3b8" />
            <StatusRow label="Canceled" value={canceledOrders.length} color="#f87171" />
          </div>

          {/* Visual bar */}
          {orders && orders.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-800/50">
              <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
                {[
                  { status: 'new', color: '#facc15' },
                  { status: 'working', color: '#60a5fa' },
                  { status: 'ready', color: '#4ade80' },
                  { status: 'delivered', color: '#94a3b8' },
                  { status: 'canceled', color: '#f87171' },
                ].map(({ status, color }) => {
                  const count = orders.filter(o => o.status === status).length;
                  const pct = orders.length ? (count / orders.length) * 100 : 0;
                  return pct > 0 ? (
                    <motion.div
                      key={status}
                      className="h-full rounded-full"
                      style={{ backgroundColor: color, width: `${pct}%` }}
                      initial={{ scaleX: 0, originX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
                    />
                  ) : null;
                })}
              </div>
            </div>
          )}
        </SectionCard>

        {/* Designer Performance */}
        <SectionCard title="Designer Performance" icon={Users}>
          <div className="space-y-2">
            {orders && orders.length > 0 ? (
              Array.from(new Set(orders.filter(o => o.assignee).map(o => o.assignee?.id))).slice(0, 5).map((designerId, i) => {
                const designer = orders.find(o => o.assignee?.id === designerId)?.assignee;
                const designerOrders = orders.filter(o => o.assignedToId === designerId);
                const completedCount = designerOrders.filter(o => o.status === 'ready' || o.status === 'delivered').length;
                const pct = designerOrders.length ? Math.round((completedCount / designerOrders.length) * 100) : 0;
                const initial = designer?.name?.charAt(0) || "?";

                return (
                  <motion.div
                    key={designerId}
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-800/30 transition-colors"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 + i * 0.06 }}
                  >
                    <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)" }}>
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-slate-300 truncate font-medium">{designer?.name || "Unknown"}</span>
                        <span className="text-xs text-slate-500 ml-2 flex-shrink-0">{completedCount}/{designerOrders.length}</span>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: "hsla(217,33%,20%,0.5)" }}>
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: pct >= 70 ? "#4ade80" : pct >= 40 ? "#60a5fa" : "#fb923c" }}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 + i * 0.05 }}
                        />
                      </div>
                    </div>
                  </motion.div>
                );
              })
            ) : (
              <div className="py-8 text-center">
                <p className="text-slate-500 text-sm">No designer data available</p>
              </div>
            )}
          </div>
        </SectionCard>
      </motion.div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; bg: string; label: string }> = {
    new:             { color: "#facc15", bg: "hsla(50,95%,60%,0.1)",  label: "New" },
    working:         { color: "#60a5fa", bg: "hsla(221,83%,53%,0.1)", label: "Working" },
    ready:           { color: "#4ade80", bg: "hsla(142,76%,36%,0.1)", label: "Ready" },
    delivered:       { color: "#94a3b8", bg: "hsla(215,20%,65%,0.1)", label: "Delivered" },
    canceled:        { color: "#f87171", bg: "hsla(0,62%,50%,0.1)",   label: "Canceled" },
    pending_payment: { color: "#fb923c", bg: "hsla(25,95%,53%,0.1)",  label: "Pending" },
  };

  const c = config[status] || config.new;

  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-lg"
      style={{ color: c.color, background: c.bg }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
      {c.label}
    </span>
  );
}
