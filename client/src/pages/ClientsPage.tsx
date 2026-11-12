import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Link, Redirect, useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";
import { ArrowLeft, ChevronLeft, ChevronRight, Repeat, Search, ShoppingBag, Users, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard, PageHeader } from "@/components/CRMPrimitives";
import { OrderStatusBadge, StatusBadge } from "@/components/StatusBadge";
import { WhatsAppQuickReply } from "@/components/WhatsAppQuickReply";
import { rupees } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";

type Profile = {
  key: string; name: string; phone: string | null; email: string | null; orderCount: number; placedCount: number; totalSpent: number;
  firstOrderAt: string | null; lastOrderAt: string | null; firstPlatform: string | null; firstCampaign: string | null;
};
type ClientList = { rows: Profile[]; total: number; repeat: number; page: number; pageSize: number };
type ClientDetail = {
  profile: Profile;
  source: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; landingPage: string | null } | null;
  orders: Array<{ id: number; orderNumber: string | null; status: string; workStatus: string | null; packageType: string | null; orderType: string | null; totalPrice: number; discountAmount: number; remainingAmount: number; platform: string | null; campaign: string | null; createdAt: string | null; deliveredAt: string | null; designerName: string | null }>;
  payments: Array<{ id: number; orderId: number; orderNumber: string | null; amount: number; paymentType: string; status: string; createdAt: string | null }>;
  complaints: Array<{ id: number; complaintNumber: string; orderId: number; orderNumber: string | null; category: string | null; status: string; createdAt: string | null }>;
  websiteOrders: Array<{ id: string; createdAt: string | null; status: string | null; package: string | null; total: number; currency: string | null; utmCampaign: string | null; crmOrderId: number | null }>;
};

const day = (d: string | null | undefined) => (d ? format(new Date(d), "d MMM yyyy") : "—");
const titleCase = (s: string | null | undefined) => (s ? s.replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "—");
const orderHref = (o: { orderNumber: string | null; id: number }) => `/orders?order=${encodeURIComponent(o.orderNumber || String(o.id))}`;

export default function ClientsPage() {
  const { user } = useAuth();
  const [match, params] = useRoute<{ key: string }>("/clients/:key");
  if (user && user.role !== "admin" && user.role !== "support") return <Redirect to="/" />;
  return match ? <ClientProfile clientKey={params!.key} /> : <ClientList />;
}

function ClientList() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"recent" | "spent" | "orders">("recent");
  useEffect(() => { const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);
  const qs = new URLSearchParams({ page: String(page), pageSize: "50", sort, ...(debounced ? { search: debounced } : {}) });
  const { data, isLoading, isFetching } = useQuery<ClientList>({ queryKey: [`/api/clients?${qs}`], placeholderData: keepPreviousData });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="crm-page space-y-4">
      <PageHeader title="Clients" description="Every client is grouped by WhatsApp number from their orders." testId="header-clients" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricCard label={debounced ? "Matching clients" : "Clients"} value={(data?.total ?? 0).toLocaleString("en-PK")} icon={Users} testId="metric-clients-total" />
        <MetricCard label="Repeat clients" value={(data?.repeat ?? 0).toLocaleString("en-PK")} note={data?.total ? `${Math.round((data.repeat / data.total) * 100)}% ordered more than once` : undefined} icon={Repeat} tone="success" testId="metric-clients-repeat" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email or phone" className="pl-9" data-testid="input-client-search" />
        </div>
        <div className="flex rounded-lg border border-border bg-card p-1" role="group" aria-label="Sort">
          {([["recent", "Recent"], ["spent", "Top spend"], ["orders", "Most orders"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setSort(k); setPage(1); }} className={cn("min-h-8 rounded-md px-3 text-sm transition-colors", sort === k ? "bg-[hsl(var(--accent))] font-medium text-primary" : "text-slate-500 hover:text-foreground")} data-testid={`button-sort-${k}`}>{l}</button>
          ))}
        </div>
      </div>

      {isLoading ? <div className="skeleton h-96 rounded-xl" /> : (
        <>
          {/* Mobile cards */}
          <div className={cn("space-y-2 md:hidden", isFetching && "opacity-70")}>
            {data?.rows.map(c => (
              <Link key={c.key} href={`/clients/${c.key}`} className="block rounded-xl border border-border bg-card p-3" data-testid={`card-client-${c.key}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-slate-200">{c.name}</span>
                  <span className="text-sm font-semibold tabular-nums text-slate-200">{rupees(c.totalSpent)}</span>
                </div>
                <p className="text-xs text-slate-500">{c.phone} · {c.orderCount} order{c.orderCount === 1 ? "" : "s"} · last {day(c.lastOrderAt)}</p>
              </Link>
            ))}
          </div>
          {/* Desktop table */}
          <section className={cn("hidden overflow-hidden rounded-xl border border-border bg-card md:block", isFetching && "opacity-70")}>
            <div className="overflow-x-auto">
              <Table className="crm-table">
                <TableHeader>
                  <TableRow><TableHead>Client</TableHead><TableHead>Phone</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Spent</TableHead><TableHead>First order</TableHead><TableHead>Last order</TableHead><TableHead>Source</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {data?.rows.map(c => (
                    <TableRow key={c.key} className="cursor-pointer" data-testid={`row-client-${c.key}`}>
                      <TableCell><Link href={`/clients/${c.key}`} className="font-medium text-slate-200 hover:text-primary">{c.name}</Link>{c.email && <span className="block text-xs text-slate-500">{c.email}</span>}</TableCell>
                      <TableCell className="tabular-nums text-slate-400">{c.phone}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.orderCount}{c.placedCount > 1 && <span className="ml-1 rounded bg-emerald-500/10 px-1 text-xs text-emerald-400">repeat</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{rupees(c.totalSpent)}</TableCell>
                      <TableCell className="text-slate-400">{day(c.firstOrderAt)}</TableCell>
                      <TableCell className="text-slate-400">{day(c.lastOrderAt)}</TableCell>
                      <TableCell className="text-slate-400">{c.firstPlatform || "—"}{c.firstCampaign && <span className="block text-xs text-slate-500">{c.firstCampaign}</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
          {data && data.rows.length === 0 && <p className="py-10 text-center text-sm text-slate-500">No clients found.</p>}
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>Page {page} of {pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} data-testid="button-clients-prev"><ChevronLeft className="h-4 w-4" /> Prev</Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)} data-testid="button-clients-next">Next <ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const VERIFY_TONE: Record<string, string> = { approved: "bg-emerald-500/10 text-emerald-400", pending_confirmation: "bg-amber-500/10 text-amber-400", disapproved: "bg-rose-500/10 text-rose-400" };
function VerificationBadge({ status }: { status: string }) {
  return <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs", VERIFY_TONE[status] ?? "bg-slate-500/10 text-slate-400")}>{status === "pending_confirmation" ? "To verify" : titleCase(status)}</span>;
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-200">{title}{count !== undefined && <span className="ml-1.5 text-slate-500">{count}</span>}</h2>
      {children}
    </section>
  );
}

function ClientProfile({ clientKey }: { clientKey: string }) {
  const { data, isLoading, error } = useQuery<ClientDetail>({ queryKey: [`/api/clients/${clientKey}`] });
  if (isLoading) return <div className="crm-page space-y-4"><div className="skeleton h-24 rounded-xl" /><div className="skeleton h-72 rounded-xl" /></div>;
  if (error || !data) {
    return (
      <div className="crm-page space-y-4">
        <Link href="/clients" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Clients</Link>
        <p className="text-slate-400">Client not found.</p>
      </div>
    );
  }
  const { profile: p, source } = data;
  const latest = data.orders[0];
  const balance = data.orders.filter(o => o.status !== "canceled").reduce((s, o) => s + (o.remainingAmount || 0), 0);
  const approvedPaid = data.payments.filter(x => x.status === "approved").reduce((s, x) => s + x.amount, 0);

  return (
    <div className="crm-page space-y-4">
      <Link href="/clients" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-foreground" data-testid="link-back-clients"><ArrowLeft className="h-4 w-4" /> Clients</Link>
      <PageHeader
        title={p.name}
        description={[p.phone, p.email].filter(Boolean).join(" · ")}
        testId="header-client-profile"
        actions={<WhatsAppQuickReply phone={p.phone} vars={{ name: p.name.split(" ")[0], order: latest?.orderNumber ?? "", balance: balance ? rupees(balance) : "" }} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total spent" value={rupees(p.totalSpent)} note={`${p.placedCount} placed order${p.placedCount === 1 ? "" : "s"}`} icon={Wallet} testId="metric-client-spent" />
        <MetricCard label="Orders" value={p.orderCount} note={p.placedCount > 1 ? "Repeat client" : undefined} icon={ShoppingBag} tone={p.placedCount > 1 ? "success" : "cyan"} testId="metric-client-orders" />
        <MetricCard label="First order" value={day(p.firstOrderAt)} note={`Last: ${day(p.lastOrderAt)}`} testId="metric-client-first" />
        <MetricCard label="Balance due" value={rupees(balance)} note={`Verified payments ${rupees(approvedPaid)}`} tone={balance > 0 ? "warning" : "success"} testId="metric-client-balance" />
      </div>

      <section className="rounded-xl border border-border bg-card p-4 text-sm" data-testid="card-client-source">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">Source</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <div><dt className="text-xs text-slate-500">First platform</dt><dd className="text-slate-300">{p.firstPlatform || "—"}</dd></div>
          <div><dt className="text-xs text-slate-500">Campaign</dt><dd className="text-slate-300">{source?.utmCampaign || p.firstCampaign || "—"}</dd></div>
          <div><dt className="text-xs text-slate-500">UTM source / medium</dt><dd className="text-slate-300">{source ? [source.utmSource, source.utmMedium].filter(Boolean).join(" / ") || "—" : "—"}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-slate-500">Landing page</dt><dd className="truncate text-slate-300" title={source?.landingPage ?? ""}>{source?.landingPage || "—"}</dd></div>
        </dl>
      </section>

      <Section title="Orders" count={data.orders.length}>
        <div className="overflow-x-auto">
          <Table className="crm-table min-w-[720px]">
            <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Designer</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.orders.map(o => (
                <TableRow key={o.id} data-testid={`row-client-order-${o.id}`}>
                  <TableCell><Link href={orderHref(o)} className="font-medium text-primary hover:underline">{o.orderNumber || `Request #${o.id}`}</Link></TableCell>
                  <TableCell className="text-slate-400">{day(o.createdAt)}</TableCell>
                  <TableCell className="text-slate-400">{titleCase(o.packageType && o.packageType !== "custom" ? o.packageType : o.orderType)}</TableCell>
                  <TableCell><OrderStatusBadge status={o.status} /></TableCell>
                  <TableCell className="text-slate-400">{o.designerName || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{rupees(o.totalPrice - o.discountAmount)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", o.remainingAmount > 0 && o.status !== "canceled" ? "text-amber-400" : "text-slate-500")}>{rupees(o.remainingAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Payments" count={data.payments.length}>
          {data.payments.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No payment records.</p> : (
            <ul className="divide-y divide-border">
              {data.payments.map(x => (
                <li key={x.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span><span className="text-slate-200">{rupees(x.amount)}</span> <span className="text-slate-500">· {titleCase(x.paymentType)} · {x.orderNumber || `#${x.orderId}`} · {day(x.createdAt)}</span></span>
                  <VerificationBadge status={x.status} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Complaints" count={data.complaints.length}>
          {data.complaints.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No complaints.</p> : (
            <ul className="divide-y divide-border">
              {data.complaints.map(c => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <Link href={`/complaints/${c.id}`} className="min-w-0 truncate text-slate-200 hover:text-primary">{c.complaintNumber} <span className="text-slate-500">· {titleCase(c.category)} · {c.orderNumber}</span></Link>
                  <StatusBadge kind="complaint" status={c.status} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {data.websiteOrders.length > 0 && (
        <Section title="Website checkouts" count={data.websiteOrders.length}>
          <ul className="divide-y divide-border">
            {data.websiteOrders.map(w => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="text-slate-200">{titleCase(w.package)} <span className="text-slate-500">· {day(w.createdAt)}{w.utmCampaign ? ` · ${w.utmCampaign}` : ""}</span></span>
                <span className="text-slate-400">{w.currency && w.currency !== "PKR" ? `${w.currency} ${(w.total / 100).toLocaleString()}` : rupees(w.total)} · {titleCase(w.status)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
