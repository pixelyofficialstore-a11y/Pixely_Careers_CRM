import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  ShoppingCart,
  DollarSign,
  Clock,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Calendar,
  Users,
  Activity,
} from "lucide-react";
import { format, isToday, startOfMonth } from "date-fns";
import type { OrderWithServices } from "@shared/schema";

/* ── Stat Card ──────────────────────────────────────────────────── */
function StatCard({
  title,
  value,
  icon: Icon,
  accent = "#2563eb",
  testId,
}: {
  title: string;
  value: string | number;
  icon: any;
  accent?: string;
  testId?: string;
}) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
      }}
      data-testid={testId}
    >
      <div className="flex items-center justify-between mb-4">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${accent}18` }}
        >
          <Icon className="w-4 h-4" style={{ color: accent }} />
        </div>
      </div>
      <p className="text-2xl font-semibold text-white mb-1">{value}</p>
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        {title}
      </p>
    </div>
  );
}

/* ── Section Panel ──────────────────────────────────────────────── */
function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: any;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
      }}
    >
      <div
        className="flex items-center gap-2 px-5 py-3.5"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        {Icon && (
          <Icon className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />
        )}
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ── Status Row ─────────────────────────────────────────────────── */
function StatusRow({
  label,
  value,
  dot,
}: {
  label: string;
  value: number;
  dot: string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
        <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {label}
        </span>
      </div>
      <span className="text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

/* ── Finance Row ────────────────────────────────────────────────── */
function FinanceRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
      <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <span className="text-sm font-semibold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

/* ── Status Badge ───────────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    new:       { color: "#eab308", bg: "rgba(234,179,8,0.12)",   label: "New" },
    working:   { color: "#3b82f6", bg: "rgba(59,130,246,0.12)",  label: "Working" },
    ready:     { color: "#22c55e", bg: "rgba(34,197,94,0.12)",   label: "Ready" },
    delivered: { color: "#94a3b8", bg: "rgba(148,163,184,0.12)", label: "Delivered" },
    canceled:  { color: "#ef4444", bg: "rgba(239,68,68,0.12)",   label: "Canceled" },
  };
  const c = map[status] || map.new;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md"
      style={{ color: c.color, background: c.bg }}
    >
      {c.label}
    </span>
  );
}

/* ── Page ───────────────────────────────────────────────────────── */
export default function DashboardPage() {
  const { user } = useAuth();

  const { data: orders, isLoading } = useQuery<OrderWithServices[]>({
    queryKey: ["/api/orders"],
  });

  const isAdmin    = user?.role === "admin";
  const isSupport  = user?.role === "support";
  const isDesigner = user?.role === "designer";

  const now        = new Date();
  const monthStart = startOfMonth(now);

  const approvedOrders   = orders?.filter(o => o.advancePaymentStatus === "approved") || [];
  const todayOrders      = approvedOrders.filter(o => isToday(new Date(o.createdAt!)));
  const monthlyOrders    = approvedOrders.filter(o => new Date(o.createdAt!) >= monthStart);
  const pendingOrders    = approvedOrders.filter(o => o.status === "new" || o.status === "working");
  const canceledOrders   = approvedOrders.filter(o => o.status === "canceled");
  const readyOrders      = approvedOrders.filter(o => o.status === "ready");
  const deliveredOrders  = approvedOrders.filter(o => o.status === "delivered");
  const readyThisMonth   = approvedOrders.filter(
    o => new Date(o.createdAt!) >= monthStart && (o.status === "ready" || o.status === "delivered")
  );

  const totalCollected   = approvedOrders.reduce((s, o) => s + (o.advanceAmount || 0), 0);
  const outstandingBalance = approvedOrders.reduce((s, o) => s + (o.remainingAmount || 0), 0);
  const monthlyApproved  = approvedOrders.filter(o => new Date(o.createdAt!) >= monthStart);
  const monthlyCollected = monthlyApproved.reduce((s, o) => s + (o.advanceAmount || 0), 0);
  const monthlyRemaining = monthlyApproved.reduce((s, o) => s + (o.remainingAmount || 0), 0);

  const greeting = () => {
    const h = now.getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 space-y-6">
        <div className="h-8 w-52 rounded-lg skeleton" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl skeleton" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-48 rounded-xl skeleton" />
          ))}
        </div>
      </div>
    );
  }

  /* ── DESIGNER ── */
  if (isDesigner) {
    const myOrders    = orders?.filter(o => o.assignedToId === user?.id) || [];
    const myActive    = myOrders.filter(o => o.status === "new" || o.status === "working");
    const myCompleted = myOrders.filter(o => o.status === "ready" || o.status === "delivered");

    return (
      <div className="p-6 lg:p-8 space-y-6">
        <div>
          <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
            {greeting()}
          </p>
          <h1 className="text-xl font-semibold text-white">{user?.name}</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
            Here's what's on your plate today.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Today's Orders"  value={todayOrders.length}  icon={Calendar}      accent="#2563eb" testId="stat-today-orders" />
          <StatCard title="Monthly Orders"  value={monthlyOrders.length} icon={ShoppingCart}  accent="#7c3aed" testId="stat-monthly-orders" />
          <StatCard title="Active"          value={myActive.length}      icon={Clock}         accent="#d97706" testId="stat-pending-orders" />
          <StatCard title="Completed"       value={myCompleted.length}   icon={CheckCircle2}  accent="#16a34a" />
        </div>

        <Panel title="My Assigned Orders" icon={Activity}>
          {myOrders.length > 0 ? (
            <div className="space-y-1">
              {myOrders.slice(0, 10).map(order => (
                <div
                  key={order.id}
                  className="flex items-center justify-between py-2.5 border-b last:border-b-0"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <div>
                    <p className="text-xs font-mono font-medium" style={{ color: "#60a5fa" }}>
                      {order.orderNumber}
                    </p>
                    <p className="text-sm text-white mt-0.5">{order.clientName}</p>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={order.status} />
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      {format(new Date(order.createdAt!), "MMM dd")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }}>
              No orders assigned to you yet.
            </p>
          )}
        </Panel>
      </div>
    );
  }

  /* ── SUPPORT ── */
  if (isSupport) {
    return (
      <div className="p-6 lg:p-8 space-y-6">
        <div>
          <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
            {greeting()}
          </p>
          <h1 className="text-xl font-semibold text-white">Support Dashboard</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
            Welcome back, {user?.name}.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Today's Orders"   value={todayOrders.length}                                         icon={Calendar}     accent="#2563eb" testId="stat-today-orders" />
          <StatCard title="Monthly Orders"   value={monthlyOrders.length}                                       icon={ShoppingCart} accent="#7c3aed" testId="stat-monthly-orders" />
          <StatCard title="Pending Payment"  value={orders?.filter(o => o.paymentStatus === "pending").length || 0} icon={Clock}    accent="#d97706" testId="stat-pending-payment" />
          <StatCard title="Canceled"         value={canceledOrders.length}                                      icon={XCircle}      accent="#dc2626" testId="stat-canceled-orders" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel title="Order Status" icon={Activity}>
            <StatusRow label="New"       value={orders?.filter(o => o.status === "new").length || 0} dot="#eab308" />
            <StatusRow label="Working"   value={orders?.filter(o => o.status === "working").length || 0} dot="#3b82f6" />
            <StatusRow label="Ready"     value={readyOrders.length}     dot="#22c55e" />
            <StatusRow label="Delivered" value={deliveredOrders.length} dot="#94a3b8" />
            <StatusRow label="Canceled"  value={canceledOrders.length}  dot="#ef4444" />
          </Panel>

          <Panel title="Payment Status" icon={DollarSign}>
            <StatusRow label="Paid"    value={orders?.filter(o => o.paymentStatus === "paid").length || 0}    dot="#22c55e" />
            <StatusRow label="Pending" value={orders?.filter(o => o.paymentStatus === "pending").length || 0} dot="#eab308" />
            <StatusRow label="Partial" value={orders?.filter(o => o.paymentStatus === "partial").length || 0} dot="#3b82f6" />
          </Panel>
        </div>
      </div>
    );
  }

  /* ── ADMIN ── */
  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
          {greeting()}
        </p>
        <h1 className="text-xl font-semibold text-white">Admin Dashboard</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
          Welcome back, {user?.name}. Here's your business overview.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="Today's Orders"    value={todayOrders.length}     icon={Calendar}     accent="#2563eb" testId="stat-today-orders" />
        <StatCard title="Monthly Orders"    value={monthlyOrders.length}   icon={ShoppingCart} accent="#7c3aed" testId="stat-monthly-orders" />
        <StatCard title="Ready This Month"  value={readyThisMonth.length}  icon={CheckCircle2} accent="#16a34a" testId="stat-ready-month" />
        <StatCard title="Canceled"          value={canceledOrders.length}  icon={XCircle}      accent="#dc2626" testId="stat-canceled-orders" />
        <StatCard title="Active Orders"     value={pendingOrders.length}   icon={Clock}        accent="#d97706" testId="stat-pending-orders" />
      </div>

      {/* Detail panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Financials */}
        <Panel title="Financial Summary" icon={DollarSign}>
          <FinanceRow label="Total Collected"    value={`₨ ${(totalCollected / 100).toLocaleString()}`}    color="#22c55e" />
          <FinanceRow label="Monthly Collection" value={`₨ ${(monthlyCollected / 100).toLocaleString()}`}  color="#3b82f6" />
          <FinanceRow label="Monthly Remaining"  value={`₨ ${(monthlyRemaining / 100).toLocaleString()}`}  color="#ef4444" />
          <FinanceRow label="Total Outstanding"  value={`₨ ${(outstandingBalance / 100).toLocaleString()}`} color="#f59e0b" />
        </Panel>

        {/* Status breakdown */}
        <Panel title="Orders by Status" icon={Activity}>
          <StatusRow label="New"       value={orders?.filter(o => o.status === "new").length || 0}       dot="#eab308" />
          <StatusRow label="Working"   value={orders?.filter(o => o.status === "working").length || 0}   dot="#3b82f6" />
          <StatusRow label="Ready"     value={readyOrders.length}     dot="#22c55e" />
          <StatusRow label="Delivered" value={deliveredOrders.length} dot="#94a3b8" />
          <StatusRow label="Canceled"  value={canceledOrders.length}  dot="#ef4444" />

          {/* Simple progress bar */}
          {orders && orders.length > 0 && (
            <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
                {[
                  { status: "new",       color: "#eab308" },
                  { status: "working",   color: "#3b82f6" },
                  { status: "ready",     color: "#22c55e" },
                  { status: "delivered", color: "#94a3b8" },
                  { status: "canceled",  color: "#ef4444" },
                ].map(({ status, color }) => {
                  const count = orders.filter(o => o.status === status).length;
                  const pct = orders.length ? (count / orders.length) * 100 : 0;
                  return pct > 0 ? (
                    <div
                      key={status}
                      className="h-full"
                      style={{ backgroundColor: color, width: `${pct}%` }}
                    />
                  ) : null;
                })}
              </div>
            </div>
          )}
        </Panel>

        {/* Designer performance */}
        <Panel title="Designer Performance" icon={Users}>
          {orders && orders.length > 0 ? (
            <div>
              {Array.from(new Set(orders.filter(o => o.assignee).map(o => o.assignee?.id)))
                .slice(0, 6)
                .map(designerId => {
                  const designer     = orders.find(o => o.assignee?.id === designerId)?.assignee;
                  const designerOrds = orders.filter(o => o.assignedToId === designerId);
                  const done         = designerOrds.filter(o => o.status === "ready" || o.status === "delivered").length;
                  const pct          = designerOrds.length ? Math.round((done / designerOrds.length) * 100) : 0;
                  const barColor     = pct >= 70 ? "#22c55e" : pct >= 40 ? "#3b82f6" : "#f59e0b";

                  return (
                    <div
                      key={designerId}
                      className="py-2.5 border-b last:border-b-0"
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm text-white">{designer?.name || "Unknown"}</span>
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {done}/{designerOrds.length}
                        </span>
                      </div>
                      <div
                        className="h-1 rounded-full overflow-hidden"
                        style={{ background: "var(--bg-hover)" }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: barColor }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }}>
              No designer data yet.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
