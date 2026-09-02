import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { format } from "date-fns";
import { AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, ClipboardCheck, Clock, Download, FileWarning, Filter, Loader2, Search, X, XCircle, DollarSign } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { ComplaintStatusBadge } from "@/components/StatusBadge";
import { complaintCategoryLabels, ComplaintDialog } from "@/components/ComplaintDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { getOrderAccounting } from "@shared/order-accounting";
import { PageHeader, MetricCard as CRMMetricCard, EmptyState } from "@/components/CRMPrimitives";
import { ImageDropzone } from "@/components/ImageDropzone";

const errorText = (error: Error) => error.message.match(/"message":"([^"]+)"/)?.[1] || "The request could not be completed.";
const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
const money = (value?: number | null) => value == null ? null : `Rs${Math.round(Number(value) / 100).toLocaleString()}`;
const caseDate = (value?: string | Date | null) => value ? format(new Date(value), "MMM dd, yyyy · h:mm a") : "—";
const complaintStatusHelp: Record<string, string> = {
  new: "Awaiting management review.",
  confirmed: "Complaint confirmed. Resolution is required.",
  dismissed: "Complaint reviewed and dismissed.",
  resolved: "Complaint resolved and closed.",
  refunded: "Complaint refunded and related order canceled.",
};
const complaintHistoryLabel = (entry: ComplaintHistoryEntry) => {
  const from = entry.previousValue ? titleCase(entry.previousValue) : "";
  const to = entry.newValue ? titleCase(entry.newValue) : "";
  if (entry.action === "complaint_created") return "Complaint filed";
  if (entry.action === "complaint_note") return "Admin note added";
  if (entry.action === "complaint_resolution") return entry.previousValue ? "Resolution details updated" : "Resolution details added";
  if (entry.action === "complaint_resolved") return entry.newValue === "refunded" ? "Refund recorded and complaint closed" : "Complaint marked as Resolved";
  if (entry.action === "status_change" && entry.details?.refundRecorded) return "Related order canceled";
  if (entry.action === "complaint_status" && entry.newValue === "confirmed") return "Complaint confirmed";
  if (entry.action === "complaint_status" && entry.newValue === "dismissed") return "Complaint dismissed";
  if (entry.action === "complaint_status") return `Complaint status changed${from ? ` from ${from}` : ""}${to ? ` to ${to}` : ""}`;
  return titleCase(entry.action);
};

export function ComplaintDetails({ id, open, onOpenChange, onBack }: { id: number | null; open: boolean; onOpenChange: (open: boolean) => void; onBack?: () => void }) {
  const { user } = useAuth(); const { toast } = useToast(); const isAdmin = user?.role === "admin";
  const [notes, setNotes] = useState(""); const [resolution, setResolution] = useState(""); const [resolutionEvidence, setResolutionEvidence] = useState(""); const [dismissalReason, setDismissalReason] = useState(""); const [refundConfirmed, setRefundConfirmed] = useState(false); const [pending, setPending] = useState<string | null>(null); const [imagePreview, setImagePreview] = useState<string | null>(null);
  const { data: complaint, isLoading, isError } = useQuery<ComplaintResponse>({ queryKey: [`/api/complaints/${id}`], enabled: Boolean(id && open) });
  const { data: history = [] } = useQuery<ComplaintHistoryEntry[]>({ queryKey: [`/api/complaints/${id}/history`], enabled: Boolean(id && open) });
  useEffect(() => {
    setNotes("");
    setResolution(complaint?.status === "confirmed" ? complaint.resolution || "" : "");
    setResolutionEvidence(complaint?.status === "confirmed" ? complaint.resolutionScreenshotUrl || "" : "");
    setDismissalReason("");
    setRefundConfirmed(false);
    setImagePreview(null);
  }, [complaint?.id]);
  const update = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await apiRequest("PATCH", `/api/complaints/${id}`, payload)).json(),
    onSuccess: (value: ComplaintResponse, variables) => { queryClient.setQueryData([`/api/complaints/${id}`], value); queryClient.invalidateQueries({ queryKey: ["/api/complaints"] }); queryClient.invalidateQueries({ queryKey: ["/api/orders"] }); queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications"] }); queryClient.invalidateQueries({ queryKey: ["/api/stats"] }); queryClient.invalidateQueries({ queryKey: [`/api/complaints/${id}/history`] }); setPending(null); setNotes(""); const status = variables.status as string | undefined; toast({ title: variables.adminNote ? "Admin note added." : status === "confirmed" ? "Complaint confirmed." : status === "dismissed" ? "Complaint dismissed." : status === "resolved" ? "Complaint resolved." : status === "refunded" ? "Refund recorded and order canceled." : "Complaint updated." }); },
    onError: (e: Error) => toast({ title: "Update failed", description: errorText(e), variant: "destructive" }),
  });
  const submitDecision = () => {
    if (!pending || !complaint) return;
    const isClosing = pending === "resolved" || pending === "refunded";
    update.mutate({
      status: pending,
      confirmDecision: true,
      ...(pending === "dismissed" ? { dismissalReason: dismissalReason.trim() } : {}),
      ...(isClosing ? { resolution: resolution.trim(), resolutionScreenshotUrl: resolutionEvidence || null, refundConfirmed } : {}),
    });
  };
  const uploadResolutionEvidence = async (file: File) => {
    const body = new FormData(); body.append("screenshot", file); body.append("folder", "complaints");
    try { const response = await fetch("/api/feedback/upload", { method: "POST", body, credentials: "include" }); if (!response.ok) throw new Error(); setResolutionEvidence((await response.json()).screenshotUrl); }
    catch { toast({ title: "Upload failed", description: "Resolution evidence could not be uploaded.", variant: "destructive" }); }
  };
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="detail-drawer w-full overflow-y-auto border-slate-800 bg-slate-950 text-white sm:max-w-xl">
    <SheetHeader className="detail-drawer-header border-b border-slate-800 pb-5 pr-8 text-left">
      <SheetTitle className="flex items-center gap-3"><div className="flex items-center gap-2">{onBack && <Button variant="ghost" size="icon" className="-ml-2 h-8 w-8" onClick={onBack} aria-label="Back to order"><ArrowLeft className="h-4 w-4" /></Button>}<span className="font-mono text-xl text-blue-300">{complaint?.complaintNumber || "Complaint details"}</span></div>{complaint && <ComplaintStatusBadge status={complaint.status} />}</SheetTitle>
      {complaint && <p className="mt-1 text-sm text-slate-500">{complaintStatusHelp[complaint.status]}</p>}
    </SheetHeader>
    {isLoading ? <div className="py-24 text-center"><Loader2 className="mx-auto animate-spin text-blue-400" /></div> : isError || !complaint ? <div className="py-20 text-center text-slate-400"><AlertTriangle className="mx-auto mb-3 text-rose-400" />Could not load this complaint.</div> : <div className="mt-6 space-y-5">
      <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-lg shadow-black/10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Complaint Summary</p>
        <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-5">
          <div className="col-span-2"><dt className="text-xs text-slate-500">Category</dt><dd className="mt-2"><Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-200">{titleCase(complaint.category)}</Badge></dd></div>
            <div><dt className="text-xs text-slate-500">Complaint Against</dt><dd className="mt-1 text-sm font-medium text-white">{complaint.complaintAgainst?.name || complaint.complaintTargetName || "—"} <span className="text-xs font-normal text-slate-500">· Designer</span></dd></div>
          <div><dt className="text-xs text-slate-500">Client</dt><dd className="mt-1 text-sm font-medium text-white">{complaint.clientName || "—"}</dd></div>
          <div><dt className="text-xs text-slate-500">Date Reported</dt><dd className="mt-1 text-sm text-slate-300">{caseDate(complaint.createdAt)}</dd></div>
          {isAdmin && complaint.filedBy && <div><dt className="text-xs text-slate-500">Reported By</dt><dd className="mt-1 text-sm text-slate-300">{complaint.filedBy.name} <span className="text-slate-500">· {titleCase(complaint.filedBy.role)}</span></dd></div>}
        </dl>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Complaint Details</p>
        <p className="mt-4 whitespace-pre-wrap break-words text-[15px] leading-7 text-slate-200">{complaint.description}</p>
      </section>

      <section className="border-b border-slate-800 pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Complaint Evidence</p>
        {complaint.screenshotUrl ? <div className="mt-4 space-y-3"><button type="button" onClick={() => setImagePreview(complaint.screenshotUrl!)} className="block w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900"><img src={complaint.screenshotUrl} alt="Complaint evidence" className="max-h-56 w-full object-contain" /></button><Button variant="ghost" size="sm" className="px-0 text-blue-300 hover:text-blue-200" onClick={() => setImagePreview(complaint.screenshotUrl!)}>View Full Image</Button></div> : <p className="mt-3 text-sm text-slate-500">No evidence was attached to this complaint.</p>}
      </section>

      {complaint.order && <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Order Summary</p><a href={`/orders?order=${encodeURIComponent(complaint.order.orderNumber || String(complaint.orderId))}`} className="mt-3 block font-mono text-sm font-medium text-blue-300 hover:underline">#{complaint.order.orderNumber || complaint.orderId} · {complaint.order.clientName}</a></div><Badge variant="outline" className="border-slate-700 text-slate-300">{titleCase(complaint.order.status)}</Badge></div>
        <div className="mt-4"><p className="text-xs text-slate-500">Services</p><p className="mt-1 text-sm leading-6 text-slate-300">{complaint.order.services?.length ? complaint.order.services.map(service => `${service.serviceType} ×${service.quantity || 1}`).join(", ") : complaint.order.packageType ? titleCase(complaint.order.packageType) : "No services recorded."}</p></div>
        {(complaint.order.totalPrice != null || complaint.order.advanceAmount != null || complaint.order.remainingAmount != null) && <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-800 pt-4 text-sm">
          {complaint.order.totalPrice != null && <div><dt className="text-xs text-slate-500">Total</dt><dd className="mt-1 text-white">{money(complaint.order.totalPrice)}</dd></div>}
          {complaint.order.advanceAmount != null && <div><dt className="text-xs text-slate-500">Net Collected</dt><dd className="mt-1 text-white">{money(getOrderAccounting(complaint.order).netCollected)}</dd>{complaint.order.status === "canceled" && <span className="text-xs text-slate-400">{complaint.order.advanceRefunded ? "Advance refunded" : "Advance retained"}</span>}</div>}
          {complaint.order.remainingAmount != null && <div><dt className="text-xs text-slate-500">Remaining Receivable</dt><dd className="mt-1 text-white">{money(getOrderAccounting(complaint.order).remainingReceivable)}</dd>{complaint.order.status === "canceled" && <span className="text-xs text-slate-500">Original balance {money(complaint.order.remainingAmount)} canceled</span>}</div>}
        </dl>}
      </section>}

      {complaint.status === "new" && isAdmin && <section className="space-y-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">Management Decision</p><p className="mt-2 text-sm leading-6 text-slate-400">Review the complaint and decide whether the reported issue should be confirmed or dismissed.</p></div><div className="grid grid-cols-2 gap-2"><Button onClick={() => setPending("confirmed")} className="bg-amber-600 hover:bg-amber-500"><CheckCircle2 className="mr-2 h-4 w-4" />Confirm Complaint</Button><Button variant="outline" onClick={() => setPending("dismissed")}><XCircle className="mr-2 h-4 w-4" />Dismiss Complaint</Button></div><p className="text-xs text-slate-500">Final complaint decisions are recorded for audit purposes.</p></section>}

       {complaint.status === "confirmed" && <section className="space-y-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">Resolution</p><p className="mt-2 text-sm leading-6 text-slate-400">This complaint has been confirmed. Record how the issue was handled before closing the case.</p></div>{isAdmin && <><div className="space-y-2"><Label htmlFor="resolution">Resolution Details <span className="text-rose-400">*</span></Label><Textarea id="resolution" value={resolution} onChange={event => setResolution(event.target.value)} placeholder="What action was taken to resolve the complaint?" rows={4} className="border-slate-700 bg-slate-950" /></div><div className="space-y-2"><Label>Resolution Evidence</Label><ImageDropzone onFile={uploadResolutionEvidence} accept="image/png,image/jpeg,image/webp" label="Choose resolution evidence" description="Paste from clipboard or drag an image here" /></div>{resolutionEvidence && <img src={resolutionEvidence} alt="Selected resolution evidence" className="max-h-40 w-full rounded-lg object-contain" />}<label className="flex gap-2 text-sm text-slate-300"><input type="checkbox" checked={refundConfirmed} onChange={event => setRefundConfirmed(event.target.checked)} />I confirm that the client refund has been completed.</label><div className="grid grid-cols-2 gap-2"><Button disabled={!resolution.trim()} onClick={() => setPending("resolved")} className="bg-emerald-600 hover:bg-emerald-500">Mark Resolved</Button><Button variant="outline" disabled={!resolution.trim() || !refundConfirmed} onClick={() => setPending("refunded")}>Mark Refunded &amp; Cancel Order</Button></div></>}</section>}

      {complaint.status === "dismissed" && <section className="rounded-2xl border border-slate-700 bg-slate-900/60 p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Decision</p><div className="mt-4 flex items-center gap-2"><XCircle className="h-5 w-5 text-slate-400" /><p className="font-semibold text-white">Complaint Dismissed</p></div><div className="mt-4"><p className="text-xs text-slate-500">Reason for Dismissal</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{complaint.dismissalReason || "No reason recorded."}</p></div>{isAdmin && <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-800 pt-4 text-sm"><div><dt className="text-xs text-slate-500">Dismissed By</dt><dd className="mt-1">{complaint.dismissedBy?.name || "—"}</dd></div><div><dt className="text-xs text-slate-500">Date</dt><dd className="mt-1 text-slate-300">{caseDate(complaint.dismissedAt)}</dd></div></dl>}<p className="mt-4 text-xs text-slate-500">No further action is required.</p></section>}

      {complaint.status === "resolved" && <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Resolution</p><div className="mt-4"><p className="text-xs text-slate-500">Resolution Summary</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{complaint.resolution || "No resolution summary was recorded."}</p></div><dl className="mt-4 grid grid-cols-2 gap-4 border-t border-emerald-500/10 pt-4 text-sm"><div><dt className="text-xs text-slate-500">Resolved By</dt><dd className="mt-1">{complaint.resolvedBy?.name || (isAdmin ? "—" : "Management")}</dd></div><div><dt className="text-xs text-slate-500">Resolved On</dt><dd className="mt-1 text-slate-300">{caseDate(complaint.resolvedAt)}</dd></div></dl>{complaint.resolutionScreenshotUrl && <div className="mt-4"><p className="mb-2 text-xs text-slate-500">Resolution Evidence</p><button type="button" onClick={() => setImagePreview(complaint.resolutionScreenshotUrl!)} className="block w-full overflow-hidden rounded-xl border border-emerald-500/20 bg-slate-950"><img src={complaint.resolutionScreenshotUrl} alt="Resolution evidence" className="max-h-56 w-full object-contain" /></button></div>}</section>}

      {complaint.status === "refunded" && <section className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-300">Final Outcome</p><div className="mt-4 flex items-center gap-2"><DollarSign className="h-5 w-5 text-rose-300" /><p className="font-semibold text-white">Refunded &amp; Order Canceled</p></div><div className="mt-4"><p className="text-xs text-slate-500">Refund / Resolution Details</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{complaint.resolution || "No refund details were recorded."}</p></div><dl className="mt-4 grid grid-cols-2 gap-4 border-t border-rose-500/10 pt-4 text-sm"><div><dt className="text-xs text-slate-500">Refund Amount</dt><dd className="mt-1">{money(complaint.order?.refundAmount) || "—"}</dd></div><div><dt className="text-xs text-slate-500">Order ID</dt><dd className="mt-1 font-mono text-blue-300">{complaint.orderNumber || complaint.orderId}</dd></div><div><dt className="text-xs text-slate-500">Refunded By</dt><dd className="mt-1">{complaint.resolvedBy?.name || (isAdmin ? "—" : "Management")}</dd></div><div><dt className="text-xs text-slate-500">Refunded Date</dt><dd className="mt-1 text-slate-300">{caseDate(complaint.resolvedAt)}</dd></div></dl>{complaint.resolutionScreenshotUrl && <div className="mt-4"><p className="mb-2 text-xs text-slate-500">Refund Evidence</p><button type="button" onClick={() => setImagePreview(complaint.resolutionScreenshotUrl!)} className="block w-full overflow-hidden rounded-xl border border-rose-500/20 bg-slate-950"><img src={complaint.resolutionScreenshotUrl} alt="Refund evidence" className="max-h-56 w-full object-contain" /></button></div>}<p className="mt-4 text-xs leading-5 text-slate-500">The complaint resulted in a client refund and cancellation of the related order.</p></section>}

      {isAdmin && <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Internal Admin Notes</p><p className="mt-2 text-xs leading-5 text-slate-500">Private management notes. These are not visible to Designers or Support.</p></div><div className="mt-4 space-y-3">{complaint.adminNotesLog?.length ? complaint.adminNotesLog.map(note => <article key={note.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4"><p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{note.noteText}</p><p className="mt-3 text-xs text-slate-500">{note.createdBy?.name ? `${note.createdBy.name} · ${titleCase(note.createdBy.role)}` : "Migrated Admin Note"} · {caseDate(note.createdAt)}</p></article>) : <p className="text-sm text-slate-500">No internal notes have been added.</p>}</div><div className="mt-5 border-t border-slate-800 pt-5"><Label htmlFor="admin-notes" className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Add New Note</Label><Textarea id="admin-notes" value={notes} onChange={event => setNotes(event.target.value)} placeholder="Write an internal note..." rows={3} className="mt-3 border-slate-700 bg-slate-950" /><div className="mt-3 flex justify-end"><Button variant="outline" disabled={!notes.trim() || update.isPending} onClick={() => update.mutate({ adminNote: notes.trim() })}>{update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add Note</Button></div></div></section>}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Case History</p><div className="mt-5 space-y-0">{history.length ? history.map((entry, index) => <div key={entry.id} className="relative flex gap-4 pb-6 last:pb-0"><div className="relative flex w-3 shrink-0 justify-center"><span className="mt-1 h-3 w-3 rounded-full border-2 border-slate-900 bg-blue-500" />{index < history.length - 1 && <span className="absolute bottom-0 top-4 w-px bg-slate-700" />}</div><div className="min-w-0"><p className="text-sm font-medium text-slate-200">{complaintHistoryLabel(entry)}</p>{entry.action === "complaint_status" && entry.previousValue && entry.newValue && <p className="mt-1 text-xs text-slate-400">{titleCase(entry.previousValue)} → {titleCase(entry.newValue)}</p>}<p className="mt-1 text-xs text-slate-500">{entry.actor?.name ? `${entry.actor.name} · ` : ""}{caseDate(entry.createdAt)}</p></div></div>) : <p className="text-sm text-slate-500">No case history entries yet.</p>}</div></section>
    </div>}
    <Dialog open={Boolean(imagePreview)} onOpenChange={previewOpen => !previewOpen && setImagePreview(null)}><DialogContent className="max-w-4xl border-slate-800 bg-slate-950"><DialogTitle className="sr-only">Evidence preview</DialogTitle>{imagePreview && <img src={imagePreview} alt="Full evidence preview" className="max-h-[80vh] w-full object-contain" />}</DialogContent></Dialog>
    <AlertDialog open={Boolean(pending)} onOpenChange={v => !v && setPending(null)}><AlertDialogContent className="bg-slate-900 border-slate-800 text-white"><AlertDialogHeader><AlertDialogTitle>{pending === "dismissed" ? "Dismiss Complaint" : pending === "refunded" ? "Refund & Cancel Order" : pending === "resolved" ? "Mark Complaint as Resolved?" : "Confirm this complaint?"}</AlertDialogTitle><AlertDialogDescription className="text-slate-400">{pending === "refunded" ? `This will mark ${complaint?.complaintNumber} as refunded and cancel the related order. The order will be excluded from active financial calculations.` : pending === "dismissed" ? "Please explain why this complaint should not be treated as a confirmed issue." : "This decision is recorded and cannot be reversed through the normal CRM interface."}</AlertDialogDescription></AlertDialogHeader>{pending === "dismissed" && <div className="space-y-2"><Label>Reason for Dismissal <span className="text-rose-400">*</span></Label><Textarea value={dismissalReason} onChange={e => setDismissalReason(e.target.value)} /></div>}<AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={submitDecision} disabled={update.isPending || (pending === "dismissed" && !dismissalReason.trim())}>{pending === "refunded" ? "Confirm Refund & Cancel Order" : pending === "dismissed" ? "Dismiss Complaint" : pending === "resolved" ? "Mark Resolved" : "Confirm Complaint"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </SheetContent></Sheet>;
}

export default function ComplaintsPage() {
  const { user } = useAuth(); const { toast } = useToast(); const [, setLocation] = useLocation(); const [, routeParams] = useRoute("/complaints/:id");
  const deepComplaintNumber = new URLSearchParams(window.location.search).get("complaint");
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("all"); const [outcome, setOutcome] = useState(""); const [category, setCategory] = useState("all"); const [designerId, setDesignerId] = useState("all"); const [createOpen, setCreateOpen] = useState(false); const [selectedId, setSelectedId] = useState<number | null>(routeParams?.id ? Number(routeParams.id) : null);
  const now = new Date(); const [month, setMonth] = useState(String(now.getMonth() + 1)); const [year, setYear] = useState(String(now.getFullYear()));
  const query = new URLSearchParams({ month, year, ...(search || deepComplaintNumber ? { search: search || deepComplaintNumber || "" } : {}), ...(status !== "all" ? { status } : {}), ...(category !== "all" ? { category } : {}), ...(designerId !== "all" ? { designerId } : {}) }).toString();
  const complaintsUrl = `/api/complaints?${query}`;
  const statsUrl = `/api/stats?month=${month}&year=${year}${designerId !== "all" ? `&designerId=${designerId}` : ""}`;
  const fetchJson = async <T,>(url: string): Promise<T> => {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    return response.json();
  };
  const { data: complaints = [], isLoading, isError, refetch } = useQuery<ComplaintResponse[]>({
    queryKey: ["/api/complaints", query],
    queryFn: () => fetchJson<ComplaintResponse[]>(complaintsUrl),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
  const { data: statsResponse } = useQuery<{ complaints: ComplaintStats }>({
    queryKey: ["/api/stats", statsUrl],
    queryFn: () => fetchJson<{ complaints: ComplaintStats }>(statsUrl),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
  const { data: categories = [] } = useQuery<ComplaintCategoryConfig[]>({ queryKey: ["/api/complaint-categories"], staleTime: 300000 });
  const { data: teamMembers = [] } = useQuery<{ id: number; name: string; role: string; isActive: boolean }[]>({ queryKey: ["/api/users"], enabled: user?.role === "admin" || user?.role === "support", staleTime: 300000 });
  const { data: orders = [] } = useQuery<OrderWithServices[]>({ queryKey: ["/api/orders"], enabled: user?.role === "admin" || user?.role === "support" });
  const stats = statsResponse?.complaints; const isAdmin = user?.role === "admin"; const canCreate = isAdmin || user?.role === "support";
  const categoryOptions = categories.length ? categories.filter(c => c.isActive) : complaintCategories.map(key => ({ key, label: complaintCategoryLabels[key] }));
  const cards = [
    { key: "all", label: "All Complaints", value: stats?.all ?? complaints.length, icon: FileWarning, iconClass: "bg-blue-500/10 text-blue-500", testId: "stat-complaints-all" },
    { key: "new", label: "New", value: stats?.new ?? complaints.filter(c => c.status === "new").length, icon: Clock, iconClass: "bg-amber-500/10 text-amber-400", testId: "stat-complaints-new" },
    { key: "confirmed", label: "Confirmed", value: stats?.confirmed ?? complaints.filter(c => c.status === "confirmed").length, icon: CheckCircle2, iconClass: "bg-amber-500/10 text-amber-400", testId: "stat-complaints-valid" },
    { key: "dismissed", label: "Dismissed", value: stats?.dismissed ?? complaints.filter(c => c.status === "dismissed").length, icon: XCircle, iconClass: "bg-slate-500/10 text-slate-400", testId: "stat-complaints-invalid" },
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
        <TableHead className="text-right text-slate-400">Details</TableHead>
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
        <Button variant="outline" size="sm" onClick={() => openComplaint(complaint.id)} data-testid={`button-view-complaint-${complaint.id}`}>
          View Details
        </Button>
      </TableCell>
    </TableRow>
  );
  return <div className="crm-page space-y-5">
    <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
      <div className="max-w-md">
        <PageHeader eyebrow="Service quality" title={isAdmin ? "Complaints Management" : user?.role === "designer" ? "Complaints About My Work" : "Complaints I Filed"} description={`Review order-linked complaints for ${format(new Date(Number(year), Number(month) - 1, 1), "MMMM yyyy")}.`} />
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
     <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">{cards.map(card => <CRMMetricCard key={card.key} label={card.label} value={card.value} icon={card.icon} testId={card.testId} tone={card.key === "new" || card.key === "confirmed" ? "warning" : card.key === "resolved" ? "success" : card.key === "refund" ? "danger" : "cyan"} />)}</div>
     {isLoading ? <div className="glass-panel p-16 text-center"><Loader2 className="mx-auto animate-spin text-cyan-300" /></div> : isError ? <div className="glass-panel p-12 text-center"><AlertTriangle className="mx-auto mb-3 text-rose-400" /><p className="text-white">Could not load complaints</p><Button variant="outline" className="mt-4" onClick={() => refetch()}>Try Again</Button></div> : !filteredComplaints.length ? <div className="crm-section"><EmptyState title="No complaints found" description="Try another month or filter." icon={ClipboardCheck} /></div> : <div className="crm-section">
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
    <ComplaintDetails id={selectedId} open={selectedId !== null} onOpenChange={open => { if (!open) { setSelectedId(null); setLocation("/complaints"); } }} /><ComplaintDialog order={null} orders={orders} open={createOpen} onOpenChange={setCreateOpen} />
  </div>;
}