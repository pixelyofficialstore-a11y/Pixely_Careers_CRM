import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, CircleDollarSign, Clock, Inbox, ListTodo, MessageCircle, ShieldCheck, ShoppingBag, Upload,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/CRMPrimitives";
import { cn } from "@/lib/utils";
import { compactRupees, rupees, useChartColors } from "@/lib/chart-colors";
import { WORK_STATUS_LABELS, mapLegacyStatus, type DisplayWorkStatus } from "@shared/order-process";

type ActionItem = { kind: string; title: string; detail?: string; href: string; count?: number; tone?: "danger" | "warning" | "info" };
type QueueItem = { id: number; orderNumber: string | null; clientName: string; status: string; workStatus: string | null; dueAt: string | null; overdue: boolean };
type AdminHome = { role: "admin"; stats: { todayOrders: number; toVerify: number; overdue: number; collectedThisMonth: number }; totalAllTime: number; actions: ActionItem[] };
type SupportHome = { role: "support"; stats: { paymentsToSubmit: number; followUpsDue: number; myOrdersThisMonth: number }; actions: ActionItem[] };
type DesignerHome = { role: "designer"; stats: { myQueue: number; dueToday: number; overdue: number; deliveredThisMonth: number }; queue: QueueItem[] };
type Home = AdminHome | SupportHome | DesignerHome;
type MonthPoint = { month: string; sales: number; collected: number };

function Stat({ label, value, icon: Icon, tone, href, testId }: { label: string; value: string | number; icon: typeof Clock; tone?: "danger" | "warning" | "success"; href?: string; testId?: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-slate-400">{label}</span>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--accent))] text-primary",
          tone === "danger" && "bg-rose-500/10 text-rose-400", tone === "warning" && "bg-amber-500/10 text-amber-400", tone === "success" && "bg-emerald-500/10 text-emerald-400")}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 font-display text-[1.75rem] font-semibold leading-none tracking-tight text-slate-100" data-testid={testId}>{value}</p>
    </>
  );
  const cls = "block rounded-xl border border-border bg-card p-4 transition-colors duration-150";
  return href ? <Link href={href} className={cn(cls, "hover:border-[hsl(var(--border-hover))]")}>{body}</Link> : <div className={cls}>{body}</div>;
}

function StatSkeleton() {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[104px] rounded-xl" />)}</div>;
}

function ActionList({ items, empty }: { items: ActionItem[]; empty: string }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-200">Needs your action</h2>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-400" />{empty}</p>
      ) : (
        <ul className="divide-y divide-[hsl(var(--border))]">
          {items.map((a, i) => (
            <li key={`${a.kind}-${i}`}>
              <Link href={a.href} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 hover:bg-[hsl(var(--surface-2))]" data-testid={`action-${a.kind}`}>
                <span className={cn("h-2 w-2 shrink-0 rounded-full", a.tone === "danger" ? "bg-rose-500" : a.tone === "warning" ? "bg-amber-500" : "bg-primary")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-200">{a.title}</span>
                  {a.detail && <span className="block truncate text-xs text-slate-500">{a.detail}</span>}
                </span>
                {a.count != null && <span className="rounded-full bg-[hsl(var(--surface-3))] px-2 py-0.5 text-xs font-semibold text-slate-300">{a.count}</span>}
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RevenueChart() {
  const c = useChartColors();
  const { data, isLoading } = useQuery<MonthPoint[]>({ queryKey: ["/api/metrics/monthly?months=6"] });
  const rows = (data ?? []).map(d => ({ ...d, label: format(new Date(`${d.month}-01T12:00:00`), "MMM") }));
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Sales vs collected</h2>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.primary }} />Sales</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.accent }} />Collected</span>
        </div>
      </div>
      {isLoading ? <div className="skeleton h-52" /> : (
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} barGap={4} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} stroke={c.grid} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: c.text, fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: c.text, fontSize: 12 }} tickFormatter={compactRupees} width={44} />
              <Tooltip
                cursor={{ fill: c.grid, opacity: 0.35 }}
                contentStyle={{ background: c.card, border: `1px solid ${c.grid}`, borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, name: string) => [rupees(v), name === "sales" ? "Sales" : "Collected"]}
              />
              <Bar dataKey="sales" fill={c.primary} radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="collected" fill={c.accent} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function AdminView({ d }: { d: AdminHome }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today's orders" value={d.stats.todayOrders} icon={ShoppingBag} href="/orders" testId="stat-today-orders" />
        <Stat label="To verify" value={d.stats.toVerify} icon={ShieldCheck} tone={d.stats.toVerify ? "warning" : undefined} href="/payments" testId="stat-to-verify" />
        <Stat label="Overdue" value={d.stats.overdue} icon={AlertTriangle} tone={d.stats.overdue ? "danger" : undefined} href="/board" testId="stat-overdue" />
        <Stat label="Collected this month" value={rupees(d.stats.collectedThisMonth)} icon={CircleDollarSign} tone="success" testId="stat-collected-month" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ActionList items={d.actions} empty="All clear. Nothing waiting on you." />
        <RevenueChart />
      </div>
      <p className="text-xs text-slate-500" data-testid="stat-total-orders">Total orders (all time): {d.totalAllTime.toLocaleString("en-PK")}</p>
    </>
  );
}

function SupportView({ d }: { d: SupportHome }) {
  const { data: wr } = useQuery<{ orders_new: number; reviews_new: number; partners_new: number }>({ queryKey: ["/api/website-requests/counts"] });
  const newRequests = (wr?.orders_new ?? 0) + (wr?.reviews_new ?? 0) + (wr?.partners_new ?? 0);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="New requests" value={newRequests} icon={Inbox} tone={newRequests ? "warning" : undefined} href="/website-requests" testId="stat-new-requests" />
        <Stat label="Payments to submit" value={d.stats.paymentsToSubmit} icon={Upload} tone={d.stats.paymentsToSubmit ? "warning" : undefined} href="/payments" testId="stat-payments-to-submit" />
        <Stat label="Follow-ups due" value={d.stats.followUpsDue} icon={MessageCircle} href="/orders" testId="stat-follow-ups" />
        <Stat label="My orders this month" value={d.stats.myOrdersThisMonth} icon={ShoppingBag} tone="success" href="/orders" testId="stat-my-orders-month" />
      </div>
      <ActionList items={d.actions} empty="All clear. No payments or follow-ups waiting." />
    </>
  );
}

function DesignerView({ d }: { d: DesignerHome }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="My queue" value={d.stats.myQueue} icon={ListTodo} href="/board" testId="stat-my-queue" />
        <Stat label="Due today" value={d.stats.dueToday} icon={CalendarClock} tone={d.stats.dueToday ? "warning" : undefined} testId="stat-due-today" />
        <Stat label="Overdue" value={d.stats.overdue} icon={AlertTriangle} tone={d.stats.overdue ? "danger" : undefined} testId="stat-overdue" />
        <Stat label="Delivered this month" value={d.stats.deliveredThisMonth} icon={CheckCircle2} tone="success" testId="stat-delivered-month" />
      </div>
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-200">My queue</h2>
        {d.queue.length === 0 ? <p className="px-4 py-8 text-sm text-slate-500">Your queue is empty.</p> : (
          <ul className="divide-y divide-[hsl(var(--border))]">
            {d.queue.map(o => {
              const ws = (o.workStatus || mapLegacyStatus(o.status)) as DisplayWorkStatus;
              return (
                <li key={o.id}>
                  <Link href={`/orders?order=${encodeURIComponent(o.orderNumber || String(o.id))}`} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 hover:bg-[hsl(var(--surface-2))]">
                    <span className="w-24 shrink-0 font-mono text-xs font-medium text-primary">{o.orderNumber}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-200">{o.clientName}</span>
                      <span className="block text-xs text-slate-500">{WORK_STATUS_LABELS[ws] ?? ws}</span>
                    </span>
                    {o.dueAt && (
                      <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium", o.overdue ? "bg-rose-500/10 text-rose-400" : "bg-slate-900 text-slate-400")}>
                        {o.overdue ? "Overdue · " : ""}{format(new Date(o.dueAt), "MMM d")}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery<Home>({ queryKey: ["/api/dashboard/home"], refetchInterval: 60_000 });
  const firstName = user?.name?.split(" ")[0] ?? "";
  return (
    <div className="crm-page space-y-4">
      <PageHeader title={firstName ? `Hi, ${firstName}` : "Dashboard"} />
      {isLoading || !data ? <StatSkeleton /> : data.role === "admin" ? <AdminView d={data} /> : data.role === "support" ? <SupportView d={data} /> : <DesignerView d={data} />}
    </div>
  );
}
