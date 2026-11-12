import { useMemo, useState } from "react";
import { recordExport } from "@/lib/http";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Redirect } from "wouter";
import { format } from "date-fns";
import {
  Activity, AlertTriangle, BarChart3, CalendarDays, CheckCircle2, ChevronRight,
  Download, FileText, Headphones, Layers, Megaphone, MessageSquare, Package,
  Palette, Star, ThumbsUp, Users, XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { AnalyticsSkeleton } from "@/components/PageSkeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ComplaintDetails } from "./ComplaintsPage";
import { ReviewDetails, SuggestionDetails } from "./FeedbackPage";
import { MetricCard as CRMMetricCard, PageHeader } from "@/components/CRMPrimitives";

type Order = {
  id: number; orderNumber?: string | null; clientName: string; status: string;
  assignedToId?: number | null; readyDate?: string | null; createdAt?: string | null;
  canceledAt?: string | null; advancePaymentStatus?: string | null; createdById?: number | null;
  platform?: string | null; campaign?: string | null; adSet?: string | null; creative?: string | null;
  advanceAmount?: number; remainingAmount?: number; advanceRefunded?: boolean | null; refundAmount?: number | null;
  services?: { serviceType: string; quantity: number }[];
};
type User = { id: number; name: string; username: string; role: string; isActive: boolean };
type Complaint = { id: number; complaintNumber: string; orderId: number; complaintAgainstUserId?: number | null; complaintAgainst?: User; category: string; description: string; status: string; resolutionOutcome?: string | null; createdAt?: string | Date | null };
type Review = { id: number; reviewNumber: string; orderId: number; orderNumber?: string | null; clientName: string; reviewForDesigner?: User | null; rating: number | null; feedbackText: string; whatsappFeedbackReceived: boolean; facebookReviewReceived: boolean; videoReviewReceived: boolean; marketingPermission: string; createdAt: string | Date | null; updatedAt: string | Date | null };
type Suggestion = { id: number; suggestionNumber: string; orderId: number; orderNumber?: string | null; clientName: string; relatedDesigner?: User | null; suggestionText: string; status: "new" | "implemented" | "rejected"; createdAt: string | Date | null; updatedAt?: string | Date | null };

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const years = [2024, 2025, 2026, 2027];
const title = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
const dateLabel = (value?: string | Date | null) => value ? format(new Date(value), "MMM d, yyyy") : "—";

function Metric({ icon: Icon, label, value, note, tone = "cyan" }: { icon: typeof Users; label: string; value: string | number; note?: string; tone?: string }) {
  const cardTone = tone === "amber" ? "warning" : tone === "emerald" ? "success" : tone === "rose" ? "danger" : "cyan";
  return <CRMMetricCard label={label} value={value} icon={Icon} tone={cardTone} note={note} />;
}

function Empty({ title: heading, copy }: { title: string; copy: string }) {
  return <div className="flex flex-col items-center justify-center px-6 py-14 text-center"><div className="mb-4 rounded-full border border-slate-700 bg-slate-900 p-3 text-cyan-300"><Activity className="h-5 w-5" /></div><p className="font-medium text-slate-300">{heading}</p><p className="mt-1 max-w-sm text-sm text-slate-500">{copy}</p></div>;
}

type DesignerCounts = { id: number; assigned: number; active: number; completed: number; canceled: number };
type DesignerAnalytics = { team: { active: number; completed: number }; designers: DesignerCounts[] };
type DesignerOrder = { id: number; orderNumber: string | null; clientName: string; status: string; createdAt: string | null; readyDate: string | null };
type MarketingAnalytics = { total: number; rows: Array<{ platform: string; campaign: string; adSet: string; creative: string; orders: number }> };
type SupportAgentRow = { id: number; totalOrders: number; monthOrders: number; dayOrders: number; revenue: number; collected: number; pending: number };
type SupportAnalytics = { monthAll: number; monthApproved: number; monthRevenue: number; dayApproved: number; agents: SupportAgentRow[]; dayOrders: Array<{ id: number; orderNumber: string | null; clientName: string; status: string; createdAt: string | null; createdById: number | null }> };

// jsPDF is ~400 KB; load it only when a PDF is exported.
const loadPdf = async () => {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  return { jsPDF, autoTable };
};

/** platform → campaign → ad set → creative → count, built from grouped SQL rows. */
function buildMarketingTree(rows: MarketingAnalytics["rows"]) {
  const tree = new Map<string, { total: number; campaigns: Map<string, { total: number; adSets: Map<string, { total: number; creatives: Map<string, number> }> }> }>();
  for (const r of rows) {
    const p = tree.get(r.platform) ?? { total: 0, campaigns: new Map() };
    tree.set(r.platform, p);
    p.total += r.orders;
    const c = p.campaigns.get(r.campaign) ?? { total: 0, adSets: new Map() };
    p.campaigns.set(r.campaign, c);
    c.total += r.orders;
    const a = c.adSets.get(r.adSet) ?? { total: 0, creatives: new Map() };
    c.adSets.set(r.adSet, a);
    a.total += r.orders;
    a.creatives.set(r.creative, (a.creatives.get(r.creative) ?? 0) + r.orders);
  }
  return Array.from(tree, ([name, p]) => ({ name, total: p.total, campaigns: Array.from(p.campaigns, ([campaign, c]) => ({ campaign, total: c.total, adSets: Array.from(c.adSets, ([adSet, a]) => ({ adSet, total: a.total, creatives: Array.from(a.creatives, ([creative, count]) => ({ creative, count })) })) })) }));
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<"all" | "selected">("selected");
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth()));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [marketingMonth, setMarketingMonth] = useState(String(now.getMonth()));
  const [marketingYear, setMarketingYear] = useState(String(now.getFullYear()));
  const [supportDay, setSupportDay] = useState(String(now.getDate()));
  const [supportMonth, setSupportMonth] = useState(String(now.getMonth()));
  const [supportYear, setSupportYear] = useState(String(now.getFullYear()));
  const [designerId, setDesignerId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState("overview");
  const [caseType, setCaseType] = useState<"complaint" | "review" | "suggestion" | null>(null);
  const [caseId, setCaseId] = useState<number | null>(null);

  const isAdmin = user?.role === "admin";
  // Every order number on this page is a SQL aggregate from server/metrics.ts.
  const rangeQs = `period=${period === "all" ? "all" : "month"}&year=${year}&month=${Number(month) + 1}`;
  const designerQ = useQuery<DesignerAnalytics>({ queryKey: [`/api/analytics/designers?${rangeQs}`], enabled: isAdmin, placeholderData: keepPreviousData });
  const designerOrdersQ = useQuery<DesignerOrder[]>({ queryKey: [`/api/analytics/designers/${designerId}/orders?${rangeQs}`], enabled: isAdmin && designerId != null });
  const marketingQ = useQuery<MarketingAnalytics>({ queryKey: [`/api/analytics/marketing?year=${marketingYear}&month=${Number(marketingMonth) + 1}`], enabled: isAdmin, placeholderData: keepPreviousData });
  const supportQ = useQuery<SupportAnalytics>({ queryKey: [`/api/analytics/support?year=${supportYear}&month=${Number(supportMonth) + 1}&day=${supportDay}`], enabled: isAdmin, placeholderData: keepPreviousData });
  const usersQ = useQuery<User[]>({ queryKey: ["/api/users"], staleTime: 300000 });
  const complaintsQ = useQuery<Complaint[]>({ queryKey: ["/api/complaints"], enabled: isAdmin });
  const reviewsQ = useQuery<Review[]>({ queryKey: ["/api/feedback/reviews"], enabled: isAdmin });
  const suggestionsQ = useQuery<Suggestion[]>({ queryKey: ["/api/feedback/suggestions"], enabled: isAdmin });
  const marketingTree = useMemo(() => buildMarketingTree(marketingQ.data?.rows ?? []), [marketingQ.data]);
  if (!isAdmin) return <Redirect to="/" />;
  if (designerQ.isLoading || usersQ.isLoading) return <AnalyticsSkeleton />;
  if (designerQ.isError || usersQ.isError) return <div className="p-8"><div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-8 text-center"><AlertTriangle className="mx-auto mb-3 text-rose-300" /><p className="font-medium text-slate-200">Analytics could not load</p><Button className="mt-4" variant="outline" onClick={() => { void designerQ.refetch(); void usersQ.refetch(); }}>Retry</Button></div></div>;

  const users = usersQ.data || [], complaints = complaintsQ.data || [], reviews = reviewsQ.data || [], suggestions = suggestionsQ.data || [];
  const counts = new Map((designerQ.data?.designers ?? []).map(d => [d.id, d]));
  const designers = users.filter(u => u.role === "designer" || counts.has(u.id));
  const inPeriod = (value?: string | Date | null) => period === "all" || (!!value && new Date(value).getMonth() === Number(month) && new Date(value).getFullYear() === Number(year));
  const metrics = (d: User) => {
    const c = counts.get(d.id) ?? { assigned: 0, active: 0, completed: 0, canceled: 0 };
    const confirmed = complaints.filter(x => x.complaintAgainstUserId === d.id && x.status === "confirmed" && inPeriod(x.createdAt));
    const designerReviews = reviews.filter(r => r.reviewForDesigner?.id === d.id && inPeriod(r.createdAt));
    const rated = designerReviews.filter(r => r.rating != null);
    const designerSuggestions = suggestions.filter(s => s.relatedDesigner?.id === d.id && inPeriod(s.createdAt));
    return { assignedCount: c.assigned, active: c.active, completed: c.completed, canceled: c.canceled, confirmed: confirmed.length, reviewCount: designerReviews.length, rating: rated.length ? rated.reduce((a, r) => a + Number(r.rating), 0) / rated.length : null, suggestions: designerSuggestions.length, implemented: designerSuggestions.filter(s => s.status === "implemented").length };
  };
  const rows = designers.map(d => ({ designer: d, metrics: metrics(d) }));
  const teamActive = designerQ.data?.team.active ?? 0;
  const teamCompleted = designerQ.data?.team.completed ?? 0;
  const avgRating = rows.flatMap(r => reviews.filter(v => v.reviewForDesigner?.id === r.designer.id && v.rating != null && inPeriod(v.createdAt)).map(v => Number(v.rating))).reduce((a, v, _, arr) => a + v / (arr.length || 1), 0);
  const confirmedCount = complaints.filter(c => c.status === "confirmed" && c.complaintAgainstUserId != null && inPeriod(c.createdAt)).length;
  const implemented = suggestions.filter(s => s.status === "implemented" && inPeriod(s.createdAt)).length;
  const selectedDesigner = designers.find(d => d.id === designerId);
  const selectedMetrics = selectedDesigner ? metrics(selectedDesigner) : null;
  const designerOrders = designerOrdersQ.data ?? [];
  const openCase = (type: typeof caseType, id: number) => { setCaseType(type); setCaseId(id); };
  const exportDesignerPDF = async () => {
    const { jsPDF, autoTable } = await loadPdf();
    const doc = new jsPDF({ orientation: "landscape" });
    const filterLabel = period === "all" ? "All time" : `${months[Number(month)]} ${year}`;
    doc.setFontSize(18); doc.text("PixelCRM Designer Performance", 14, 20);
    doc.setFontSize(10); doc.text(`Period: ${filterLabel}   |   Generated: ${format(new Date(), "MMM d, yyyy h:mm a")}`, 14, 29);
    doc.text(`Team summary: ${designers.length} designers · ${teamActive} active orders · ${teamCompleted} completed · ${confirmedCount} confirmed complaints`, 14, 37);
    autoTable(doc, { startY: 45, head: [["Designer", "Active", "Completed", "Canceled", "Confirmed complaints", "Reviews", "Average rating", "Suggestions", "Implemented"]], body: rows.map(({ designer: d, metrics: m }) => [d.name, m.active, m.completed, m.canceled, m.confirmed, m.reviewCount, m.rating == null ? "No Ratings" : m.rating.toFixed(1), m.suggestions, m.implemented]), headStyles: { fillColor: [13, 148, 136] }, styles: { fontSize: 8 } });
    doc.save(`pixelcrm-designer-performance-${period === "all" ? "all-time" : `${year}-${String(Number(month) + 1).padStart(2, "0")}`}.pdf`);
    void recordExport("analytics: designer performance", "pdf");
  };

  const marketingTotal = marketingQ.data?.total ?? 0;
  const support = supportQ.data;
  const maxDay = new Date(Number(supportYear), Number(supportMonth) + 1, 0).getDate();
  const supportAgents = users.filter(u => u.role === "support");
  const agentRows = new Map((support?.agents ?? []).map(a => [a.id, a]));
  const supportAgentMetrics = (agent: User): SupportAgentRow => agentRows.get(agent.id) ?? { id: agent.id, totalOrders: 0, monthOrders: 0, dayOrders: 0, revenue: 0, collected: 0, pending: 0 };
  const supportDayOrders = support?.dayOrders ?? [];
  const exportTablePDF = async (kind: "marketing" | "support") => {
    const { jsPDF, autoTable } = await loadPdf();
    const doc = new jsPDF({ orientation: "landscape" });
    const label = kind === "marketing" ? `${months[Number(marketingMonth)]} ${marketingYear}` : `${months[Number(supportMonth)]} ${supportYear}`;
    doc.setFontSize(18);
    doc.text(kind === "marketing" ? "PixelCRM Marketing Analytics" : "PixelCRM Support Performance", 14, 20);
    doc.setFontSize(10);
    doc.text(`Period: ${label}  |  Generated: ${format(new Date(), "MMM d, yyyy h:mm a")}`, 14, 29);
    if (kind === "marketing") {
      const body: (string | number)[][] = [];
      marketingTree.forEach(platform => {
        body.push([platform.name, "", "", "", platform.total]);
        (marketingQ.data?.rows ?? []).filter(r => r.platform === platform.name).forEach(r => body.push(["", r.campaign, r.adSet, r.creative, r.orders]));
      });
      autoTable(doc, { startY: 38, head: [["Platform", "Campaign", "Ad Set", "Creative", "Orders"]], body, headStyles: { fillColor: [13, 148, 136] }, styles: { fontSize: 8 } });
      doc.save(`pixelcrm-marketing-${marketingYear}-${Number(marketingMonth) + 1}.pdf`);
      void recordExport("analytics: marketing", "pdf");
    } else {
      autoTable(doc, { startY: 38, head: [["Agent", "All approved", "Month orders", "Day orders", "Revenue", "Collected", "Pending"]], body: supportAgents.map(agent => { const m = supportAgentMetrics(agent); return [agent.name, m.totalOrders, m.monthOrders, m.dayOrders, `Rs ${Math.round(m.revenue / 100).toLocaleString()}`, `Rs ${Math.round(m.collected / 100).toLocaleString()}`, `Rs ${Math.round(m.pending / 100).toLocaleString()}`]; }), headStyles: { fillColor: [13, 148, 136] }, styles: { fontSize: 8 } });
      doc.save(`pixelcrm-support-${supportYear}-${Number(supportMonth) + 1}.pdf`);
      void recordExport("analytics: support", "pdf");
    }
  };

  return <div className="crm-page space-y-5">
    <PageHeader eyebrow="Performance analytics" title="Analytics" description="Workload and client experience, without composite scores." actions={<div className="text-right text-xs text-slate-600">Updated {format(new Date(), "MMM d, h:mm a")}</div>} testId="text-analytics-title" />
    <Tabs defaultValue="designers" className="w-full"><TabsList className="mb-5 h-auto flex-wrap justify-start gap-1 rounded-xl border border-slate-800 bg-slate-900/70 p-1"><TabsTrigger value="designers" className="gap-2 rounded-lg px-4 py-2 data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-200"><Users className="h-4 w-4" />Designer Performance</TabsTrigger><TabsTrigger value="marketing" className="gap-2 rounded-lg px-4 py-2 data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-200"><Megaphone className="h-4 w-4" />Marketing Analytics</TabsTrigger><TabsTrigger value="support" className="gap-2 rounded-lg px-4 py-2 data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-200"><Headphones className="h-4 w-4" />Support Performance</TabsTrigger></TabsList>
      <TabsContent value="designers" className="space-y-5">
        <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Period</span><div className="flex rounded-lg border border-slate-700 bg-slate-950 p-1"><button className={cn("rounded-md px-3 py-1.5 text-sm", period === "selected" ? "bg-cyan-500/15 text-cyan-200" : "text-slate-500")} onClick={() => setPeriod("selected")}>Selected period</button><button className={cn("rounded-md px-3 py-1.5 text-sm", period === "all" ? "bg-cyan-500/15 text-cyan-200" : "text-slate-500")} onClick={() => setPeriod("all")}>All time</button></div>{period === "selected" && <><Select value={month} onValueChange={setMonth}><SelectTrigger className="w-32 border-slate-700 bg-slate-950"><CalendarDays className="mr-2 h-4 w-4 text-slate-500" /><SelectValue /></SelectTrigger><SelectContent>{months.map((m, i) => <SelectItem key={m} value={String(i)}>{m}</SelectItem>)}</SelectContent></Select><Select value={year} onValueChange={setYear}><SelectTrigger className="w-24 border-slate-700 bg-slate-950"><SelectValue /></SelectTrigger><SelectContent>{years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select></>}</div><Button variant="outline" className="border-slate-700" onClick={exportDesignerPDF}><Download className="mr-2 h-4 w-4" />Export PDF</Button></div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Metric icon={Users} label="Designers" value={designers.length} note="Team members in reporting" /><Metric icon={Activity} label="Active orders" value={teamActive} /><Metric icon={CheckCircle2} label="Completed" value={teamCompleted} note="Completed during this period" /><Metric icon={AlertTriangle} label="Confirmed complaints" value={confirmedCount} note="Only confirmed cases are negative quality signals" tone="amber" /><Metric icon={Star} label="Average rating" value={avgRating ? avgRating.toFixed(1) : "No Ratings"} note={avgRating ? "Across rated reviews" : "No rated reviews"} tone="amber" /><Metric icon={ThumbsUp} label="Implemented suggestions" value={implemented} tone="emerald" /></div>
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40"><div className="flex flex-col gap-2 border-b border-slate-800 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-slate-200">Designer workload and experience</h2><p className="mt-1 text-xs text-slate-500">Counts are scoped to {period === "all" ? "all recorded time" : `${months[Number(month)]} ${year}`}. No ranking or composite score.</p></div><span className="text-xs text-slate-600">{rows.length} rows</span></div><div className="overflow-x-auto"><Table><TableHeader><TableRow className="border-slate-800 hover:bg-transparent"><TableHead>Designer</TableHead><TableHead>Active</TableHead><TableHead>Completed</TableHead><TableHead>Canceled</TableHead><TableHead>Confirmed complaints</TableHead><TableHead>Reviews / rating</TableHead><TableHead>Suggestions</TableHead><TableHead className="text-right">Details</TableHead></TableRow></TableHeader><TableBody>{rows.map(({ designer: d, metrics: m }) => <TableRow key={d.id} data-testid={`row-designer-${d.id}`} className="border-slate-800/70 transition-colors hover:bg-cyan-400/[.03]"><TableCell><div className="flex min-w-[170px] items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 font-semibold text-cyan-200">{d.name.slice(0, 1).toUpperCase()}</div><div><p className="font-medium text-slate-200">{d.name}</p><p className="text-xs text-slate-600">@{d.username}</p></div><Badge variant="outline" className={cn("ml-1 text-[10px]", d.isActive ? "border-emerald-500/30 text-emerald-300" : "border-slate-700 text-slate-600")}>{d.isActive ? "Active" : "Inactive"}</Badge></div></TableCell><TableCell>{m.active}</TableCell><TableCell className="font-medium text-cyan-200">{m.completed}</TableCell><TableCell className={m.canceled ? "text-rose-300" : "text-slate-500"}>{m.canceled}</TableCell><TableCell className={m.confirmed ? "text-amber-300" : "text-slate-500"}>{m.confirmed}</TableCell><TableCell>{m.reviewCount ? <span className="inline-flex items-center gap-2">{m.reviewCount} <span className="text-amber-300"><Star className="mr-1 inline h-3 w-3 fill-current" />{m.rating?.toFixed(1) || "—"}</span></span> : <span className="text-slate-600">No Ratings</span>}</TableCell><TableCell>{m.suggestions} <span className="text-xs text-emerald-300">{m.implemented ? `· ${m.implemented} implemented` : ""}</span></TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" className="text-cyan-300 hover:bg-cyan-400/10 hover:text-cyan-200" onClick={() => { setDesignerId(d.id); setDetailTab("overview"); }}>View Details<ChevronRight className="ml-1 h-4 w-4" /></Button></TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={8}><Empty title="No designers found" copy="Designer accounts and assigned work will appear here once available." /></TableCell></TableRow>}</TableBody></Table></div></section>
      </TabsContent>
      <TabsContent value="marketing" className="space-y-5">
        <FilterBar month={marketingMonth} year={marketingYear} setMonth={setMarketingMonth} setYear={setMarketingYear} count={`${marketingTotal} orders`} />
        <div className="flex justify-end"><Button variant="outline" onClick={() => exportTablePDF("marketing")}><Download className="mr-2 h-4 w-4" />Export PDF</Button></div>
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          <SectionTitle icon={Megaphone} title="Platform breakdown" copy="Where clients are coming from, with campaign, ad set, and creative context." />
          {marketingTree.length ? <div className="divide-y divide-slate-800">{marketingTree.map(platform => <div className="p-5" key={platform.name}>
              <div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="rounded-lg bg-orange-400/10 p-2 text-orange-300"><Megaphone className="h-4 w-4" /></div><div><p className="font-medium text-slate-200">{platform.name}</p><p className="text-xs text-slate-600">Platform</p></div></div><span className="font-mono text-xl text-slate-200">{platform.total}</span></div>
              <div className="mt-4 space-y-2 pl-9">{platform.campaigns.map(c => <div className="rounded-lg bg-slate-950/50 p-3" key={c.campaign}><div className="flex justify-between text-sm"><span className="flex items-center gap-2 text-slate-300"><Layers className="h-3.5 w-3.5 text-cyan-300" />{c.campaign}</span><span className="text-slate-500">{c.total} orders</span></div><div className="mt-2 space-y-2 pl-5">{c.adSets.map(a => <div key={a.adSet}><div className="flex justify-between text-xs text-slate-400"><span>{a.adSet}</span><span>{a.total}</span></div><div className="mt-1 space-y-1 pl-4">{a.creatives.map(cr => <div className="flex justify-between text-xs text-slate-600" key={cr.creative}><span className="flex items-center gap-1"><Palette className="h-3 w-3 text-cyan-300" />{cr.creative}</span><span>{cr.count}</span></div>)}</div></div>)}</div></div>)}</div>
            </div>)}</div> : <Empty title="No platform data yet" copy="Tag orders with a platform to see acquisition patterns." />}
        </section>
      </TabsContent>
      <TabsContent value="support" className="space-y-5">
        <FilterBar month={supportMonth} year={supportYear} setMonth={setSupportMonth} setYear={setSupportYear} count={`${support?.monthAll ?? 0} orders`} day={supportDay} setDay={setSupportDay} maxDay={maxDay} />
        <div className="flex justify-end"><Button variant="outline" onClick={() => exportTablePDF("support")}><Download className="mr-2 h-4 w-4" />Export PDF</Button></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Metric icon={Package} label="Monthly orders" value={support?.monthApproved ?? 0} note="Approved orders this month" /><Metric icon={MessageSquare} label="Monthly revenue" value={`Rs ${Math.round((support?.monthRevenue ?? 0) / 100).toLocaleString()}`} note="Collected + remaining" /><Metric icon={FileText} label="Selected-day orders" value={support?.dayApproved ?? 0} note={`${months[Number(supportMonth)]} ${supportDay}, ${supportYear}`} /></div>
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40"><SectionTitle icon={Headphones} title="Support agent monthly summary" copy="Approved orders placed by each support agent." /><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Agent</TableHead><TableHead>All approved</TableHead><TableHead>Month orders</TableHead><TableHead>Day orders</TableHead><TableHead>Revenue</TableHead><TableHead>Collected</TableHead><TableHead>Pending</TableHead></TableRow></TableHeader><TableBody>{supportAgents.map(agent => { const m = supportAgentMetrics(agent); return <TableRow key={agent.id}><TableCell className="font-medium">{agent.name}</TableCell><TableCell>{m.totalOrders}</TableCell><TableCell>{m.monthOrders}</TableCell><TableCell>{m.dayOrders}</TableCell><TableCell>Rs {Math.round(m.revenue / 100).toLocaleString()}</TableCell><TableCell className="text-emerald-300">Rs {Math.round(m.collected / 100).toLocaleString()}</TableCell><TableCell className="text-amber-300">Rs {Math.round(m.pending / 100).toLocaleString()}</TableCell></TableRow>; })}{!supportAgents.length && <TableRow><TableCell colSpan={7}><Empty title="No support agents found" copy="Support team activity will appear here when accounts are active." /></TableCell></TableRow>}</TableBody></Table></div></section>
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40"><SectionTitle icon={FileText} title="Selected-day order activity" copy="Orders created on the selected day, with status and client context." /><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Client</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead>Agent</TableHead></TableRow></TableHeader><TableBody>{supportDayOrders.map(o => <TableRow key={o.id}><TableCell className="font-mono text-cyan-200">{o.orderNumber || `#${o.id}`}</TableCell><TableCell>{o.clientName}</TableCell><TableCell><Badge variant="outline">{title(o.status)}</Badge></TableCell><TableCell>{dateLabel(o.createdAt)}</TableCell><TableCell>{users.find(u => u.id === o.createdById)?.name || "—"}</TableCell></TableRow>)}{!supportDayOrders.length && <TableRow><TableCell colSpan={5}><Empty title="No orders on this day" copy="Try another day or month to inspect support activity." /></TableCell></TableRow>}</TableBody></Table></div></section>
      </TabsContent>
    </Tabs>
    <Sheet open={Boolean(selectedDesigner)} onOpenChange={open => !open && setDesignerId(null)}><SheetContent className="w-full overflow-y-auto border-slate-800 bg-slate-950 text-slate-100 sm:max-w-2xl"><SheetHeader className="border-b border-slate-800 pb-5 pr-8 text-left"><SheetTitle><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/15 text-lg font-semibold text-cyan-200">{selectedDesigner?.name.slice(0, 1)}</div><div><p>{selectedDesigner?.name}</p><p className="mt-1 text-xs font-normal text-slate-500">{period === "all" ? "All time" : `${months[Number(month)]} ${year}`} · {selectedDesigner?.isActive ? "Active" : "Inactive"}</p></div></div></SheetTitle></SheetHeader>{selectedDesigner && selectedMetrics && <div className="mt-5 space-y-5"><div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1"><button onClick={() => setDetailTab("overview")} className={cn("flex-1 rounded-md px-3 py-2 text-sm", detailTab === "overview" ? "bg-cyan-500/15 text-cyan-200" : "text-slate-500")}>Overview</button><button onClick={() => setDetailTab("orders")} className={cn("flex-1 rounded-md px-3 py-2 text-sm", detailTab === "orders" ? "bg-cyan-500/15 text-cyan-200" : "text-slate-500")}>Orders ({selectedMetrics.assignedCount})</button><button onClick={() => setDetailTab("experience")} className={cn("flex-1 rounded-md px-3 py-2 text-sm", detailTab === "experience" ? "bg-cyan-500/15 text-cyan-200" : "text-slate-500")}>Client Experience</button></div>{detailTab === "overview" && <div className="grid grid-cols-2 gap-3"><Metric icon={Activity} label="Active orders" value={selectedMetrics.active} /><Metric icon={CheckCircle2} label="Completed" value={selectedMetrics.completed} /><Metric icon={XCircle} label="Canceled" value={selectedMetrics.canceled} tone="rose" /><Metric icon={AlertTriangle} label="Confirmed complaints" value={selectedMetrics.confirmed} tone="amber" /><Metric icon={Star} label="Average rating" value={selectedMetrics.rating?.toFixed(1) || "No Ratings"} tone="amber" /><Metric icon={ThumbsUp} label="Suggestions" value={`${selectedMetrics.implemented}/${selectedMetrics.suggestions}`} note="Implemented / total" tone="emerald" /></div>}{detailTab === "orders" && <div className="space-y-2">{designerOrdersQ.isLoading ? <p className="p-4 text-sm text-slate-500">Loading orders…</p> : designerOrders.length ? designerOrders.map(o => <button key={o.id} className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-left transition-colors hover:border-cyan-400/30" onClick={() => window.location.assign(`/orders?order=${encodeURIComponent(o.orderNumber || String(o.id))}`)}><div><p className="font-mono text-sm text-cyan-200">{o.orderNumber || `#${o.id}`} <span className="font-sans text-slate-400">· {o.clientName}</span></p><p className="mt-1 text-xs text-slate-600">{title(o.status)} · Created {dateLabel(o.createdAt)}{o.readyDate ? ` · Ready ${dateLabel(o.readyDate)}` : ""}</p></div><ChevronRight className="h-4 w-4 text-slate-600" /></button>) : <Empty title="No assigned orders" copy="This designer has no orders in the selected period." />}</div>}{detailTab === "experience" && <Experience designer={selectedDesigner} complaints={complaints} reviews={reviews} suggestions={suggestions} inPeriod={inPeriod} openCase={openCase} />}</div>}</SheetContent></Sheet>
    {caseType === "complaint" && <ComplaintDetails id={caseId} open onOpenChange={open => !open && setCaseType(null)} onBack={() => setCaseType(null)} />}{caseType === "review" && <ReviewDetails review={reviews.find(r => r.id === caseId) as any || null} open onOpenChange={open => !open && setCaseType(null)} onEdit={() => undefined} onOpenOrder={id => window.location.assign(`/orders?order=${id}`)} onBack={() => setCaseType(null)} />}{caseType === "suggestion" && <SuggestionDetails suggestion={suggestions.find(s => s.id === caseId) as any || null} open onOpenChange={open => !open && setCaseType(null)} onOpenOrder={id => window.location.assign(`/orders?order=${id}`)} onUpdated={() => undefined} onBack={() => setCaseType(null)} />}
  </div>;
}

function FilterBar({ month, year, setMonth, setYear, count, day, setDay, maxDay }: { month: string; year: string; setMonth: (v: string) => void; setYear: (v: string) => void; count: string; day?: string; setDay?: (v: string) => void; maxDay?: number }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3"><div className="flex flex-wrap items-center gap-2"><CalendarDays className="h-4 w-4 text-slate-500" />{day && setDay && <Select value={day} onValueChange={setDay}><SelectTrigger className="w-20 border-slate-700 bg-slate-950"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: maxDay || 31 }, (_, i) => <SelectItem key={i} value={String(i + 1)}>{i + 1}</SelectItem>)}</SelectContent></Select>}<Select value={month} onValueChange={setMonth}><SelectTrigger className="w-32 border-slate-700 bg-slate-950"><SelectValue /></SelectTrigger><SelectContent>{months.map((m, i) => <SelectItem key={m} value={String(i)}>{m}</SelectItem>)}</SelectContent></Select><Select value={year} onValueChange={setYear}><SelectTrigger className="w-24 border-slate-700 bg-slate-950"><SelectValue /></SelectTrigger><SelectContent>{years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select></div><span className="text-xs text-slate-500">{count}</span></div>;
}
function SectionTitle({ icon: Icon, title: heading, copy }: { icon: typeof Megaphone; title: string; copy: string }) { return <div className="border-b border-slate-800 p-5"><h2 className="flex items-center gap-2 font-semibold text-slate-200"><Icon className="h-4 w-4 text-cyan-300" />{heading}</h2><p className="mt-1 text-xs text-slate-500">{copy}</p></div>; }
function Experience({ designer, complaints, reviews, suggestions, inPeriod, openCase }: { designer: User; complaints: Complaint[]; reviews: Review[]; suggestions: Suggestion[]; inPeriod: (v?: string | Date | null) => boolean; openCase: (type: "complaint" | "review" | "suggestion", id: number) => void }) {
  const [feedbackView, setFeedbackView] = useState<"reviews" | "suggestions" | "complaints">("reviews");
  const cs = complaints.filter(c => c.complaintAgainstUserId === designer.id && c.status === "confirmed" && inPeriod(c.createdAt));
  const rs = reviews.filter(r => r.reviewForDesigner?.id === designer.id && inPeriod(r.createdAt));
  const ss = suggestions.filter(s => s.relatedDesigner?.id === designer.id && inPeriod(s.createdAt));

  const renderRecords = (items: Array<Complaint | Review | Suggestion>, type: "complaint" | "review" | "suggestion", emptyLabel: string) => (
    items.length ? (
      <div className="mt-3 space-y-2">
        {items.map(item => (
          <button
            key={item.id}
            onClick={() => openCase(type, item.id)}
            className="w-full rounded-lg border border-slate-800 p-3 text-left transition-colors hover:border-cyan-400/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            <div className="flex justify-between gap-3">
              <span className="font-mono text-xs text-cyan-200">
                {"complaintNumber" in item ? item.complaintNumber : "reviewNumber" in item ? item.reviewNumber : item.suggestionNumber}
              </span>
              <span className="text-xs text-slate-600">{dateLabel(item.createdAt)}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-slate-400">
              {"description" in item ? item.description : "feedbackText" in item ? item.feedbackText : item.suggestionText}
            </p>
          </button>
        ))}
      </div>
    ) : <p className="mt-3 text-xs text-slate-600">{emptyLabel}</p>
  );

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-medium text-slate-300">Client feedback</h3>
            <p className="mt-1 text-xs text-slate-600">Choose which feedback records to review for this designer.</p>
          </div>
          <Select value={feedbackView} onValueChange={(value) => setFeedbackView(value as "reviews" | "suggestions" | "complaints")}>
            <SelectTrigger className="w-full border-slate-700 bg-slate-950/80 text-slate-200 shadow-inner shadow-black/20 sm:w-[180px]" aria-label="Choose client experience type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-slate-700 bg-slate-900 text-slate-200">
              <SelectItem value="reviews">Reviews ({rs.length})</SelectItem>
              <SelectItem value="suggestions">Suggestions ({ss.length})</SelectItem>
              <SelectItem value="complaints">Complaints ({cs.length})</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="text-sm font-medium text-slate-300">
          {feedbackView === "reviews" ? "Reviews" : feedbackView === "suggestions" ? "Suggestions" : "Confirmed complaints"}
        </h3>
        {feedbackView === "reviews"
          ? renderRecords(rs, "review", "No reviews in this period.")
          : feedbackView === "suggestions"
            ? renderRecords(ss, "suggestion", "No suggestions in this period.")
            : renderRecords(cs, "complaint", "No confirmed complaints in this period.")}
      </section>
    </div>
  );
}