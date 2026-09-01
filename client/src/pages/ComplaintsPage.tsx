import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { format } from "date-fns";
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardCheck, Download, FileWarning, FileText, Filter, Loader2, MoreVertical, Search, X, XCircle, DollarSign } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { complaintCategories, complaintStatuses, type ComplaintHistoryEntry, type ComplaintCategoryConfig, type ComplaintResponse, type ComplaintStats, type OrderWithServices } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComplaintStatusBadge } from "@/components/StatusBadge";
import { complaintCategoryLabels, ComplaintDialog } from "@/components/ComplaintDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const errorText = (error: Error) => error.message.match(/"message":"([^"]+)"/)?.[1] || "The request could not be completed.";
const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
const money = (value?: number | null) => value == null ? null : `Rs${Math.round(Number(value) / 100).toLocaleString()}`;

function ComplaintDrawer({ id, open, onOpenChange }: { id: number | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth(); const { toast } = useToast(); const isAdmin = user?.role === "admin";
  const [notes, setNotes] = useState(""); const [resolution, setResolution] = useState(""); const [outcome, setOutcome] = useState(""); const [pending, setPending] = useState<string | null>(null);
  const { data: complaint, isLoading, isError } = useQuery<ComplaintResponse>({ queryKey: [`/api/complaints/${id}`], enabled: Boolean(id && open) });
  const { data: history = [] } = useQuery<ComplaintHistoryEntry[]>({ queryKey: [`/api/complaints/${id}/history`], enabled: Boolean(id && open && isAdmin) });
  const update = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await apiRequest("PATCH", `/api/complaints/${id}`, payload)).json(),
    onSuccess: (value: ComplaintResponse) => { queryClient.setQueryData([`/api/complaints/${id}`], value); queryClient.invalidateQueries({ queryKey: ["/api/complaints"] }); queryClient.invalidateQueries({ queryKey: ["/api/stats"] }); queryClient.invalidateQueries({ queryKey: [`/api/complaints/${id}/history`] }); setPending(null); toast({ title: "Complaint updated" }); },
    onError: (e: Error) => toast({ title: "Update failed", description: errorText(e), variant: "destructive" }),
  });
  const submitDecision = () => {
    if (!pending || !complaint) return;
    const isClosing = pending === "resolved" || pending === "order_canceled";
    update.mutate({
      status: pending,
      confirmDecision: true,
      ...(isClosing ? { resolution: resolution.trim(), resolutionOutcome: outcome } : {}),
    });
  };
  const terminal = complaint && ["invalid", "resolved", "order_canceled"].includes(complaint.status);
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full sm:max-w-xl overflow-y-auto bg-slate-950 border-slate-800 text-white">
    <SheetHeader><SheetTitle className="flex items-center gap-3">{complaint?.complaintNumber || "Complaint details"} {complaint && <ComplaintStatusBadge status={complaint.status} />}</SheetTitle></SheetHeader>
    {isLoading ? <div className="py-24 text-center"><Loader2 className="mx-auto animate-spin text-blue-400" /></div> : isError || !complaint ? <div className="py-20 text-center text-slate-400"><AlertTriangle className="mx-auto mb-3 text-rose-400" />Could not load this complaint.</div> : <div className="space-y-5 mt-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-xs uppercase tracking-wider text-slate-500">Complaint details</p><dl className="grid grid-cols-2 gap-4 mt-4"><div><dt className="text-xs text-slate-500">Category</dt><dd className="mt-1 text-sm">{titleCase(complaint.category)}</dd></div><div><dt className="text-xs text-slate-500">Complaint against</dt><dd className="mt-1 text-sm">{complaint.complaintAgainst?.name || "—"}</dd></div></dl><p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{complaint.description}</p></section>
      {complaint.order && <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-xs uppercase tracking-wider text-slate-500">Related order</p><a href={`/orders?order=${encodeURIComponent(complaint.order.orderNumber || String(complaint.orderId))}`} className="mt-2 block font-medium text-blue-300 hover:underline">#{complaint.order.orderNumber || complaint.orderId} · {complaint.order.clientName}</a><div className="mt-3 space-y-2 text-sm text-slate-400">{complaint.order.services?.length > 0 && <p><span className="text-slate-500">Services:</span> {complaint.order.services.map(s => `${s.serviceType} ×${s.quantity || 1}`).join(", ")}</p>}<div className="grid grid-cols-2 gap-2">{[["Total", complaint.order.totalPrice], ["Advance", complaint.order.advanceAmount], ["Remaining", complaint.order.remainingAmount], ["Discount", complaint.order.discountAmount]].map(([label, value]) => money(value as number | null) && <p key={label as string}><span className="text-slate-500">{label as string}:</span> {money(value as number)}</p>)}</div></div></section>}
      {isAdmin && complaint.filedBy && <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm"><p className="text-xs uppercase tracking-wider text-slate-500">Filed by</p><p className="mt-2">{complaint.filedBy.name} <span className="text-slate-500">({complaint.filedBy.role})</span></p></section>}
      {complaint.screenshotUrl && <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-xs uppercase tracking-wider text-slate-500 mb-3">Evidence</p><a href={complaint.screenshotUrl} target="_blank" rel="noreferrer" className="block"><img src={complaint.screenshotUrl} alt="Complaint evidence" className="max-h-56 w-full rounded-lg bg-slate-950 object-contain" onError={e => { e.currentTarget.style.display = "none"; }} /><span className="mt-2 inline-block text-sm text-blue-400 underline">Open evidence in a new tab</span></a></section>}
      {(complaint.resolution || complaint.resolutionOutcome) && <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4"><p className="text-xs uppercase tracking-wider text-emerald-300">Resolution</p><p className="mt-2 text-sm text-slate-300">{complaint.resolution || "—"}</p>{complaint.resolutionOutcome && <p className="mt-2 text-xs text-emerald-300">{titleCase(complaint.resolutionOutcome)}</p>}</section>}
      {isAdmin && <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4"><div><p className="text-xs uppercase tracking-wider text-slate-500">Decision controls</p><p className="text-xs text-slate-500 mt-1">Every decision is recorded and cannot be reversed.</p></div>
        {complaint.status === "new" && <div className="grid grid-cols-2 gap-2"><Button onClick={() => setPending("valid")} className="bg-amber-600 hover:bg-amber-500"><CheckCircle2 className="w-4 h-4 mr-2" />Valid</Button><Button variant="outline" onClick={() => setPending("invalid")}><XCircle className="w-4 h-4 mr-2" />Invalid</Button></div>}
        {complaint.status === "valid" && <><div className="space-y-2"><Label htmlFor="resolution">Resolution text <span className="text-rose-400">*</span></Label><Textarea id="resolution" value={resolution} onChange={e => setResolution(e.target.value)} rows={3} className="bg-slate-950 border-slate-700" /></div><div className="space-y-2"><Label>Outcome <span className="text-rose-400">*</span></Label><Select value={outcome} onValueChange={setOutcome}><SelectTrigger><SelectValue placeholder="Select an outcome" /></SelectTrigger><SelectContent><SelectItem value="correction_revision">Correction / Revision</SelectItem><SelectItem value="refund">Refund</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div><div className="grid grid-cols-2 gap-2"><Button disabled={!resolution.trim() || !outcome} onClick={() => setPending("resolved")} className="bg-emerald-600 hover:bg-emerald-500">Resolved</Button><Button variant="outline" disabled={!resolution.trim() || !outcome} onClick={() => setPending("order_canceled")}>Order Canceled</Button></div></>}
        {terminal && <p className="rounded-lg bg-slate-950 p-3 text-sm text-slate-500">This complaint has reached a terminal state.</p>}
        <div className="border-t border-slate-800 pt-4 space-y-2"><Label htmlFor="admin-notes">Internal notes</Label><Textarea id="admin-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder={complaint.adminNotes || "Visible only to admins"} rows={3} className="bg-slate-950 border-slate-700" /><Button variant="outline" disabled={!notes.trim() || update.isPending} onClick={() => update.mutate({ adminNotes: notes.trim() })}>Save note</Button></div>
      </section>}
      {isAdmin && <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-xs uppercase tracking-wider text-slate-500">History</p><div className="mt-4 space-y-4">{history.length ? history.map(entry => <div key={entry.id} className="border-l border-slate-700 pl-4"><p className="text-sm">{titleCase(entry.action)}</p><p className="text-xs text-slate-500 mt-1">{entry.actor?.name || "System"} · {entry.createdAt ? format(new Date(entry.createdAt), "MMM dd, yyyy h:mm a") : "—"}</p></div>) : <p className="text-sm text-slate-500">No history entries yet.</p>}</div></section>}
    </div>}
    <AlertDialog open={Boolean(pending)} onOpenChange={v => !v && setPending(null)}><AlertDialogContent className="bg-slate-900 border-slate-800 text-white"><AlertDialogHeader><AlertDialogTitle>Confirm {titleCase(pending || "")} decision</AlertDialogTitle><AlertDialogDescription className="text-slate-400">This is an irreversible workflow transition for {complaint?.complaintNumber}.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={submitDecision} disabled={update.isPending}>Confirm decision</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </SheetContent></Sheet>;
}

export default function ComplaintsPage() {
  const { user } = useAuth(); const { toast } = useToast(); const [, setLocation] = useLocation(); const [, routeParams] = useRoute("/complaints/:id");
  const deepComplaintNumber = new URLSearchParams(window.location.search).get("complaint");
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("all"); const [outcome, setOutcome] = useState(""); const [category, setCategory] = useState("all"); const [designerId, setDesignerId] = useState("all"); const [createOpen, setCreateOpen] = useState(false); const [selectedId, setSelectedId] = useState<number | null>(routeParams?.id ? Number(routeParams.id) : null);
  const now = new Date(); const [month, setMonth] = useState(String(now.getMonth() + 1)); const [year, setYear] = useState(String(now.getFullYear()));
  const query = new URLSearchParams({ month, year, ...(search || deepComplaintNumber ? { search: search || deepComplaintNumber } : {}), ...(status !== "all" ? { status } : {}), ...(category !== "all" ? { category } : {}), ...(designerId !== "all" ? { designerId } : {}) }).toString();
  const { data: complaints = [], isLoading, isError, refetch } = useQuery<ComplaintResponse[]>({ queryKey: [`/api/complaints?${query}`] });
  const { data: statsResponse } = useQuery<{ complaints: ComplaintStats }>({ queryKey: [`/api/stats?month=${month}&year=${year}${designerId !== "all" ? `&designerId=${designerId}` : ""}`] });
  const { data: categories = [] } = useQuery<ComplaintCategoryConfig[]>({ queryKey: ["/api/complaint-categories"], staleTime: 300000 });
  const { data: teamMembers = [] } = useQuery<{ id: number; name: string; role: string; isActive: boolean }[]>({ queryKey: ["/api/users"], enabled: user?.role === "admin" || user?.role === "support", staleTime: 300000 });
  const { data: orders = [] } = useQuery<OrderWithServices[]>({ queryKey: ["/api/orders"], enabled: user?.role === "admin" || user?.role === "support" });
  const stats = statsResponse?.complaints; const isAdmin = user?.role === "admin"; const canCreate = isAdmin || user?.role === "support";
  const categoryOptions = categories.length ? categories.filter(c => c.isActive) : complaintCategories.map(key => ({ key, label: complaintCategoryLabels[key] }));
  const cards = [
    { key: "all", label: "All Complaints", value: stats?.all ?? complaints.length, icon: FileWarning, iconClass: "bg-blue-500/10 text-blue-500", testId: "stat-complaints-all" },
    { key: "valid", label: "Valid", value: stats?.valid ?? complaints.filter(c => c.status === "valid").length, icon: CheckCircle2, iconClass: "bg-amber-500/10 text-amber-400", testId: "stat-complaints-valid" },
    { key: "invalid", label: "Invalid", value: stats?.invalid ?? complaints.filter(c => c.status === "invalid").length, icon: XCircle, iconClass: "bg-slate-500/10 text-slate-400", testId: "stat-complaints-invalid" },
    { key: "resolved", label: "Resolved", value: stats?.resolved ?? complaints.filter(c => c.status === "resolved").length, icon: ClipboardCheck, iconClass: "bg-emerald-500/10 text-emerald-400", testId: "stat-complaints-resolved" },
    { key: "refund", label: "Refund", value: stats?.refund ?? complaints.filter(c => c.resolutionOutcome === "refund").length, icon: DollarSign, iconClass: "bg-violet-500/10 text-violet-400", testId: "stat-complaints-refund" },
  ];
  const filteredComplaints = useMemo(
    () => outcome === "refund" ? complaints.filter(complaint => complaint.resolutionOutcome === "refund") : complaints,
    [complaints, outcome],
  );
  const [deepLinkMessage, setDeepLinkMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!deepComplaintNumber || isLoading) return;
    const complaint = complaints.find(item => item.complaintNumber === deepComplaintNumber);
    if (complaint) { setSelectedId(complaint.id); setDeepLinkMessage(null); }
    else setDeepLinkMessage(`Complaint ${deepComplaintNumber} was not found, or you do not have permission to view it.`);
  }, [complaints, deepComplaintNumber, isLoading]);
  const openComplaint = (id: number) => { setSelectedId(id); setLocation(`/complaints/${id}`); };
  const designerOptions = teamMembers.filter(member => member.role === "designer");
  const hasActiveFilters = Boolean(search) || status !== "all" || category !== "all" || designerId !== "all" || outcome === "refund";
  const clearFilters = () => {
    setSearch("");
    setStatus("all");
    setOutcome("");
    setCategory("all");
    setDesignerId("all");
    setMonth(String(now.getMonth() + 1));
    setYear(String(now.getFullYear()));
  };
  const exportComplaintsPDF = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 32;
    const contentWidth = pageWidth - marginX * 2;
    const reportMonth = format(new Date(Number(year), Number(month) - 1, 1), "MMMM yyyy");
    const selectedDesigner = designerOptions.find(designer => String(designer.id) === designerId);
    const BRAND: [number, number, number] = [37, 99, 235];
    const INK: [number, number, number] = [30, 41, 59];
    const MUTED: [number, number, number] = [100, 116, 139];
    const LINE: [number, number, number] = [226, 232, 240];
    const SOFT_BLUE: [number, number, number] = [239, 246, 255];

    doc.setFillColor(...SOFT_BLUE);
    doc.roundedRect(marginX, 24, contentWidth, 64, 8, 8, "F");
    doc.setFillColor(...BRAND);
    doc.roundedRect(marginX, 24, 7, 64, 3, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(19);
    doc.setTextColor(...INK);
    doc.text("Pixely Careers", marginX + 20, 50);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text(`Complaints Report  •  ${reportMonth}${selectedDesigner ? `  •  ${selectedDesigner.name}` : ""}`, marginX + 20, 68);
    doc.setFontSize(8.5);
    doc.text(`Generated ${format(new Date(), "MMM dd, yyyy · h:mm a")}`, pageWidth - marginX, 68, { align: "right" });

    const rows = filteredComplaints.length > 0
      ? filteredComplaints.map(complaint => [
        complaint.complaintNumber,
        complaint.orderNumber || `#${complaint.orderId}`,
        complaint.clientName || "Not Specified",
        complaintCategoryLabels[complaint.category as keyof typeof complaintCategoryLabels] || titleCase(complaint.category),
        complaint.complaintAgainst?.name || "Not Specified",
        titleCase(complaint.status),
        complaint.createdAt ? format(new Date(complaint.createdAt), "MMM dd, yyyy") : "Not Specified",
      ])
      : [["No complaints found.", "", "", "", "", "", ""]];

    autoTable(doc, {
      startY: 112,
      head: [["Complaint ID", "Order", "Client", "Category", "Complaint Against", "Status", "Date"]],
      body: rows,
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 5,
        textColor: INK,
        lineColor: LINE,
        lineWidth: 0.35,
        valign: "middle",
      },
      headStyles: {
        fillColor: BRAND,
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didDrawPage: data => {
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text(`Complaints Report  •  Page ${data.pageNumber}`, pageWidth - marginX, doc.internal.pageSize.getHeight() - 20, { align: "right" });
      },
    });

    const suffix = `${year}-${String(month).padStart(2, "0")}`;
    doc.save(`complaints-${suffix}.pdf`);
  };
  const complaintTableHead = (
    <TableHeader className="bg-slate-900/50">
      <TableRow className="border-slate-800 hover:bg-transparent">
        <TableHead className="whitespace-nowrap text-slate-400">Complaint ID</TableHead>
        <TableHead className="whitespace-nowrap text-slate-400">Date Placed</TableHead>
        <TableHead className="whitespace-nowrap text-slate-400">Order</TableHead>
        <TableHead className="text-slate-400">Client</TableHead>
        <TableHead className="text-slate-400">Category</TableHead>
        <TableHead className="text-slate-400">Designer</TableHead>
        {isAdmin && <TableHead className="text-slate-400">Placed By</TableHead>}
        <TableHead className="text-slate-400">Status</TableHead>
        <TableHead className="text-right text-slate-400">Actions</TableHead>
      </TableRow>
    </TableHeader>
  );
  const renderComplaintRow = (complaint: ComplaintResponse) => (
    <TableRow key={complaint.id} className="border-slate-800 hover:bg-slate-900/50" data-testid={`row-complaint-${complaint.id}`}>
      <TableCell className="whitespace-nowrap font-mono text-xs text-blue-400">{complaint.complaintNumber || "—"}</TableCell>
      <TableCell className="whitespace-nowrap text-xs text-slate-400">{complaint.createdAt ? format(new Date(complaint.createdAt), "MMM dd, yyyy") : "Not Specified"}</TableCell>
      <TableCell className="whitespace-nowrap font-medium"><a href={`/orders?order=${encodeURIComponent(complaint.orderNumber || String(complaint.orderId))}`} className="text-blue-300 hover:underline">#{complaint.orderNumber || complaint.orderId}</a></TableCell>
      <TableCell className="text-sm font-medium text-white">{complaint.clientName || "Not Specified"}</TableCell>
      <TableCell className="text-sm text-slate-300">{categoryOptions.find(item => item.key === complaint.category)?.label || titleCase(complaint.category)}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-[10px] text-slate-400">{complaint.complaintAgainst?.name?.charAt(0) || "?"}</div>
          <span className="text-sm text-slate-300">{complaint.complaintAgainst?.name || "Unassigned"}</span>
        </div>
      </TableCell>
      {isAdmin && <TableCell>
        <div className="min-w-28">
          <p className="text-sm font-medium text-white">{complaint.filedBy?.name || "Not Specified"}</p>
          <p className="text-xs text-slate-500">{complaint.filedBy?.role || ""}</p>
        </div>
      </TableCell>}
      <TableCell><ComplaintStatusBadge status={complaint.status} /></TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white" aria-label={`Open actions for ${complaint.complaintNumber}`} data-testid={`button-menu-complaint-${complaint.id}`}>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border-slate-800 bg-slate-900">
            <DropdownMenuItem onClick={() => openComplaint(complaint.id)} className="text-slate-300 hover:text-white" data-testid={`menu-view-complaint-${complaint.id}`}>
              <FileText className="mr-2 h-4 w-4" />View Details
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
  return <div className="space-y-4 p-4 md:space-y-8 md:p-8">
    <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
      <div className="max-w-md">
        <div><h1 className="text-2xl font-bold leading-tight text-white md:text-3xl">{isAdmin ? "Complaints Management" : user?.role === "designer" ? "Complaints About My Work" : "Complaints I Filed"}</h1><p className="mt-2 text-slate-400">Review order-linked complaints for {format(new Date(Number(year), Number(month) - 1, 1), "MMMM yyyy")}.</p></div>
      </div>
      <div className="flex w-full flex-col gap-3 xl:w-auto xl:min-w-[680px]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 sm:min-w-[280px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input placeholder="Search Complaint ID or Client..." className="h-10 bg-slate-900 pl-10 text-white" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-complaints" />
            {isLoading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-500" />}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {isAdmin && <Button variant="outline" onClick={exportComplaintsPDF} data-testid="button-export-complaints"><Download className="mr-2 h-4 w-4" />Export PDF</Button>}
            {canCreate && <Button onClick={() => setCreateOpen(true)} className="bg-primary" data-testid="button-create-complaint"><CheckCircle2 className="mr-2 h-4 w-4" />New Complaint</Button>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-testid="complaint-filters">
          <Filter className="mr-1 hidden h-4 w-4 text-slate-500 md:block" aria-hidden="true" />
          <Select value={status} onValueChange={v => { setStatus(v); setOutcome(""); }}>
            <SelectTrigger className="w-36 bg-slate-900 text-white" data-testid="select-complaint-status-filter"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800 text-white"><SelectItem value="all">All statuses</SelectItem>{complaintStatuses.map(value => <SelectItem key={value} value={value}>{titleCase(value)}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={category} onValueChange={v => setCategory(v)}>
            <SelectTrigger className="w-44 bg-slate-900 text-white" data-testid="select-complaint-category-filter"><SelectValue placeholder="All categories" /></SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800 text-white"><SelectItem value="all">All categories</SelectItem>{categoryOptions.map(item => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
          {(isAdmin || user?.role === "support") && <Select value={designerId} onValueChange={setDesignerId}>
            <SelectTrigger className="w-40 bg-slate-900 text-white" data-testid="select-complaint-designer-filter"><SelectValue placeholder="All designers" /></SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800 text-white"><SelectItem value="all">All designers</SelectItem>{designerOptions.map(designer => <SelectItem key={designer.id} value={String(designer.id)}>{designer.name}{!designer.isActive ? " (Inactive)" : ""}</SelectItem>)}</SelectContent>
          </Select>}
          {hasActiveFilters && <Button type="button" variant="ghost" size="sm" onClick={clearFilters} className="text-slate-400 hover:text-white" data-testid="button-clear-complaint-filters"><X className="mr-1 h-4 w-4" />Clear</Button>}
        </div>
      </div>
    </div>
    {deepLinkMessage && <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100"><span>{deepLinkMessage}</span><Button variant="ghost" size="sm" onClick={() => { setDeepLinkMessage(null); setLocation("/complaints"); }}>Clear link</Button></div>}
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">{cards.map(card => { const Icon = card.icon; return <div key={card.key} className="glass-panel flex items-center gap-3 rounded-xl border border-slate-800 p-4" data-testid={card.testId}><div className={`rounded-lg p-2 ${card.iconClass}`}><Icon className="h-5 w-5" /></div><div><p className="text-xs text-slate-500">{card.label}</p><p className="font-bold text-white">{card.value}</p></div></div>; })}</div>
    {isLoading ? <div className="glass-panel p-16 text-center"><Loader2 className="mx-auto animate-spin text-blue-400" /></div> : isError ? <div className="glass-panel p-12 text-center"><AlertTriangle className="mx-auto mb-3 text-rose-400" /><p className="text-white">Could not load complaints</p><Button variant="outline" className="mt-4" onClick={() => refetch()}>Try Again</Button></div> : !filteredComplaints.length ? <div className="glass-panel p-12 text-center"><ClipboardCheck className="mx-auto mb-4 h-12 w-12 text-slate-600" /><p className="font-semibold text-white">No complaints found</p><p className="mt-2 text-sm text-slate-500">Try another month or filter.</p></div> : <div className="glass-panel overflow-hidden rounded-2xl border border-slate-800">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-800 p-6 sm:flex-row sm:items-center">
        <div><h3 className="text-lg font-bold text-white">Complaints</h3><p className="text-sm text-slate-500">{filteredComplaints.length} complaint{filteredComplaints.length === 1 ? "" : "s"} for {format(new Date(Number(year), Number(month) - 1, 1), "MMMM yyyy")}</p></div>
        <div className="flex flex-wrap gap-2">
          <Select value={year} onValueChange={setYear}><SelectTrigger className="w-24 bg-slate-900 text-white" data-testid="select-year"><SelectValue /></SelectTrigger><SelectContent className="bg-slate-900 border-slate-800 text-white">{[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(v => <SelectItem key={v} value={String(v)}>{v}</SelectItem>)}</SelectContent></Select>
          <Select value={month} onValueChange={setMonth}><SelectTrigger className="w-36 bg-slate-900 text-white" data-testid="select-month"><CalendarDays className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger><SelectContent className="bg-slate-900 border-slate-800 text-white">{Array.from({ length: 12 }, (_, i) => <SelectItem key={i + 1} value={String(i + 1)}>{format(new Date(2024, i, 1), "MMMM")}</SelectItem>)}</SelectContent></Select>
          {outcome === "refund" && <Button type="button" variant="secondary" size="sm" onClick={() => setOutcome("")}>Refund only <X className="ml-1 h-3 w-3" /></Button>}
        </div>
      </div>
      <div className="table-scroll-wrapper"><Table className="min-w-[980px]">{complaintTableHead}<TableBody>{filteredComplaints.map(renderComplaintRow)}</TableBody></Table></div>
    </div>}
    <ComplaintDrawer id={selectedId} open={selectedId !== null} onOpenChange={open => { if (!open) { setSelectedId(null); setLocation("/complaints"); } }} /><ComplaintDialog order={null} orders={orders} open={createOpen} onOpenChange={setCreateOpen} />
  </div>;
}