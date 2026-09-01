import { useEffect, type ReactNode } from "react";
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
import { CompactMetric, EmptyState, MetricCard as CRMMetricCard, PageHeader, SectionCard } from "@/components/CRMPrimitives";
import { Button } from "@/components/ui/button";

const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());

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
    monthlyCashFlow?: {
      inflow: number;
      refunds: number;
      net: number;
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
    <SectionCard title="Client Experience" eyebrow="Client experience" description="Feedback records visible to your role.">
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <CRMMetricCard label={reviewTitle} value={stats?.reviews.all ?? 0} icon={MessageSquareHeart} testId="stat-feedback-reviews" onClick={() => onOpenFeedback("reviews")} />
        <CRMMetricCard label="Average client rating" value={stats?.reviews.averageRating == null ? "—" : `${stats.reviews.averageRating.toFixed(1)}/5`} icon={Star} tone="warning" testId="stat-feedback-rating" onClick={() => onOpenFeedback("reviews")} />
        <CRMMetricCard label={suggestionTitle} value={stats?.suggestions.all ?? 0} icon={Lightbulb} testId="stat-feedback-suggestions" onClick={() => onOpenFeedback("suggestions")} />
        <CRMMetricCard label="Implemented suggestions" value={stats?.suggestions.implemented ?? 0} icon={ClipboardCheck} tone="success" testId="stat-feedback-implemented" onClick={() => onOpenFeedback("suggestions")} />
      </div>
    </SectionCard>
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
  const tone = color === "green" ? "success" : color === "orange" ? "warning" : color === "red" ? "danger" : "cyan";
  return <CRMMetricCard label={title} value={value} icon={Icon} tone={tone} onClick={onClick} testId={testId} note={trend} />;
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

  return <SectionCard title="Complaint Summary" eyebrow="Service quality" description="Current complaint outcomes.">
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 p-4 sm:grid-cols-5">
      {defaultOrder.map(metricKey => {
        const metric = metrics[metricKey];
        return <div key={metricKey} className="border-b border-slate-800/70 py-3 last:border-0 sm:border-b-0 sm:border-r sm:px-3 sm:first:pl-0 sm:last:border-r-0" data-testid={`stat-complaints-${metricKey}`}>
          <p className="text-[10px] font-bold uppercase tracking-[.11em] text-slate-600">{metric.title}</p>
          <p className={cn("mt-1 text-lg font-semibold", metric.valueClass)}>{metric.value}</p>
        </div>;
      })}
    </div>
  </SectionCard>;
}

function DashboardRow({ label, value, tone = "default", note, testId }: { label: string; value: string | number; tone?: "default" | "success" | "warning" | "danger"; note?: string; testId?: string }) {
  const valueClass = tone === "success" ? "text-emerald-300" : tone === "warning" ? "text-amber-300" : tone === "danger" ? "text-rose-300" : "text-slate-100";
  return <div className="flex items-center justify-between gap-4 border-b border-slate-800/70 py-3 last:border-0 last:pb-0 first:pt-0">
    <div className="min-w-0"><p className="text-sm text-slate-300">{label}</p>{note && <p className="mt-0.5 text-[11px] text-slate-600">{note}</p>}</div>
    <p className={cn("shrink-0 text-sm font-semibold", valueClass)} data-testid={testId}>{value}</p>
  </div>;
}

function DashboardSectionHeading({ icon: Icon, title, description, action }: { icon: typeof Activity; title: string; description?: string; action?: ReactNode }) {
  return <div className="flex items-start justify-between gap-4">
    <div className="flex min-w-0 items-start gap-2.5"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" /><div><h2 className="text-sm font-semibold text-slate-200">{title}</h2>{description && <p className="mt-1 text-xs text-slate-500">{description}</p>}</div></div>
    {action}
  </div>;
}

function DesignerPerformanceCard({ orders, teamMembers }: { orders: OrderWithServices[]; teamMembers?: User[] }) {
  const designers = (teamMembers || []).filter(member => member.role === "designer" && member.isActive);

  return (
    <SectionCard title="Designer Performance" eyebrow="Team workload" description="Assigned order workload and delivery totals." className="lg:col-span-3">
      <div className="p-4">
        {designers.length ? (
          <div className="divide-y divide-slate-800/70">
            {designers.map(designer => {
              const assignedOrders = orders.filter(order => order.assignedToId === designer.id);
              const activeCount = assignedOrders.filter(order => order.status === "new" || order.status === "working").length;
              const completedCount = assignedOrders.filter(order => order.status === "ready" || order.status === "delivered").length;
              const completionRate = assignedOrders.length ? Math.round((completedCount / assignedOrders.length) * 100) : 0;

              return (
                <div key={designer.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 text-sm font-semibold text-cyan-200">
                      {designer.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-200">{designer.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{assignedOrders.length} assigned {assignedOrders.length === 1 ? "order" : "orders"}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-5 pl-12 text-left sm:pl-0 sm:text-right">
                    <div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-600">Active</p><p className="mt-1 text-sm font-semibold text-amber-300">{activeCount}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-600">Completed</p><p className="mt-1 text-sm font-semibold text-emerald-300">{completedCount}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-600">Completion</p><p className="mt-1 text-sm font-semibold text-cyan-200">{completionRate}%</p></div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No active designers" description="Active designer workload will appear here." icon={Users} />
        )}
      </div>
    </SectionCard>
  );
}

function AdminDashboard({
  orders,
  teamMembers,
  feedbackStats,
  complaintStats,
  openFeedback,
  setLocation,
  todayOrders,
  monthlyOrders,
  pendingOrders,
  canceledOrders,
  readyThisMonth,
  activeOrders,
  monthlyRevenue,
  monthlyCollected,
  monthlyRemaining,
  totalCollected,
  outstandingBalance,
  monthlyCashFlow,
}: {
  orders: OrderWithServices[];
  teamMembers?: User[];
  feedbackStats?: FeedbackStats;
  complaintStats?: DashboardStats["complaints"];
  openFeedback: (tab: "reviews" | "suggestions") => void;
  setLocation: (path: string) => void;
  todayOrders: OrderWithServices[];
  monthlyOrders: OrderWithServices[];
  pendingOrders: OrderWithServices[];
  canceledOrders: OrderWithServices[];
  readyThisMonth: OrderWithServices[];
  activeOrders: OrderWithServices[];
  monthlyRevenue: number;
  monthlyCollected: number;
  monthlyRemaining: number;
  totalCollected: number;
  outstandingBalance: number;
  monthlyCashFlow: { inflow: number; refunds: number; net: number };
}) {
  const formatAmount = (amount: number) => `Rs${Math.round(amount / 100).toLocaleString()}`;
  const complaints = complaintStats ?? { all: 0, confirmed: 0, dismissed: 0, resolved: 0, refund: 0 };
  const pendingPayments = orders.filter(order => order.paymentStatus === "pending").length;
  const newSuggestions = feedbackStats?.suggestions.new ?? 0;
  const attention = [
    { label: "New complaints", value: complaints.all - complaints.confirmed - complaints.dismissed - complaints.resolved - complaints.refund, href: "/complaints", action: "Review complaints", tone: "warning" as const },
    { label: "Pending payments", value: pendingPayments, href: "/payments", action: "Review payments", tone: "warning" as const },
    { label: "New suggestions", value: newSuggestions, href: "/feedback?tab=suggestions", action: "Review suggestions", tone: "cyan" as const },
    { label: "Orders due / pending", value: pendingOrders.length, href: "/orders", action: "View orders", tone: "cyan" as const },
  ].filter(item => item.value > 0);
  const recentOrders = [...orders].filter(order => order.createdAt).sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()).slice(0, 6);
  const clientExperienceMetrics = [
    { label: "Average rating", value: feedbackStats?.reviews.averageRating == null ? "—" : `${feedbackStats.reviews.averageRating.toFixed(1)}/5`, icon: Star, tone: "warning" as const, onClick: () => openFeedback("reviews") },
    { label: "Reviews this month", value: feedbackStats?.reviews.all ?? 0, icon: MessageSquareHeart, tone: "cyan" as const, onClick: () => openFeedback("reviews") },
    { label: "Confirmed complaints", value: complaints.confirmed, icon: FileWarning, tone: "warning" as const, onClick: () => setLocation("/complaints") },
    { label: "Implemented suggestions", value: feedbackStats?.suggestions.implemented ?? 0, icon: Lightbulb, tone: "success" as const, onClick: () => openFeedback("suggestions") },
  ];
  const orderPipeline = [
    { label: "New", status: "new", count: orders.filter(order => order.status === "new").length, color: "bg-amber-300", text: "text-amber-300" },
    { label: "In progress", status: "working", count: orders.filter(order => order.status === "working").length, color: "bg-cyan-300", text: "text-cyan-300" },
    { label: "Ready", status: "ready", count: orders.filter(order => order.status === "ready").length, color: "bg-emerald-300", text: "text-emerald-300" },
    { label: "Delivered", status: "delivered", count: orders.filter(order => order.status === "delivered").length, color: "bg-emerald-500", text: "text-emerald-400" },
    { label: "Canceled", status: "canceled", count: orders.filter(order => order.status === "canceled").length, color: "bg-rose-300", text: "text-rose-300" },
  ];
  const pipelineTotal = orderPipeline.reduce((total, item) => total + item.count, 0);

  return <div className="crm-page space-y-5">
    <PageHeader eyebrow="Operations overview" title="Admin Dashboard" description="Monitor orders, financial activity and client experience from one place." actions={<div className="text-right"><p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">Today</p><p className="mt-1 text-sm font-medium text-slate-200">{format(new Date(), "MMM dd, yyyy")}</p></div>} />

    <section className="space-y-3">
      <DashboardSectionHeading icon={Activity} title="Quick Overview" description="The four signals that matter most right now." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CRMMetricCard label="Today's orders" value={todayOrders.length} icon={Calendar} testId="stat-today-orders" />
        <CRMMetricCard label="Active orders" value={activeOrders.length} icon={Activity} testId="stat-active-orders" />
        <CRMMetricCard label="Pending orders" value={pendingOrders.length} icon={Clock} tone="warning" testId="stat-pending-orders" />
        <CRMMetricCard label="Ready / delivered this month" value={readyThisMonth.length} icon={CheckCircle2} tone="success" testId="stat-ready-month" />
      </div>
    </section>

    <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <SectionCard title="Order Operations" eyebrow="Operations" description="Monthly workload and delivery position." className="flex h-full flex-col">
        <div className="flex flex-1 flex-col p-4">
          <div>
            <DashboardRow label="Monthly orders" value={monthlyOrders.length} />
            <DashboardRow label="Completed" value={readyThisMonth.length} tone="success" />
            <DashboardRow label="Active" value={activeOrders.length} />
            <DashboardRow label="Canceled" value={canceledOrders.length} tone="danger" />
          </div>
          <div className="mt-5 border-t border-slate-800/70 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.13em] text-cyan-300">Current pipeline</p>
                <p className="mt-1 text-[11px] text-slate-500">Live order distribution across the workspace.</p>
              </div>
              <span className="font-mono text-xs text-slate-400">{pipelineTotal} total</span>
            </div>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-800" aria-label="Current order pipeline">
              {orderPipeline.filter(item => item.count > 0).map(item => (
                <span key={item.status} className={cn(item.color, "h-full transition-all")} style={{ width: `${(item.count / Math.max(pipelineTotal, 1)) * 100}%` }} />
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
              {orderPipeline.map(item => (
                <div key={item.status} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-xs text-slate-400">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", item.color)} />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className={cn("font-mono text-xs", item.text)}>{item.count}</span>
                </div>
              ))}
            </div>
          </div>
          <Button variant="outline" className="mt-auto w-full border-slate-700 text-slate-300 hover:border-cyan-400/40 hover:bg-cyan-400/[.04] hover:text-cyan-200" onClick={() => setLocation("/orders")}>
            Open order operations <ArrowUpRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </SectionCard>
       <SectionCard title="Financial Overview" eyebrow="Finance" description="Current month accounting position.">
         <div className="p-4">
           <DashboardRow label="Monthly revenue" value={formatAmount(monthlyRevenue)} />
           <DashboardRow label="Collected" value={formatAmount(monthlyCollected)} tone="success" />
           <DashboardRow label="Remaining" value={formatAmount(monthlyRemaining)} tone="warning" />
           <DashboardRow label="Refunded amount" value={formatAmount(monthlyCashFlow.refunds)} tone="danger" />
           <div className="mt-4 border-t border-slate-800/70 pt-4">
             <div className="mb-3 flex items-center justify-between gap-3">
               <div>
                 <p className="text-[10px] font-bold uppercase tracking-[.13em] text-cyan-300">Cash Flow</p>
                 <p className="mt-1 text-[11px] text-slate-500">Payments received and refunds issued this month.</p>
               </div>
             </div>
             <div className="space-y-0">
               <DashboardRow label="Cash inflow" value={formatAmount(monthlyCashFlow.inflow)} />
               <DashboardRow label="Refunds" value={formatAmount(monthlyCashFlow.refunds)} tone="danger" />
               <DashboardRow label="Net cash flow" value={formatAmount(monthlyCashFlow.net)} tone={monthlyCashFlow.net >= 0 ? "success" : "danger"} />
             </div>
           </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-800/70 pt-4">
              <div><p className="text-[10px] font-bold uppercase tracking-[.11em] text-slate-600">All-time collected</p><p className="mt-1 text-sm font-semibold text-slate-300" data-testid="stat-total-collected">{formatAmount(totalCollected)}</p></div>
              <div><p className="text-[10px] font-bold uppercase tracking-[.11em] text-slate-600">Outstanding</p><p className="mt-1 text-sm font-semibold text-slate-300" data-testid="stat-outstanding">{formatAmount(outstandingBalance)}</p></div>
            </div>
          </div>
       </SectionCard>
    </section>

    <SectionCard title="Client Experience" eyebrow="Client experience" description="Feedback signals from the current reporting period.">
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {clientExperienceMetrics.map(metric => <CRMMetricCard key={metric.label} label={metric.label} value={metric.value} icon={metric.icon} tone={metric.tone} onClick={metric.onClick} />)}
      </div>
       <div className="grid grid-cols-1 gap-3 border-t border-slate-800/70 p-4 sm:grid-cols-2 xl:grid-cols-4">
         <CompactMetric label="Facebook reviews" value={feedbackStats?.reviews.facebook ?? 0} />
         <CompactMetric label="Video testimonials" value={feedbackStats?.reviews.video ?? 0} />
         <CompactMetric label="Resolved complaints" value={complaints.resolved} tone="success" />
         <CompactMetric label="Refund cases" value={complaints.refund} tone="danger" />
      </div>
    </SectionCard>

    <section className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <DesignerPerformanceCard orders={orders} teamMembers={teamMembers} />
      <SectionCard title="Needs Attention" eyebrow="Action queue" description="Open items that may need a response." className="lg:col-span-2">
        <div className="p-4">
          {attention.length ? <div className="space-y-1">{attention.map(item => <button key={item.label} type="button" onClick={() => setLocation(item.href)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-cyan-400/[.04]"><div><p className="text-sm text-slate-300">{item.label}</p><p className={cn("mt-0.5 text-xs", item.tone === "warning" ? "text-amber-300" : "text-cyan-300")}>{item.action} <ArrowUpRight className="ml-1 inline h-3 w-3" /></p></div><span className={cn("font-mono text-lg", item.tone === "warning" ? "text-amber-300" : "text-slate-100")}>{item.value}</span></button>)}</div> : <EmptyState title="Nothing urgent requires attention." description="The operational queue is clear." icon={CheckCircle2} />}
        </div>
      </SectionCard>
      <SectionCard title="Recent Activity" eyebrow="Activity" description="Latest order activity across the workspace." className="lg:col-span-5">
        <div className="p-4">
          {recentOrders.length ? <div className="space-y-1">{recentOrders.map(order => <button key={order.id} type="button" onClick={() => setLocation(`/orders?order=${encodeURIComponent(order.orderNumber || String(order.id))}`)} className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-cyan-400/[.04]"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-400/10 text-cyan-300"><ShoppingCart className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm text-slate-200">Order {order.orderNumber || `#${order.id}`} created</span><span className="mt-0.5 block truncate text-xs text-slate-500">{order.clientName}</span></span><span className="shrink-0 text-right text-xs text-slate-600">{format(new Date(order.createdAt!), "MMM dd, yyyy")}<span className="block">{format(new Date(order.createdAt!), "h:mm a")}</span></span></button>)}</div> : <EmptyState title="No recent activity" description="New order activity will appear here." icon={Activity} />}
        </div>
      </SectionCard>
    </section>
  </div>;
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
  const monthlyRevenue = monthlyApprovedOrders.reduce((acc, o) => acc + getOrderAccounting(o).accountedTotal, 0);

  const todayCashFlow = dashboardStats?.finance?.todayCashFlow ?? {
    advance: 0,
    remaining: 0,
    total: 0,
  };

  // Designer Dashboard
  if (isDesigner) {
    const designerOrders = approvedOrders;
    const designerCompleted = designerOrders.filter(order => order.status === "ready" || order.status === "delivered");
    const designerActive = designerOrders.filter(order => order.status === "new" || order.status === "working");
    const designerNewComplaints = Math.max(0, (dashboardStats?.complaints?.all || 0) - (dashboardStats?.complaints?.confirmed || 0) - (dashboardStats?.complaints?.dismissed || 0) - (dashboardStats?.complaints?.resolved || 0) - (dashboardStats?.complaints?.refund || 0));
    const designerAttention = [
      { label: "New orders assigned", value: designerOrders.filter(order => order.status === "new").length, tone: "warning" as const },
      { label: "Confirmed complaints", value: dashboardStats?.complaints?.confirmed ?? 0, tone: "danger" as const },
      { label: "Orders ready to deliver", value: designerOrders.filter(order => order.status === "ready").length, tone: "success" as const },
    ].filter(item => item.value > 0);
    const recentDesignerOrders = [...designerOrders].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()).slice(0, 6);
    return (
      <div className="crm-page space-y-5">
        <PageHeader eyebrow="My workspace" title="Designer Dashboard" description="Track assigned client work, feedback and service quality." actions={<div className="text-right"><p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">Today</p><p className="mt-1 text-sm font-medium text-slate-200">{format(new Date(), "MMM dd, yyyy")}</p></div>} />

        <section className="space-y-3">
          <DashboardSectionHeading icon={Activity} title="Quick Overview" description="Your assigned production workload." />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <CRMMetricCard label="Active orders" value={designerActive.length} icon={Activity} tone="warning" testId="stat-active-orders" />
            <CRMMetricCard label="New orders" value={designerOrders.filter(order => order.status === "new").length} icon={Clock} tone="warning" testId="stat-new-orders" />
            <CRMMetricCard label="Completed this month" value={designerCompleted.filter(order => new Date(order.createdAt!) >= monthStart).length} icon={CheckCircle2} tone="success" testId="stat-monthly-completed" />
            <CRMMetricCard label="Confirmed complaints" value={dashboardStats?.complaints?.confirmed ?? 0} icon={FileWarning} tone="danger" onClick={() => setLocation("/complaints")} testId="stat-confirmed-complaints" />
          </div>
        </section>

        <ClientExperienceGrid stats={feedbackStats} role={user?.role} onOpenFeedback={openFeedback} />
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionCard title="My Workload" eyebrow="Production" description="Status of orders assigned to you.">
            <div className="p-4">
              <DashboardRow label="New" value={designerOrders.filter(order => order.status === "new").length} tone="warning" />
              <DashboardRow label="In progress" value={designerOrders.filter(order => order.status === "working").length} />
              <DashboardRow label="Ready" value={designerOrders.filter(order => order.status === "ready").length} tone="success" />
              <DashboardRow label="Delivered" value={designerOrders.filter(order => order.status === "delivered").length} tone="success" />
              <DashboardRow label="Canceled" value={designerOrders.filter(order => order.status === "canceled").length} tone="danger" />
            </div>
          </SectionCard>
          <SectionCard title="Needs Attention" eyebrow="Your queue" description="Items that need a response from you.">
            <div className="p-4">
              {designerAttention.length ? <div>{designerAttention.map(item => <DashboardRow key={item.label} label={item.label} value={item.value} tone={item.tone} />)}</div> : <EmptyState title="Nothing requires attention." description="Your assigned queue is clear." icon={CheckCircle2} />}
              <Button variant="outline" className="mt-4 w-full" onClick={() => setLocation("/orders")}>Open assigned orders <ArrowUpRight className="ml-2 h-4 w-4" /></Button>
            </div>
          </SectionCard>
        </section>
        <SectionCard title="Recent Activity" eyebrow="Production history" description="Latest activity from your assigned orders.">
          <div className="p-4">
            {recentDesignerOrders.length ? <div className="space-y-1">{recentDesignerOrders.map(order => <button key={order.id} type="button" onClick={() => setLocation(`/orders?order=${encodeURIComponent(order.orderNumber || String(order.id))}`)} className="flex w-full items-center justify-between gap-4 rounded-lg px-2 py-3 text-left transition-colors hover:bg-cyan-400/[.04]"><span className="min-w-0"><span className="block truncate font-mono text-xs text-cyan-300">{order.orderNumber || `#${order.id}`}</span><span className="mt-1 block truncate text-sm text-slate-200">{order.clientName}</span></span><span className="shrink-0 text-right text-xs text-slate-500">{titleCase(order.status)}<span className="block">{format(new Date(order.createdAt!), "MMM dd")}</span></span></button>)}</div> : <EmptyState title="No assigned activity yet" description="Assigned production work will appear here." icon={ShoppingCart} />}
          </div>
        </SectionCard>
      </div>
    );
  }

  // Support Dashboard
  if (isSupport) {
    const supportOrders = approvedOrders;
    const supportNewComplaints = Math.max(0, (dashboardStats?.complaints?.all || 0) - (dashboardStats?.complaints?.confirmed || 0) - (dashboardStats?.complaints?.dismissed || 0) - (dashboardStats?.complaints?.resolved || 0) - (dashboardStats?.complaints?.refund || 0));
    const supportActive = supportOrders.filter(order => order.status === "new" || order.status === "working");
    const supportCompleted = supportOrders.filter(order => order.status === "ready" || order.status === "delivered");
    const supportAttention = [
      { label: "New case records", value: supportNewComplaints, href: "/complaints", tone: "warning" as const },
      { label: "Pending payment orders", value: supportOrders.filter(order => order.paymentStatus === "pending").length, href: "/payments", tone: "danger" as const },
      { label: "Orders waiting to start", value: supportOrders.filter(order => order.status === "new").length, href: "/orders", tone: "warning" as const },
    ].filter(item => item.value > 0);
    const recentSupportOrders = [...supportOrders].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()).slice(0, 6);
    return (
      <div className="crm-page space-y-5">
        <PageHeader eyebrow="Client operations" title="Support Dashboard" description="Manage client orders, feedback and service-related activity." actions={<div className="text-right"><p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">Today</p><p className="mt-1 text-sm font-medium text-slate-200">{format(new Date(), "MMM dd, yyyy")}</p></div>} />

        <section className="space-y-3">
          <DashboardSectionHeading icon={Activity} title="Quick Overview" description="Operational records available to Support." />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <CRMMetricCard label="Orders handled" value={supportOrders.length} icon={ShoppingCart} testId="stat-orders-handled" />
            <CRMMetricCard label="Active orders" value={supportActive.length} icon={Activity} tone="warning" testId="stat-active-orders" />
            <CRMMetricCard label="Reviews recorded" value={feedbackStats?.reviews.all ?? 0} icon={MessageSquareHeart} onClick={() => openFeedback("reviews")} testId="stat-feedback-reviews" />
            <CRMMetricCard label="Complaints filed" value={dashboardStats?.complaints?.all ?? 0} icon={FileWarning} tone="danger" onClick={() => setLocation("/complaints")} testId="stat-complaints-filed" />
          </div>
        </section>

        <ClientExperienceGrid stats={feedbackStats} role={user?.role} onOpenFeedback={openFeedback} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionCard title="Order Operations" eyebrow="Support queue" description="Current order status across your operational view.">
            <div className="p-4"><DashboardRow label="Orders handled this month" value={monthlyOrders.length} /><DashboardRow label="Active" value={supportActive.length} tone="warning" /><DashboardRow label="Completed / delivered" value={supportCompleted.length} tone="success" /><DashboardRow label="Canceled" value={canceledOrders.length} tone="danger" /></div>
          </SectionCard>
          <SectionCard title="Payment Operations" eyebrow="Support queue" description="Payment status without exposing finance balances.">
            <div className="p-4"><DashboardRow label="Paid orders" value={supportOrders.filter(order => order.paymentStatus === "paid").length} tone="success" /><DashboardRow label="Pending orders" value={supportOrders.filter(order => order.paymentStatus === "pending").length} tone="danger" /><DashboardRow label="Resolved complaints" value={dashboardStats?.complaints?.resolved ?? 0} tone="success" /><Button variant="outline" className="mt-4 w-full" onClick={() => setLocation("/payments")}>Open payment records <ArrowUpRight className="ml-2 h-4 w-4" /></Button></div>
          </SectionCard>
        </div>
        <ComplaintStatsGrid stats={dashboardStats?.complaints} totalTitle="Complaints Filed" />
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionCard title="Needs Attention" eyebrow="Action queue" description="Open items that may need a response.">
            <div className="p-4">{supportAttention.length ? <div>{supportAttention.map(item => <button key={item.label} type="button" onClick={() => setLocation(item.href)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-cyan-400/[.04]"><span className="text-sm text-slate-300">{item.label}</span><span className={cn("font-mono text-lg", item.tone === "danger" ? "text-rose-300" : "text-amber-300")}>{item.value}</span></button>)}</div> : <EmptyState title="Nothing urgent requires attention." description="The support queue is clear." icon={CheckCircle2} />}</div>
          </SectionCard>
          <SectionCard title="Recent Activity" eyebrow="Client operations" description="Latest orders in your authorized support view.">
            <div className="p-4">{recentSupportOrders.length ? <div className="space-y-1">{recentSupportOrders.map(order => <button key={order.id} type="button" onClick={() => setLocation(`/orders?order=${encodeURIComponent(order.orderNumber || String(order.id))}`)} className="flex w-full items-center justify-between gap-4 rounded-lg px-2 py-3 text-left transition-colors hover:bg-cyan-400/[.04]"><span className="min-w-0"><span className="block truncate font-mono text-xs text-cyan-300">{order.orderNumber || `#${order.id}`}</span><span className="mt-1 block truncate text-sm text-slate-200">{order.clientName}</span></span><span className="shrink-0 text-right text-xs text-slate-500">{titleCase(order.status)}<span className="block">{format(new Date(order.createdAt!), "MMM dd")}</span></span></button>)}</div> : <EmptyState title="No recent activity" description="Support order activity will appear here." icon={Activity} />}</div>
          </SectionCard>
        </section>
      </div>
    );
  }

  // Admin Dashboard (Full access)
  if (isAdmin) return <AdminDashboard
    orders={orders || []}
    teamMembers={teamMembers}
    feedbackStats={feedbackStats}
    complaintStats={dashboardStats?.complaints}
    openFeedback={openFeedback}
    setLocation={setLocation}
    todayOrders={todayOrders}
    monthlyOrders={monthlyOrders}
    pendingOrders={pendingOrders}
    canceledOrders={canceledOrders}
    readyThisMonth={readyThisMonth}
    activeOrders={activeOrders}
    monthlyRevenue={monthlyRevenue}
    monthlyCollected={monthlyCollected}
    monthlyRemaining={monthlyRemaining}
    totalCollected={totalCollected}
    outstandingBalance={outstandingBalance}
    monthlyCashFlow={dashboardStats?.finance?.monthlyCashFlow ?? { inflow: 0, refunds: 0, net: 0 }}
  />;

  return (
    <div className="crm-page space-y-6">
      <PageHeader eyebrow="Operations overview" title="Admin Dashboard" description={`Welcome back, ${user?.name}. Here's your complete business overview.`} />

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
