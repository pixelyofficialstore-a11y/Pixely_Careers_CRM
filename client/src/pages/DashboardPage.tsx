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
import { format } from "date-fns";
import { getMillisecondsUntilNextBusinessDay } from "@shared/business-time";
import { DashboardSkeleton } from "@/components/PageSkeleton";
import { CompactMetric, EmptyState, MetricCard as CRMMetricCard, PageHeader, SectionCard } from "@/components/CRMPrimitives";
import { Button } from "@/components/ui/button";

const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());

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
    new?: number;
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

function ComplaintStatsGrid({
  stats,
  totalTitle,
}: {
  stats: NonNullable<DashboardStats["complaints"]> | undefined;
  totalTitle: string;
}) {
  const defaultOrder = ["all", "new", "confirmed", "dismissed", "resolved", "refund"] as const;
  type ComplaintMetric = typeof defaultOrder[number];
  const values = stats ?? { all: 0, new: 0, confirmed: 0, dismissed: 0, resolved: 0, refund: 0 };

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
    new: {
      title: "New",
      value: values.new ?? 0,
      description: "New complaints awaiting review",
      icon: Clock,
      iconClass: "bg-amber-500/10 text-amber-400",
      valueClass: "text-amber-300",
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
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 p-4 sm:grid-cols-6">
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

type DashboardMetrics = {
  generatedAt: string;
  orders: {
    totalAllTime: number;
    placedAllTime: number;
    today: number;
    thisMonth: number;
    inProgress: number;
    pending: number;
    byStatus: { new: number; working: number; ready: number; delivered: number; canceled: number };
    completedThisMonth: number;
    canceledThisMonth: number;
    paymentPaid: number;
    paymentPending: number;
  };
  recentOrders: Array<{ id: number; orderNumber: string | null; clientName: string; status: string; createdAt: string }>;
  designers: Array<{ id: number; name: string; assigned: number; active: number; completed: number }>;
  finance?: {
    salesThisMonth: number;
    collectedThisMonth: number;
    collectedOnMonthOrders: number;
    remainingOnMonthOrders: number;
    refundedThisMonth: number;
    netCashThisMonth: number;
    collectedAllTime: number;
    outstanding: number;
    today: { advance: number; remaining: number; total: number };
  };
  complaints?: DashboardStats["complaints"];
};

const formatAmount = (amount: number) => `Rs${Math.round(amount / 100).toLocaleString()}`;
const orderHref = (order: { id: number; orderNumber: string | null }) => `/orders?order=${encodeURIComponent(order.orderNumber || String(order.id))}`;

function DesignerPerformanceCard({ designers }: { designers: DashboardMetrics["designers"] }) {
  return (
    <SectionCard title="Designer Performance" eyebrow="Team workload" description="Assigned order workload and delivery totals." className="lg:col-span-3">
      <div className="p-4">
        {designers.length ? (
          <div className="divide-y divide-slate-800/70">
            {designers.map(designer => {
              const completionRate = designer.assigned ? Math.round((designer.completed / designer.assigned) * 100) : 0;
              return (
                <div key={designer.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 text-sm font-semibold text-cyan-200">
                      {designer.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-200">{designer.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{designer.assigned} assigned {designer.assigned === 1 ? "order" : "orders"}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-5 pl-12 text-left sm:pl-0 sm:text-right">
                    <div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-600">Active</p><p className="mt-1 text-sm font-semibold text-amber-300">{designer.active}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-600">Completed</p><p className="mt-1 text-sm font-semibold text-emerald-300">{designer.completed}</p></div>
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

function RecentOrdersList({ orders, setLocation, showStatus }: { orders: DashboardMetrics["recentOrders"]; setLocation: (path: string) => void; showStatus?: boolean }) {
  if (!orders.length) return <EmptyState title="No recent activity" description="New order activity will appear here." icon={Activity} />;
  return <div className="space-y-1">{orders.map(order => showStatus
    ? <button key={order.id} type="button" onClick={() => setLocation(orderHref(order))} className="flex w-full items-center justify-between gap-4 rounded-lg px-2 py-3 text-left transition-colors hover:bg-cyan-400/[.04]"><span className="min-w-0"><span className="block truncate font-mono text-xs text-cyan-300">{order.orderNumber || `#${order.id}`}</span><span className="mt-1 block truncate text-sm text-slate-200">{order.clientName}</span></span><span className="shrink-0 text-right text-xs text-slate-500">{titleCase(order.status)}<span className="block">{format(new Date(order.createdAt), "MMM dd")}</span></span></button>
    : <button key={order.id} type="button" onClick={() => setLocation(orderHref(order))} className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-cyan-400/[.04]"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-400/10 text-cyan-300"><ShoppingCart className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm text-slate-200">Order {order.orderNumber || `#${order.id}`} created</span><span className="mt-0.5 block truncate text-xs text-slate-500">{order.clientName}</span></span><span className="shrink-0 text-right text-xs text-slate-600">{format(new Date(order.createdAt), "MMM dd, yyyy")}<span className="block">{format(new Date(order.createdAt), "h:mm a")}</span></span></button>,
  )}</div>;
}

const todayHeader = <div className="text-right"><p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">Today</p><p className="mt-1 text-sm font-medium text-slate-200">{format(new Date(), "MMM dd, yyyy")}</p></div>;

type DashProps = { m: DashboardMetrics; feedbackStats?: FeedbackStats; openFeedback: (tab: "reviews" | "suggestions") => void; setLocation: (path: string) => void; role?: string };

function AdminDashboard({ m, feedbackStats, openFeedback, setLocation }: DashProps) {
  const complaints = m.complaints ?? { all: 0, confirmed: 0, dismissed: 0, resolved: 0, refund: 0 };
  const f = m.finance ?? { salesThisMonth: 0, collectedThisMonth: 0, collectedOnMonthOrders: 0, remainingOnMonthOrders: 0, refundedThisMonth: 0, netCashThisMonth: 0, collectedAllTime: 0, outstanding: 0, today: { advance: 0, remaining: 0, total: 0 } };
  const newSuggestions = feedbackStats?.suggestions.new ?? 0;
  const attention = [
    { label: "New complaints", value: complaints.all - complaints.confirmed - complaints.dismissed - complaints.resolved - complaints.refund, href: "/complaints", action: "Review complaints", tone: "warning" as const },
    { label: "Pending payments", value: m.orders.paymentPending, href: "/payments", action: "Review payments", tone: "warning" as const },
    { label: "New suggestions", value: newSuggestions, href: "/feedback?tab=suggestions", action: "Review suggestions", tone: "cyan" as const },
    { label: "Orders due / pending", value: m.orders.pending, href: "/orders", action: "View orders", tone: "cyan" as const },
  ].filter(item => item.value > 0);
  const clientExperienceMetrics = [
    { label: "Average rating", value: feedbackStats?.reviews.averageRating == null ? "—" : `${feedbackStats.reviews.averageRating.toFixed(1)}/5`, icon: Star, tone: "warning" as const, onClick: () => openFeedback("reviews") },
    { label: "Reviews this month", value: feedbackStats?.reviews.all ?? 0, icon: MessageSquareHeart, tone: "cyan" as const, onClick: () => openFeedback("reviews") },
    { label: "Confirmed complaints", value: complaints.confirmed, icon: FileWarning, tone: "warning" as const, onClick: () => setLocation("/complaints") },
    { label: "Implemented suggestions", value: feedbackStats?.suggestions.implemented ?? 0, icon: Lightbulb, tone: "success" as const, onClick: () => openFeedback("suggestions") },
  ];
  const s = m.orders.byStatus;
  const orderPipeline = [
    { label: "New", status: "new", count: s.new, color: "bg-amber-300", text: "text-amber-300" },
    { label: "In progress", status: "working", count: s.working, color: "bg-cyan-300", text: "text-cyan-300" },
    { label: "Ready", status: "ready", count: s.ready, color: "bg-emerald-300", text: "text-emerald-300" },
    { label: "Delivered", status: "delivered", count: s.delivered, color: "bg-emerald-500", text: "text-emerald-400" },
    { label: "Canceled", status: "canceled", count: s.canceled, color: "bg-rose-300", text: "text-rose-300" },
  ];
  const pipelineTotal = orderPipeline.reduce((total, item) => total + item.count, 0);

  return <div className="crm-page space-y-5">
    <PageHeader eyebrow="Operations overview" title="Admin Dashboard" description="Monitor orders, financial activity and client experience from one place." actions={todayHeader} />

    <section className="space-y-3">
      <DashboardSectionHeading icon={Activity} title="Quick Overview" description="The four signals that matter most right now." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CRMMetricCard label="Today's orders" value={m.orders.today} icon={Calendar} testId="stat-today-orders" />
        <CRMMetricCard label="Total orders (all time)" value={m.orders.totalAllTime} icon={Activity} testId="stat-total-orders" />
        <CRMMetricCard label="Pending orders" value={m.orders.pending} icon={Clock} tone="warning" testId="stat-pending-orders" />
        <CRMMetricCard label="Ready / delivered this month" value={m.orders.completedThisMonth} icon={CheckCircle2} tone="success" testId="stat-ready-month" />
      </div>
    </section>

    <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <SectionCard title="Order Operations" eyebrow="Operations" description="Monthly workload and delivery position." className="flex h-full flex-col">
        <div className="flex flex-1 flex-col p-4">
          <div>
            <DashboardRow label="Monthly orders" value={m.orders.thisMonth} />
            <DashboardRow label="Completed" value={m.orders.completedThisMonth} tone="success" />
            <DashboardRow label="In progress" value={m.orders.inProgress} />
            <DashboardRow label="Canceled" value={m.orders.canceledThisMonth} tone="danger" />
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
          <DashboardRow label="Sales" note="Value of orders booked this month" value={formatAmount(f.salesThisMonth)} testId="stat-sales-month" />
          <DashboardRow label="Collected" note="Payments approved this month" value={formatAmount(f.collectedThisMonth)} tone="success" testId="stat-collected-month" />
          <DashboardRow label="Remaining" note="Still due on this month's orders" value={formatAmount(f.remainingOnMonthOrders)} tone="warning" />
          <DashboardRow label="Refunded" value={formatAmount(f.refundedThisMonth)} tone="danger" />
          <div className="mt-4 border-t border-slate-800/70 pt-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[.13em] text-cyan-300">Cash Flow</p>
            <DashboardRow label="Received today" note={`Advance ${formatAmount(f.today.advance)} · Remaining ${formatAmount(f.today.remaining)}`} value={formatAmount(f.today.total)} testId="stat-today-cash-flow" />
            <DashboardRow label="Net cash this month" value={formatAmount(f.netCashThisMonth)} tone={f.netCashThisMonth >= 0 ? "success" : "danger"} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-800/70 pt-4">
            <div><p className="text-[10px] font-bold uppercase tracking-[.11em] text-slate-600">All-time collected</p><p className="mt-1 text-sm font-semibold text-slate-300" data-testid="stat-total-collected">{formatAmount(f.collectedAllTime)}</p></div>
            <div><p className="text-[10px] font-bold uppercase tracking-[.11em] text-slate-600">Outstanding</p><p className="mt-1 text-sm font-semibold text-slate-300" data-testid="stat-outstanding">{formatAmount(f.outstanding)}</p></div>
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
      <DesignerPerformanceCard designers={m.designers} />
      <SectionCard title="Needs Attention" eyebrow="Action queue" description="Open items that may need a response." className="lg:col-span-2">
        <div className="p-4">
          {attention.length ? <div className="space-y-1">{attention.map(item => <button key={item.label} type="button" onClick={() => setLocation(item.href)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-cyan-400/[.04]"><div><p className="text-sm text-slate-300">{item.label}</p><p className={cn("mt-0.5 text-xs", item.tone === "warning" ? "text-amber-300" : "text-cyan-300")}>{item.action} <ArrowUpRight className="ml-1 inline h-3 w-3" /></p></div><span className={cn("font-mono text-lg", item.tone === "warning" ? "text-amber-300" : "text-slate-100")}>{item.value}</span></button>)}</div> : <EmptyState title="Nothing urgent requires attention." description="The operational queue is clear." icon={CheckCircle2} />}
        </div>
      </SectionCard>
      <SectionCard title="Recent Activity" eyebrow="Activity" description="Latest order activity across the workspace." className="lg:col-span-5">
        <div className="p-4"><RecentOrdersList orders={m.recentOrders} setLocation={setLocation} /></div>
      </SectionCard>
    </section>
  </div>;
}

function DesignerDashboard({ m, feedbackStats, openFeedback, setLocation, role }: DashProps) {
  const s = m.orders.byStatus;
  const confirmedComplaints = m.complaints?.confirmed ?? 0;
  const designerAttention = [
    { label: "New orders assigned", value: s.new, tone: "warning" as const },
    { label: "Confirmed complaints", value: confirmedComplaints, tone: "danger" as const },
    { label: "Orders ready to deliver", value: s.ready, tone: "success" as const },
  ].filter(item => item.value > 0);
  return (
    <div className="crm-page space-y-5">
      <PageHeader eyebrow="My workspace" title="Designer Dashboard" description="Track assigned client work, feedback and service quality." actions={todayHeader} />
      <section className="space-y-3">
        <DashboardSectionHeading icon={Activity} title="Quick Overview" description="Your assigned production workload." />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CRMMetricCard label="Active orders" value={m.orders.pending} icon={Activity} tone="warning" testId="stat-active-orders" />
          <CRMMetricCard label="New orders" value={s.new} icon={Clock} tone="warning" testId="stat-new-orders" />
          <CRMMetricCard label="Completed this month" value={m.orders.completedThisMonth} icon={CheckCircle2} tone="success" testId="stat-monthly-completed" />
          <CRMMetricCard label="Confirmed complaints" value={confirmedComplaints} icon={FileWarning} tone="danger" onClick={() => setLocation("/complaints")} testId="stat-confirmed-complaints" />
        </div>
      </section>
      <ClientExperienceGrid stats={feedbackStats} role={role} onOpenFeedback={openFeedback} />
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="My Workload" eyebrow="Production" description="Status of orders assigned to you.">
          <div className="p-4">
            <DashboardRow label="New" value={s.new} tone="warning" />
            <DashboardRow label="In progress" value={s.working} />
            <DashboardRow label="Ready" value={s.ready} tone="success" />
            <DashboardRow label="Delivered" value={s.delivered} tone="success" />
            <DashboardRow label="Canceled" value={s.canceled} tone="danger" />
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
        <div className="p-4"><RecentOrdersList orders={m.recentOrders} setLocation={setLocation} showStatus /></div>
      </SectionCard>
    </div>
  );
}

function SupportDashboard({ m, feedbackStats, openFeedback, setLocation, role }: DashProps) {
  const c = m.complaints;
  const supportNewComplaints = c?.new ?? Math.max(0, (c?.all || 0) - (c?.confirmed || 0) - (c?.dismissed || 0) - (c?.resolved || 0) - (c?.refund || 0));
  const s = m.orders.byStatus;
  const supportAttention = [
    { label: "New case records", value: supportNewComplaints, href: "/complaints", tone: "warning" as const },
    { label: "Pending payment orders", value: m.orders.paymentPending, href: "/payments", tone: "danger" as const },
    { label: "Orders waiting to start", value: s.new, href: "/orders", tone: "warning" as const },
  ].filter(item => item.value > 0);
  return (
    <div className="crm-page space-y-5">
      <PageHeader eyebrow="Client operations" title="Support Dashboard" description="Manage client orders, feedback and service-related activity." actions={todayHeader} />
      <section className="space-y-3">
        <DashboardSectionHeading icon={Activity} title="Quick Overview" description="Operational records available to Support." />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CRMMetricCard label="Orders handled" value={m.orders.placedAllTime} icon={ShoppingCart} testId="stat-orders-handled" />
          <CRMMetricCard label="Active orders" value={m.orders.pending} icon={Activity} tone="warning" testId="stat-active-orders" />
          <CRMMetricCard label="Reviews recorded" value={feedbackStats?.reviews.all ?? 0} icon={MessageSquareHeart} onClick={() => openFeedback("reviews")} testId="stat-feedback-reviews" />
          <CRMMetricCard label="Complaints filed" value={c?.all ?? 0} icon={FileWarning} tone="danger" onClick={() => setLocation("/complaints")} testId="stat-complaints-filed" />
        </div>
      </section>
      <ClientExperienceGrid stats={feedbackStats} role={role} onOpenFeedback={openFeedback} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Order Operations" eyebrow="Support queue" description="Current order status across your operational view.">
          <div className="p-4"><DashboardRow label="Orders handled this month" value={m.orders.thisMonth} /><DashboardRow label="Active" value={m.orders.pending} tone="warning" /><DashboardRow label="Completed / delivered" value={s.ready + s.delivered} tone="success" /><DashboardRow label="Canceled this month" value={m.orders.canceledThisMonth} tone="danger" /></div>
        </SectionCard>
        <SectionCard title="Payment Operations" eyebrow="Support queue" description="Payment status without exposing finance balances.">
          <div className="p-4"><DashboardRow label="Paid orders" value={m.orders.paymentPaid} tone="success" /><DashboardRow label="Pending orders" value={m.orders.paymentPending} tone="danger" /><DashboardRow label="Resolved complaints" value={c?.resolved ?? 0} tone="success" /><Button variant="outline" className="mt-4 w-full" onClick={() => setLocation("/payments")}>Open payment records <ArrowUpRight className="ml-2 h-4 w-4" /></Button></div>
        </SectionCard>
      </div>
      <ComplaintStatsGrid stats={c} totalTitle="Complaints Filed" />
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Needs Attention" eyebrow="Action queue" description="Open items that may need a response.">
          <div className="p-4">{supportAttention.length ? <div>{supportAttention.map(item => <button key={item.label} type="button" onClick={() => setLocation(item.href)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-cyan-400/[.04]"><span className="text-sm text-slate-300">{item.label}</span><span className={cn("font-mono text-lg", item.tone === "danger" ? "text-rose-300" : "text-amber-300")}>{item.value}</span></button>)}</div> : <EmptyState title="Nothing urgent requires attention." description="The support queue is clear." icon={CheckCircle2} />}</div>
        </SectionCard>
        <SectionCard title="Recent Activity" eyebrow="Client operations" description="Latest orders in your authorized support view.">
          <div className="p-4"><RecentOrdersList orders={m.recentOrders} setLocation={setLocation} showStatus /></div>
        </SectionCard>
      </section>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const openFeedback = (tab: "reviews" | "suggestions") => setLocation(`/feedback?tab=${tab}`);

  // Every number comes from server/metrics.ts (SQL aggregates, cached 30s,
  // refreshed by live events). No order list is downloaded here.
  const { data: metrics, isLoading, refetch } = useQuery<DashboardMetrics>({
    queryKey: ["/api/metrics/dashboard"],
    enabled: Boolean(user),
  });

  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const { data: feedbackStats } = useQuery<FeedbackStats>({
    queryKey: [`/api/feedback/stats?month=${currentMonth}&year=${currentYear}`],
    enabled: Boolean(user),
  });

  // "Today" rolls over at midnight Pakistan time.
  useEffect(() => {
    let midnightTimer: number;
    const schedule = () => {
      midnightTimer = window.setTimeout(() => { void refetch(); schedule(); }, getMillisecondsUntilNextBusinessDay() + 250);
    };
    schedule();
    return () => window.clearTimeout(midnightTimer);
  }, [refetch]);

  if (isLoading || !metrics) return <DashboardSkeleton />;

  const props: DashProps = { m: metrics, feedbackStats, openFeedback, setLocation, role: user?.role };
  if (user?.role === "designer") return <DesignerDashboard {...props} />;
  if (user?.role === "support") return <SupportDashboard {...props} />;
  return <AdminDashboard {...props} />;
}
