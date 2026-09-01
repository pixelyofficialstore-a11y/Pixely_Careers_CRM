import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Redirect } from "wouter";
import { format } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
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
import { getOrderAccounting } from "@shared/order-accounting";

type Order = {
  id: number; orderNumber?: string | null; clientName: string; status: string;
  assignedToId?: number | null; readyDate?: string | null; createdAt?: string | null;
  canceledAt?: string | null; advancePaymentStatus?: string | null; createdById?: number | null;
  platform?: string | null; campaign?: string | null; adSet?: string | null; creative?: string | null;
  advanceAmount?: number; remainingAmount?: number; advanceRefunded?: boolean | null; refundAmount?: number | null;
  services?: { serviceType: string; quantity: number }[];
};
type User = { id: number; name: string; username: string; role: string; isActive: boolean };
type Complaint = { id: number; complaintNumber: string; orderId: number; complaintAgainstUserId?: number; complaintAgainst?: User; category: string; description: string; status: string; resolutionOutcome?: string | null; createdAt?: string | Date | null };
type Review = { id: number; reviewNumber: string; orderId: number; orderNumber?: string | null; clientName: string; reviewForDesigner?: User | null; rating: number | null; feedbackText: string; whatsappFeedbackReceived: boolean; facebookReviewReceived: boolean; videoReviewReceived: boolean; marketingPermission: string; createdAt: string | Date | null; updatedAt: string | Date | null };
type Suggestion = { id: number; suggestionNumber: string; orderId: number; orderNumber?: string | null; clientName: string; relatedDesigner?: User | null; suggestionText: string; status: "new" | "implemented" | "rejected"; createdAt: string | Date | null; updatedAt?: string | Date | null };

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const years = [2024, 2025, 2026, 2027];
const title = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
const dateLabel = (value?: string | Date | null) => value ? format(new Date(value), "MMM d, yyyy") : "—";

function Metric({ icon: Icon, label, value, note, tone = "cyan" }: { icon: typeof Users; label: string; value: string | number; note?: string; tone?: string }) {
  const toneClasses: Record<string, string> = {
    cyan: "text-cyan-400",
    amber: "text-amber-400",
    emerald: "text-emerald-400",
    rose: "text-rose-400",
    slate: "text-slate-400",
  };
  return <div className="glass-panel rounded-xl border border-slate-800/80 p-4 transition-colors hover:border-cyan-400/30">
    <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-[.12em] text-slate-500">{label}</span><Icon className={cn("h-4 w-4", toneClasses[tone] || toneClasses.cyan)} /></div>
    <div className="mt-3 text-2xl font-semibold tracking-tight text-slate-100">{value}</div>
    {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
  </div>;
}

function Empty({ title: heading, copy }: { title: string; copy: string }) {
  return <div className="flex flex-col items-center justify-center px-6 py-14 text-center"><div className="mb-4 rounded-full border border-slate-700 bg-slate-900 p-3 text-cyan-300"><Activity className="h-5 w-5" /></div><p className="font-medium text-slate-300">{heading}</p><p className="mt-1 max-w-sm text-sm text-slate-500">{copy}</p></div>;
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

  const ordersQ = useQuery<Order[]>({ queryKey: ["/api/orders"], staleTime: 30000, refetchInterval: 60000 });
  const usersQ = useQuery<User[]>({ queryKey: ["/api/users"], staleTime: 300000 });
  const complaintsQ = useQuery<Complaint[]>({ queryKey: ["/api/complaints"], staleTime: 30000 });
  const reviewsQ = useQuery<Review[]>({ queryKey: ["/api/feedback/reviews"], staleTime: 30000 });
  const suggestionsQ = useQuery<Suggestion[]>({ queryKey: ["/api/feedback/suggestions"], staleTime: 30000 });
  if (user?.role !== "admin") return <Redirect to="/" />;
  if (ordersQ.isLoading || usersQ.isLoading) return <AnalyticsSkeleton />;
  if (ordersQ.isError || usersQ.isError) return <div className="p-8"><div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-8 text-center"><AlertTriangle className="mx-auto mb-3 text-rose-300" /><p className="font-medium text-slate-200">Analytics could not load</p><Button className="mt-4" variant="outline" onClick={() => { void ordersQ.refetch(); void usersQ.refetch(); }}>Retry</Button></div></div>;

  const orders = ordersQ.data || [], users = usersQ.data || [], complaints = complaintsQ.data || [], reviews = reviewsQ.data || [], suggestions = suggestionsQ.data || [];
  const designers = users.filter(u => u.role === "designer" || orders.some(o => o.assignedToId === u.id));
  const inPeriod = (value?: string | Date | null) => period === "all" || (!!value && new Date(value).getMonth() === Number(month) && new Date(value).getFullYear() === Number(year));
  const completed = (o: Order) => (o.status === "ready" || o.status === "delivered") && o.advancePaymentStatus === "approved";
  const metrics = (d: User) => {
    const assigned = orders.filter(o => o.assignedToId === d.id && inPeriod(o.createdAt));
    const completedOrders = orders.filter(o => o.assignedToId === d.id && completed(o) && inPeriod(o.readyDate || o.createdAt));
    const canceledOrders = orders.filter(o => o.assignedToId === d.id && o.status === "canceled" && inPeriod(o.canceledAt || o.createdAt));
    const confirmed = complaints.filter(c => c.complaintAgainstUserId === d.id && c.status === "confirmed" && inPeriod(c.createdAt));
    const designerReviews = reviews.filter(r => r.reviewForDesigner?.id === d.id && inPeriod(r.createdAt));
    const rated = designerReviews.filter(r => r.rating != null);
    const designerSuggestions = suggestions.filter(s => s.relatedDesigner?.id === d.id && inPeriod(s.createdAt));
    return { assigned, active: assigned.filter(o => !["ready", "delivered", "canceled"].includes(o.status)).length, completed: completedOrders.length, canceled: canceledOrders.length, confirmed: confirmed.length, reviewCount: designerReviews.length, rating: rated.length ? rated.reduce((a, r) => a + Number(r.rating), 0) / rated.length : null, suggestions: designerSuggestions.length, implemented: designerSuggestions.filter(s => s.status === "implemented").length };
  };
  const rows = designers.map(d => ({ designer: d, metrics: metrics(d) }));
  const scopedOrders = orders.filter(o => inPeriod(o.createdAt));
  const scopedCompletedOrders = orders.filter(o => completed(o) && inPeriod(o.readyDate || o.createdAt));
  const avgRating = rows.flatMap(r => reviews.filter(v => v.reviewForDesigner?.id === r.designer.id && v.rating != null && inPeriod(v.createdAt)).map(v => Number(v.rating))).reduce((a, v, _, arr) => a + v / (arr.length || 1), 0);
  const confirmedCount = complaints.filter(c => c.status === "confirmed" && inPeriod(c.createdAt)).length;
  const implemented = suggestions.filter(s => s.status === "implemented" && inPeriod(s.createdAt)).length;
  const selectedDesigner = designers.find(d => d.id === designerId);
  const selectedMetrics = selectedDesigner ? metrics(selectedDesigner) : null;
  const openCase = (type: typeof caseType, id: number) => { setCaseType(type); setCaseId(id); };
  const exportDesignerPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const filterLabel = period === "all" ? "All time" : `${months[Number(month)]} ${year}`;
    doc.setFontSize(18); doc.text("PixelCRM Designer Performance", 14, 20);
    doc.setFontSize(10); doc.text(`Period: ${filterLabel}   |   Generated: ${format(new Date(), "MMM d, yyyy h:mm a")}`, 14, 29);
    doc.text(`Team summary: ${designers.length} designers · ${scopedOrders.filter(o => !["ready", "delivered", "canceled"].includes(o.status)).length} active orders · ${scopedCompletedOrders.length} completed · ${confirmedCount} confirmed complaints`, 14, 37);
    autoTable(doc, { startY: 45, head: [["Designer", "Active", "Completed", "Canceled", "Confirmed complaints", "Reviews", "Average rating", "Suggestions", "Implemented"]], body: rows.map(({ designer: d, metrics: m }) => [d.name, m.active, m.completed, m.canceled, m.confirmed, m.reviewCount, m.rating == null ? "No Ratings" : m.rating.toFixed(1), m.suggestions, m.implemented]), headStyles: { fillColor: [13, 148, 136] }, styles: { fontSize: 8 } });
    doc.save(`pixelcrm-designer-performance-${period === "all" ? "all-time" : `${year}-${String(Number(month) + 1).padStart(2, "0")}`}.pdf`);
  };

  const marketingOrders = orders.filter(o => o.createdAt && new Date(o.createdAt).getMonth() === Number(marketingMonth) && new Date(o.createdAt).getFullYear() === Number(marketingYear));
  const platforms = Array.from(new Set(marketingOrders.map(o => o.platform || "Unattributed"))).map(name => ({ name, total: marketingOrders.filter(o => (o.platform || "Unattributed") === name).length }));
  const supportOrders = orders.filter(o => o.createdAt && new Date(o.createdAt).getMonth() === Number(supportMonth) && new Date(o.createdAt).getFullYear() === Number(supportYear));
  const maxDay = new Date(Number(supportYear), Number(supportMonth) + 1, 0).getDate();
  const supportAgents = users.filter(u => u.role === "support");
  const supportDayOrders = supportOrders.filter(o => new Date(o.createdAt!).getDate() === Number(supportDay));
  const supportAgentMetrics = (agent: User) => {
    const monthOrders = supportOrders.filter(o => o.createdById === agent.id);
    const dayOrders = supportDayOrders.filter(o => o.createdById === agent.id);
    const approved = monthOrders.filter(o => o.advancePaymentStatus === "approved");
    return {
      totalOrders: orders.filter(o => o.createdById === agent.id && o.advancePaymentStatus === "approved").length,
      monthOrders: approved.length,
      dayOrders: dayOrders.filter(o => o.advancePaymentStatus === "approved").length,
      revenue: approved.reduce((sum, o) => sum + getOrderAccounting(o).accountedTotal, 0),
      collected: approved.reduce((sum, o) => sum + getOrderAccounting(o).netCollected, 0),
      pending: approved.reduce((sum, o) => sum + getOrderAccounting(o).remainingReceivable, 0),
    };
  };
  const exportTablePDF = (kind: "marketing" | "support") => {
    const doc = new jsPDF({ orientation: "landscape" });
    const label = kind === "marketing" ? `${months[Number(marketingMonth)]} ${marketingYear}` : `${months[Number(supportMonth)]} ${supportYear}`;
    doc.setFontSize(18);
    doc.text(kind === "marketing" ? "PixelCRM Marketing Analytics" : "PixelCRM Support Performance", 14, 20);
    doc.setFontSize(10);
    doc.text(`Period: ${label}  |  Generated: ${format(new Date(), "MMM d, yyyy h:mm a")}`, 14, 29);
    if (kind === "marketing") {
      const body: (string | number)[][] = [];
      platforms.forEach(platform => {
        body.push([platform.name, "", "", "", platform.total]);
        marketingOrders.filter(o => (o.platform || "Unattributed") === platform.name).forEach(o => {
          body.push(["", o.campaign || "Uncategorized", o.adSet || "No Ad Set", o.creative || "No Creative", 1]);
        });
      });
      autoTable(doc, { startY: 38, head: [["Platform", "Campaign", "Ad Set", "Creative", "Orders"]], body, headStyles: { fillColor: [13, 148, 136] }, styles: { fontSize: 8 } });
      doc.save(`pixelcrm-marketing-${marketingYear}-${Number(marketingMonth) + 1}.pdf`);
    } else {
      autoTable(doc, { startY: 38, head: [["Agent", "All approved", "Month orders", "Day orders", "Revenue", "Collected", "Pending"]], body: supportAgents.map(agent => { const m = supportAgentMetrics(agent); return [agent.name, m.totalOrders, m.monthOrders, m.dayOrders, `Rs ${Math.round(m.revenue / 100).toLocaleString()}`, `Rs ${Math.round(m.collected / 100).toLocaleString()}`, `Rs ${Math.round(m.pending / 100).toLocaleString()}`]; }), headStyles: { fillColor: [13, 148, 136] }, styles: { fontSize: 8 } });
      doc.save(`pixelcrm-support-${supportYear}-${Number(supportMonth) + 1}.pdf`);
    }
  };

  return <div className="min-h-[100dvh] space-y-6 p-4 text-slate-100 sm:p-6 lg:p-8">
    <header className="flex flex-col gap-3 border-b border-slate-800/80 pb-6 sm:flex-row sm:items-end sm:justify-between"><div><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[.18em] text-cyan-300"><BarChart3 className="h-4 w-4" />Operations cockpit</div><h1 className="text-3xl font-semibold tracking-tight text-slate-100" data-testid="text-analytics-title">Analytics</h1><p className="mt-1 text-sm text-slate-500">Workload and client experience, without composite scores.</p></div><div className="text-right text-xs text-slate-600">Updated {format(new Date(), "MMM d, h:mm a")}</div></header>
    <Tabs defaultValue="designers" className="w-full"><TabsList className="mb-5 h-auto flex-wrap justify-start gap-1 rounded-xl border border-slate-800 bg-slate-900/70 p-1"><TabsTrigger value="designers" className="gap-2 rounded-lg px-4 py-2 data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-200"><Users className="h-4 w-4" />Designer Performance</TabsTrigger><TabsTrigger value="marketing" className="gap-2 rounded-lg px-4 py-2 data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-200"><Megaphone className="h-4 w-4" />Marketing Analytics</TabsTrigger><TabsTrigger value="support" className="gap-2 rounded-lg px-4 py-2 data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-200"><Headphones className="h-4 w-4" />Support Performance</TabsTrigger></TabsList>
      <TabsContent value="designers" className="space-y-5">
        <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Period</span><div className="flex rounded-lg border border-slate-700 bg-slate-950 p-1"><button className={cn("rounded-md px-3 py-1.5 text-sm", period === "selected" ? "bg-cyan-500/15 text-cyan-200" : "text-slate-500")} onClick={() => setPeriod("selected")}>Selected period</button><button className={cn("rounded-md px-3 py-1.5 text-sm", period === "all" ? "bg-cyan-500/15 text-cyan-200" : "text-slate-500")} onClick={() => setPeriod("all")}>All time</button></div>{period === "selected" && <><Select value={month} onValueChange={setMonth}><SelectTrigger className="w-32 border-slate-700 bg-slate-950"><CalendarDays className="mr-2 h-4 w-4 text-slate-500" /><SelectValue /></SelectTrigger><SelectContent>{months.map((m, i) => <SelectItem key={m} value={String(i)}>{m}</SelectItem>)}</SelectContent></Select><Select value={year} onValueChange={setYear}><SelectTrigger className="w-24 border-slate-700 bg-slate-950"><SelectValue /></SelectTrigger><SelectContent>{years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select></>}</div><Button variant="outline" className="border-slate-700" onClick={exportDesignerPDF}><Download className="mr-2 h-4 w-4" />Export PDF</Button></div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Metric icon={Users} label="Designers" value={designers.length} note="Team members in reporting" /><Metric icon={Activity} label="Active orders" value={scopedOrders.filter(o => !["ready", "delivered", "canceled"].includes(o.status)).length} /><Metric icon={CheckCircle2} label="Completed" value={scopedCompletedOrders.length} note="Completed during this period" /><Metric icon={AlertTriangle} label="Confirmed complaints" value={confirmedCount} note="Only confirmed cases are negative quality signals" tone="amber" /><Metric icon={Star} label="Average rating" value={avgRating ? avgRating.toFixed(1) : "No Ratings"} note={avgRating ? "Across rated reviews" : "No rated reviews"} tone="amber" /><Metric icon={ThumbsUp} label="Implemented suggestions" value={implemented} tone="emerald" /></div>
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40"><div className="flex flex-col gap-2 border-b border-slate-800 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-slate-200">Designer workload and experience</h2><p className="mt-1 text-xs text-slate-500">Counts are scoped to {period === "all" ? "all recorded time" : `${months[Number(month)]} ${year}`}. No ranking or composite score.</p></div><span className="text-xs text-slate-600">{rows.length} rows</span></div><div className="overflow-x-auto"><Table><TableHeader><TableRow className="border-slate-800 hover:bg-transparent"><TableHead>Designer</TableHead><TableHead>Active</TableHead><TableHead>Completed</TableHead><TableHead>Canceled</TableHead><TableHead>Confirmed complaints</TableHead><TableHead>Reviews / rating</TableHead><TableHead>Suggestions</TableHead><TableHead className="text-right">Details</TableHead></TableRow></TableHeader><TableBody>{rows.map(({ designer: d, metrics: m }) => <TableRow key={d.id} data-testid={`row-designer-${d.id}`} className="border-slate-800/70 transition-colors hover:bg-cyan-400/[.03]"><TableCell><div className="flex min-w-[170px] items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 font-semibold text-cyan-200">{d.name.slice(0, 1).toUpperCase()}</div><div><p className="font-medium text-slate-200">{d.name}</p><p className="text-xs text-slate-600">@{d.username}</p></div><Badge variant="outline" className={cn("ml-1 text-[10px]", d.isActive ? "border-emerald-500/30 text-emerald-300" : "border-slate-700 text-slate-600")}>{d.isActive ? "Active" : "Inactive"}</Badge></div></TableCell><TableCell>{m.active}</TableCell><TableCell className="font-medium text-cyan-200">{m.completed}</TableCell><TableCell className={m.canceled ? "text-rose-300" : "text-slate-500"}>{m.canceled}</TableCell><TableCell className={m.confirmed ? "text-amber-300" : "text-slate-500"}>{m.confirmed}</TableCell><TableCell>{m.reviewCount ? <span className="inline-flex items-center gap-2">{m.reviewCount} <span className="text-amber-300"><Star className="mr-1 inline h-3 w-3 fill-current" />{m.rating?.toFixed(1) || "—"}</span></span> : <span className="text-slate-600">No Ratings</span>}</TableCell><TableCell>{m.suggestions} <span className="text-xs text-emerald-300">{m.implemented ? `· ${m.implemented} implemented` : ""}</span></TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" className="text-cyan-300 hover:bg-cyan-400/10 hover:text-cyan-200" onClick={() => { setDesignerId(d.id); setDetailTab("overview"); }}>View Details<ChevronRight className="ml-1 h-4 w-4" /></Button></TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={8}><Empty title="No designers found" copy="Designer accounts and assigned work will appear here once available." /></TableCell></TableRow>}</TableBody></Table></div></section>
      </TabsContent>
      <TabsContent value="marketing" className="space-y-5">
        <FilterBar month={marketingMonth} year={marketingYear} setMonth={setMarketingMonth} setYear={setMarketingYear} count={`${marketingOrders.length} orders`} />
        <div className="flex justify-end"><Button variant="outline" onClick={() => exportTablePDF("marketing")}><Download className="mr-2 h-4 w-4" />Export PDF</Button></div>
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          <SectionTitle icon={Megaphone} title="Platform breakdown" copy="Where clients are coming from, with campaign, ad set, and creative context." />
          {platforms.length ? <div className="divide-y divide-slate-800">{platforms.map(platform => {
            const platformOrders = marketingOrders.filter(o => (o.platform || "Unattributed") === platform.name);
            const campaigns = Array.from(new Set(platformOrders.map(o => o.campaign || "Uncategorized")));
            return <div className="p-5" key={platform.name}>
              <div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="rounded-lg bg-orange-400/10 p-2 text-orange-300"><Megaphone className="h-4 w-4" /></div><div><p className="font-medium text-slate-200">{platform.name}</p><p className="text-xs text-slate-600">Platform</p></div></div><span className="font-mono text-xl text-slate-200">{platform.total}</span></div>
              <div className="mt-4 space-y-2 pl-9">{campaigns.map(campaign => {
                const campaignOrders = platformOrders.filter(o => (o.campaign || "Uncategorized") === campaign);
                const adSets = Array.from(new Set(campaignOrders.map(o => o.adSet || "No Ad Set")));
                return <div className="rounded-lg bg-slate-950/50 p-3" key={campaign}><div className="flex justify-between text-sm"><span className="flex items-center gap-2 text-slate-300"><Layers className="h-3.5 w-3.5 text-cyan-300" />{campaign}</span><span className="text-slate-500">{campaignOrders.length} orders</span></div><div className="mt-2 space-y-2 pl-5">{adSets.map(adSet => { const adOrders = campaignOrders.filter(o => (o.adSet || "No Ad Set") === adSet); const creatives = Array.from(new Set(adOrders.map(o => o.creative || "No Creative"))); return <div key={adSet}><div className="flex justify-between text-xs text-slate-400"><span>{adSet}</span><span>{adOrders.length}</span></div><div className="mt-1 space-y-1 pl-4">{creatives.map(creative => <div className="flex justify-between text-xs text-slate-600" key={creative}><span className="flex items-center gap-1"><Palette className="h-3 w-3 text-cyan-300" />{creative}</span><span>{adOrders.filter(o => (o.creative || "No Creative") === creative).length}</span></div>)}</div></div>; })}</div></div>;
              })}</div>
            </div>;
          })}</div> : <Empty title="No platform data yet" copy="Tag orders with a platform to see acquisition patterns." />}
        </section>
      </TabsContent>
      <TabsContent value="support" className="space-y-5">
        <FilterBar month={supportMonth} year={supportYear} setMonth={setSupportMonth} setYear={setSupportYear} count={`${supportOrders.length} orders`} day={supportDay} setDay={setSupportDay} maxDay={maxDay} />
        <div className="flex justify-end"><Button variant="outline" onClick={() => exportTablePDF("support")}><Download className="mr-2 h-4 w-4" />Export PDF</Button></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Metric icon={Package} label="Monthly orders" value={supportOrders.filter(o => o.advancePaymentStatus === "approved").length} note="Approved orders this month" /><Metric icon={MessageSquare} label="Monthly revenue" value={`Rs ${Math.round(supportOrders.filter(o => o.advancePaymentStatus === "approved").reduce((s, o) => s + getOrderAccounting(o).accountedTotal, 0) / 100).toLocaleString()}`} note="Collected + remaining" /><Metric icon={FileText} label="Selected-day orders" value={supportDayOrders.filter(o => o.advancePaymentStatus === "approved").length} note={`${months[Number(supportMonth)]} ${supportDay}, ${supportYear}`} /></div>
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40"><SectionTitle icon={Headphones} title="Support agent monthly summary" copy="Approved orders placed by each support agent." /><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Agent</TableHead><TableHead>All approved</TableHead><TableHead>Month orders</TableHead><TableHead>Day orders</TableHead><TableHead>Revenue</TableHead><TableHead>Collected</TableHead><TableHead>Pending</TableHead></TableRow></TableHeader><TableBody>{supportAgents.map(agent => { const m = supportAgentMetrics(agent); return <TableRow key={agent.id}><TableCell className="font-medium">{agent.name}</TableCell><TableCell>{m.totalOrders}</TableCell><TableCell>{m.monthOrders}</TableCell><TableCell>{m.dayOrders}</TableCell><TableCell>Rs {Math.round(m.revenue / 100).toLocaleString()}</TableCell><TableCell className="text-emerald-300">Rs {Math.round(m.collected / 100).toLocaleString()}</TableCell><TableCell className="text-amber-300">Rs {Math.round(m.pending / 100).toLocaleString()}</TableCell></TableRow>; })}{!supportAgents.length && <TableRow><TableCell colSpan={7}><Empty title="No support agents found" copy="Support team activity will appear here when accounts are active." /></TableCell></TableRow>}</TableBody></Table></div></section>
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40"><SectionTitle icon={FileText} title="Selected-day order activity" copy="Orders created on the selected day, with status and client context." /><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Client</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead>Agent</TableHead></TableRow></TableHeader><TableBody>{supportDayOrders.filter(o => o.advancePaymentStatus === "approved").map(o => <TableRow key={o.id}><TableCell className="font-mono text-cyan-200">{o.orderNumber || `#${o.id}`}</TableCell><TableCell>{o.clientName}</TableCell><TableCell><Badge variant="outline">{title(o.status)}</Badge></TableCell><TableCell>{dateLabel(o.createdAt)}</TableCell><TableCell>{users.find(u => u.id === o.createdById)?.name || "—"}</TableCell></TableRow>)}{!supportDayOrders.length && <TableRow><TableCell colSpan={5}><Empty title="No orders on this day" copy="Try another day or month to inspect support activity." /></TableCell></TableRow>}</TableBody></Table></div></section>
      </TabsContent>
    </Tabs>
    <Sheet open={Boolean(selectedDesigner)} onOpenChange={open => !open && setDesignerId(null)}><SheetContent className="w-full overflow-y-auto border-slate-800 bg-slate-950 text-slate-100 sm:max-w-2xl"><SheetHeader className="border-b border-slate-800 pb-5 pr-8 text-left"><SheetTitle><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/15 text-lg font-semibold text-cyan-200">{selectedDesigner?.name.slice(0, 1)}</div><div><p>{selectedDesigner?.name}</p><p className="mt-1 text-xs font-normal text-slate-500">{period === "all" ? "All time" : `${months[Number(month)]} ${year}`} · {selectedDesigner?.isActive ? "Active" : "Inactive"}</p></div></div></SheetTitle></SheetHeader>{selectedDesigner && selectedMetrics && <div className="mt-5 space-y-5"><div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1"><button onClick={() => setDetailTab("overview")} className={cn("flex-1 rounded-md px-3 py-2 text-sm", detailTab === "overview" ? "bg-cyan-500/15 text-cyan-200" : "text-slate-500")}>Overview</button><button onClick={() => setDetailTab("orders")} className={cn("flex-1 rounded-md px-3 py-2 text-sm", detailTab === "orders" ? "bg-cyan-500/15 text-cyan-200" : "text-slate-500")}>Orders ({selectedMetrics.assigned.length})</button><button onClick={() => setDetailTab("experience")} className={cn("flex-1 rounded-md px-3 py-2 text-sm", detailTab === "experience" ? "bg-cyan-500/15 text-cyan-200" : "text-slate-500")}>Client Experience</button></div>{detailTab === "overview" && <div className="grid grid-cols-2 gap-3"><Metric icon={Activity} label="Active orders" value={selectedMetrics.active} /><Metric icon={CheckCircle2} label="Completed" value={selectedMetrics.completed} /><Metric icon={XCircle} label="Canceled" value={selectedMetrics.canceled} tone="rose" /><Metric icon={AlertTriangle} label="Confirmed complaints" value={selectedMetrics.confirmed} tone="amber" /><Metric icon={Star} label="Average rating" value={selectedMetrics.rating?.toFixed(1) || "No Ratings"} tone="amber" /><Metric icon={ThumbsUp} label="Suggestions" value={`${selectedMetrics.implemented}/${selectedMetrics.suggestions}`} note="Implemented / total" tone="emerald" /></div>}{detailTab === "orders" && <div className="space-y-2">{selectedMetrics.assigned.length ? selectedMetrics.assigned.map(o => <button key={o.id} className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-left transition-colors hover:border-cyan-400/30" onClick={() => window.location.assign(`/orders?order=${encodeURIComponent(o.orderNumber || String(o.id))}`)}><div><p className="font-mono text-sm text-cyan-200">{o.orderNumber || `#${o.id}`} <span className="font-sans text-slate-400">· {o.clientName}</span></p><p className="mt-1 text-xs text-slate-600">{title(o.status)} · Created {dateLabel(o.createdAt)}{o.readyDate ? ` · Ready ${dateLabel(o.readyDate)}` : ""}</p></div><ChevronRight className="h-4 w-4 text-slate-600" /></button>) : <Empty title="No assigned orders" copy="This designer has no orders in the selected period." />}</div>}{detailTab === "experience" && <Experience designer={selectedDesigner} complaints={complaints} reviews={reviews} suggestions={suggestions} inPeriod={inPeriod} openCase={openCase} />}</div>}</SheetContent></Sheet>
    {caseType === "complaint" && <ComplaintDetails id={caseId} open onOpenChange={open => !open && setCaseType(null)} onBack={() => setCaseType(null)} />}{caseType === "review" && <ReviewDetails review={reviews.find(r => r.id === caseId) as any || null} open onOpenChange={open => !open && setCaseType(null)} onEdit={() => undefined} onOpenOrder={id => window.location.assign(`/orders?order=${id}`)} onBack={() => setCaseType(null)} />}{caseType === "suggestion" && <SuggestionDetails suggestion={suggestions.find(s => s.id === caseId) as any || null} open onOpenChange={open => !open && setCaseType(null)} onOpenOrder={id => window.location.assign(`/orders?order=${id}`)} onUpdated={() => undefined} onBack={() => setCaseType(null)} />}
  </div>;
}

function FilterBar({ month, year, setMonth, setYear, count, day, setDay, maxDay }: { month: string; year: string; setMonth: (v: string) => void; setYear: (v: string) => void; count: string; day?: string; setDay?: (v: string) => void; maxDay?: number }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3"><div className="flex flex-wrap items-center gap-2"><CalendarDays className="h-4 w-4 text-slate-500" />{day && setDay && <Select value={day} onValueChange={setDay}><SelectTrigger className="w-20 border-slate-700 bg-slate-950"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: maxDay || 31 }, (_, i) => <SelectItem key={i} value={String(i + 1)}>{i + 1}</SelectItem>)}</SelectContent></Select>}<Select value={month} onValueChange={setMonth}><SelectTrigger className="w-32 border-slate-700 bg-slate-950"><SelectValue /></SelectTrigger><SelectContent>{months.map((m, i) => <SelectItem key={m} value={String(i)}>{m}</SelectItem>)}</SelectContent></Select><Select value={year} onValueChange={setYear}><SelectTrigger className="w-24 border-slate-700 bg-slate-950"><SelectValue /></SelectTrigger><SelectContent>{years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select></div><span className="text-xs text-slate-500">{count}</span></div>;
}
function SectionTitle({ icon: Icon, title: heading, copy }: { icon: typeof Megaphone; title: string; copy: string }) { return <div className="border-b border-slate-800 p-5"><h2 className="flex items-center gap-2 font-semibold text-slate-200"><Icon className="h-4 w-4 text-cyan-300" />{heading}</h2><p className="mt-1 text-xs text-slate-500">{copy}</p></div>; }
function Experience({ designer, complaints, reviews, suggestions, inPeriod, openCase }: { designer: User; complaints: Complaint[]; reviews: Review[]; suggestions: Suggestion[]; inPeriod: (v?: string | Date | null) => boolean; openCase: (type: "complaint" | "review" | "suggestion", id: number) => void }) {
  const cs = complaints.filter(c => c.complaintAgainstUserId === designer.id && c.status === "confirmed" && inPeriod(c.createdAt)), rs = reviews.filter(r => r.reviewForDesigner?.id === designer.id && inPeriod(r.createdAt)), ss = suggestions.filter(s => s.relatedDesigner?.id === designer.id && inPeriod(s.createdAt));
  return <div className="space-y-5">{[["Confirmed complaints", cs, "complaint"], ["Reviews", rs, "review"], ["Suggestions", ss, "suggestion"]].map(([heading, items, type]) => <section key={heading as string} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"><h3 className="text-sm font-medium text-slate-300">{heading as string}</h3>{(items as any[]).length ? <div className="mt-3 space-y-2">{(items as any[]).map(item => <button key={item.id} onClick={() => openCase(type as any, item.id)} className="w-full rounded-lg border border-slate-800 p-3 text-left hover:border-cyan-400/30"><div className="flex justify-between gap-3"><span className="font-mono text-xs text-cyan-200">{item.complaintNumber || item.reviewNumber || item.suggestionNumber}</span><span className="text-xs text-slate-600">{dateLabel(item.createdAt)}</span></div><p className="mt-1 line-clamp-2 text-sm text-slate-400">{item.description || item.feedbackText || item.suggestionText}</p></button>)}</div> : <p className="mt-3 text-xs text-slate-600">No {String(heading).toLowerCase()} in this period.</p>}</section>)}</div>;
}