import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Facebook,
  FileImage,
  Filter,
  Loader2,
  MessageSquare,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Star,
  ThumbsUp,
  Video,
  X,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { OrderWithServices, User } from "@shared/schema";

type Review = {
  id: number;
  reviewNumber: string;
  orderId: number;
  orderNumber: string | null;
  clientName: string;
  reviewForDesigner?: User | null;
  createdBy?: User | null;
  rating: number | null;
  feedbackText: string;
  whatsappFeedbackReceived: boolean;
  facebookReviewReceived: boolean;
  videoReviewReceived: boolean;
  publicReviewLink?: string | null;
  marketingPermission: string;
  screenshotUrl?: string | null;
  reviewProgress: "requested" | "received" | "public_review_received" | "closed";
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  order?: { packageType?: string | null; services?: OrderWithServices["services"]; paymentStatus?: string | null };
};

type Suggestion = {
  id: number;
  suggestionNumber: string;
  orderId: number;
  orderNumber: string | null;
  clientName: string;
  relatedDesigner?: User | null;
  createdBy?: User | null;
  category: string;
  suggestionText: string;
  status: "new" | "implemented" | "rejected";
  screenshotUrl?: string | null;
  adminNotes?: string | null;
  decisionNote?: string | null;
  reviewedBy?: User | null;
  reviewedAt?: string | Date | null;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  order?: { packageType?: string | null; services?: OrderWithServices["services"] };
};

type FeedbackStats = {
  reviews: {
    all: number;
    averageRating: number | null;
    whatsapp: number;
    facebook: number;
    video: number;
  };
  suggestions: {
    all: number;
    new: number;
    implemented: number;
    rejected: number;
  };
};

const suggestionCategories = [
  ["communication", "Communication"],
  ["document_quality", "Document Quality"],
  ["delivery", "Delivery"],
  ["revision_experience", "Revision Experience"],
  ["production_process", "Production Process"],
  ["sales_experience", "Sales Experience"],
  ["pricing", "Pricing"],
  ["crm_technical", "CRM / Technical"],
  ["service_offering", "Service Offering"],
  ["after_sales", "After-Sales"],
  ["other", "Other"],
] as const;

const suggestionStatusLabels: Record<Suggestion["status"], string> = {
  new: "New",
  implemented: "Implemented",
  rejected: "Rejected",
};

const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
const errorText = (error: Error) => error.message.match(/"message":"([^"]+)"/)?.[1] || "The request could not be completed.";

function MetricCard({ title, value, icon: Icon, color = "blue", testId }: { title: string; value: string | number; icon: typeof Star; color?: string; testId?: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-500/10 text-blue-500",
    green: "bg-emerald-500/10 text-emerald-400",
    purple: "bg-violet-500/10 text-violet-400",
    orange: "bg-amber-500/10 text-amber-400",
    red: "bg-rose-500/10 text-rose-400",
  };
  return (
    <div className="glass-panel flex items-center gap-3 rounded-xl border border-slate-800 p-4" data-testid={testId}>
      <div className={`rounded-lg p-2 ${colors[color] || colors.blue}`}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{title}</p>
        <p className="font-bold text-white">{value}</p>
      </div>
    </div>
  );
}

function ChannelBadges({ review }: { review: Review }) {
  const channels = [
    review.whatsappFeedbackReceived && ["WhatsApp", MessageSquare],
    review.facebookReviewReceived && ["Facebook", Facebook],
    review.videoReviewReceived && ["Video", Video],
  ].filter(Boolean) as [string, typeof MessageSquare][];
  if (!channels.length) return <span className="text-slate-600">—</span>;
  return <div className="flex flex-wrap gap-1.5">{channels.map(([label, Icon]) => <Badge key={label} variant="outline" className="gap-1 border-slate-700 text-slate-300"><Icon className="h-3 w-3" />{label}</Badge>)}</div>;
}

function ScreenshotField({ value, onChange, folder }: { value: string; onChange: (value: string) => void; folder: "reviews" | "suggestions" }) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("screenshot", file);
      body.append("folder", folder);
      const response = await fetch("/api/feedback/upload", { method: "POST", body, credentials: "include" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Screenshot upload failed.");
      const result = await response.json();
      onChange(result.screenshotUrl);
    } catch (error) {
      toast({ title: "Upload failed", description: error instanceof Error ? error.message : "Screenshot could not be uploaded.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="space-y-2">
      <Label>Screenshot / Evidence <span className="text-slate-600">(optional)</span></Label>
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/60 p-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-400 hover:text-white">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin text-blue-400" /> : <FileImage className="h-4 w-4 text-blue-400" />}
          {uploading ? "Uploading to Cloudinary…" : value ? "Replace screenshot" : "Choose PNG, JPG, JPEG, or WEBP"}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploading} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} />
        </label>
        {value && <div className="mt-3 space-y-2"><img src={value} alt="Selected evidence" className="max-h-40 w-full rounded-lg bg-slate-900 object-contain" /><Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-slate-400" onClick={() => onChange("")}><X className="mr-1 h-3 w-3" />Remove</Button></div>}
      </div>
    </div>
  );
}

function ReviewForm({ review, orders, open, onOpenChange, defaultOrderId }: { review?: Review | null; orders: OrderWithServices[]; open: boolean; onOpenChange: (open: boolean) => void; defaultOrderId?: number | null }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [orderId, setOrderId] = useState(review?.orderId ? String(review.orderId) : defaultOrderId ? String(defaultOrderId) : "");
  const [rating, setRating] = useState(review?.rating ? String(review.rating) : "not_rated");
  const [feedbackText, setFeedbackText] = useState(review?.feedbackText || "");
  const [whatsapp, setWhatsapp] = useState(review?.whatsappFeedbackReceived ?? false);
  const [facebook, setFacebook] = useState(review?.facebookReviewReceived ?? false);
  const [video, setVideo] = useState(review?.videoReviewReceived ?? false);
  const [publicLink, setPublicLink] = useState(review?.publicReviewLink || "");
  const [marketingPermission, setMarketingPermission] = useState(review?.marketingPermission || "not_asked");
  const [screenshotUrl, setScreenshotUrl] = useState(review?.screenshotUrl || "");
  const [reviewProgress, setReviewProgress] = useState<Review["reviewProgress"]>(review?.reviewProgress || "requested");
  const selectedOrder = orders.find(order => String(order.id) === orderId);
  const mutation = useMutation({
    mutationFn: async () => (await apiRequest(review ? "PATCH" : "POST", review ? `/api/feedback/reviews/${review.id}` : "/api/feedback/reviews", {
      ...(review ? {} : { orderId: Number(orderId) }),
      rating: rating === "not_rated" ? null : Number(rating),
      feedbackText: feedbackText.trim(),
      whatsappFeedbackReceived: whatsapp,
      facebookReviewReceived: facebook,
      videoReviewReceived: video,
      publicReviewLink: publicLink.trim() || null,
      marketingPermission,
      screenshotUrl: screenshotUrl || null,
      ...(review && user?.role === "admin" ? { reviewProgress } : {}),
    })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feedback/stats"] });
      toast({ title: review ? "Review updated" : "Review recorded" });
      onOpenChange(false);
    },
    onError: (error: Error) => toast({ title: "Could not save review", description: errorText(error), variant: "destructive" }),
  });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-900 text-white sm:max-w-xl"><DialogHeader><DialogTitle>{review ? "Update Review" : "New Review"}</DialogTitle></DialogHeader>
    <div className="space-y-4">
      <div className="space-y-2"><Label>Order</Label><Select value={orderId} onValueChange={setOrderId} disabled={Boolean(review)}><SelectTrigger><SelectValue placeholder="Select an order" /></SelectTrigger><SelectContent>{orders.map(order => <SelectItem key={order.id} value={String(order.id)}>{order.orderNumber || `Order #${order.id}`} · {order.clientName}</SelectItem>)}</SelectContent></Select>{selectedOrder && <p className="text-xs text-slate-500">Designer: {selectedOrder.assignee?.name || "Unassigned"} · Client: {selectedOrder.clientName}</p>}</div>
      <div className="space-y-2"><Label>Client Rating</Label><Select value={rating} onValueChange={setRating}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="not_rated">Not Rated</SelectItem>{[1, 2, 3, 4, 5].map(value => <SelectItem key={value} value={String(value)}>{value} / 5</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="review-feedback">Client Feedback</Label><Textarea id="review-feedback" value={feedbackText} onChange={event => setFeedbackText(event.target.value)} rows={5} placeholder="Record what the client shared…" /></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[["WhatsApp", whatsapp, setWhatsapp], ["Facebook", facebook, setFacebook], ["Video", video, setVideo]].map(([label, checked, setter]) => <label key={label as string} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300"><input type="checkbox" checked={checked as boolean} onChange={event => (setter as (value: boolean) => void)(event.target.checked)} />{label as string} received</label>)}</div>
      <div className="space-y-2"><Label htmlFor="public-review-link">Public Review Link <span className="text-slate-600">(optional)</span></Label><Input id="public-review-link" type="url" value={publicLink} onChange={event => setPublicLink(event.target.value)} placeholder="https://…" /></div>
      <div className="space-y-2"><Label>Marketing Permission</Label><Select value={marketingPermission} onValueChange={setMarketingPermission}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem><SelectItem value="not_asked">Not Asked</SelectItem></SelectContent></Select></div>
      {review && user?.role === "admin" && <div className="space-y-2"><Label>Review progress</Label><Select value={reviewProgress} onValueChange={value => setReviewProgress(value as Review["reviewProgress"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="requested">Feedback Requested</SelectItem><SelectItem value="received">Feedback Received</SelectItem><SelectItem value="public_review_received">Public Review Added</SelectItem><SelectItem value="closed">Completed</SelectItem></SelectContent></Select><p className="text-xs text-slate-500">Progress advances automatically when feedback is recorded.</p></div>}
      <ScreenshotField value={screenshotUrl} onChange={setScreenshotUrl} folder="reviews" />
      <Button className="w-full bg-blue-600 hover:bg-blue-500" disabled={!orderId || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{review ? "Save Review" : "Add Review"}</Button>
    </div>
  </DialogContent></Dialog>;
}

function SuggestionForm({ orders, open, onOpenChange, defaultOrderId }: { orders: OrderWithServices[]; open: boolean; onOpenChange: (open: boolean) => void; defaultOrderId?: number | null }) {
  const { toast } = useToast();
  const [orderId, setOrderId] = useState(defaultOrderId ? String(defaultOrderId) : "");
  const [category, setCategory] = useState("");
  const [suggestionText, setSuggestionText] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const selectedOrder = orders.find(order => String(order.id) === orderId);
  const mutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/feedback/suggestions", { orderId: Number(orderId), category, suggestionText: suggestionText.trim(), screenshotUrl: screenshotUrl || null })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feedback/stats"] });
      toast({ title: "Suggestion added" });
      onOpenChange(false);
      setOrderId(""); setCategory(""); setSuggestionText(""); setScreenshotUrl("");
    },
    onError: (error: Error) => toast({ title: "Could not add suggestion", description: errorText(error), variant: "destructive" }),
  });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-900 text-white sm:max-w-xl"><DialogHeader><DialogTitle>New Suggestion</DialogTitle></DialogHeader>
    <div className="space-y-4">
      <div className="space-y-2"><Label>Order</Label><Select value={orderId} onValueChange={setOrderId}><SelectTrigger><SelectValue placeholder="Select an order" /></SelectTrigger><SelectContent>{orders.map(order => <SelectItem key={order.id} value={String(order.id)}>{order.orderNumber || `Order #${order.id}`} · {order.clientName}</SelectItem>)}</SelectContent></Select>{selectedOrder && <p className="text-xs text-slate-500">Designer: {selectedOrder.assignee?.name || "Unassigned"} · Client: {selectedOrder.clientName}</p>}</div>
      <div className="space-y-2"><Label>Category</Label><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger><SelectContent>{suggestionCategories.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="suggestion-text">Suggestion</Label><Textarea id="suggestion-text" required value={suggestionText} onChange={event => setSuggestionText(event.target.value)} rows={6} placeholder="What could improve the client experience?" /></div>
      <ScreenshotField value={screenshotUrl} onChange={setScreenshotUrl} folder="suggestions" />
      <Button className="w-full bg-blue-600 hover:bg-blue-500" disabled={!orderId || !category || !suggestionText.trim() || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add Suggestion</Button>
    </div>
  </DialogContent></Dialog>;
}

function ReviewProgress({ review }: { review: Review }) {
  const steps: Array<{ value: Review["reviewProgress"]; label: string }> = [{ value: "requested", label: "Feedback Requested" }, { value: "received", label: "Feedback Received" }, { value: "public_review_received", label: "Public Review Added" }, { value: "closed", label: "Completed" }];
  const current = Math.max(0, steps.findIndex(step => step.value === review.reviewProgress));
  return <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
    <div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium text-slate-300">Review progress</span><span className="text-blue-300">{steps[current].label}</span></div>
    <div className="mt-3 grid grid-cols-4 gap-1" aria-label={`Review progress: ${steps[current].label}`}>{steps.map((step, index) => <div key={step.value} className="min-w-0"><span className={`block h-1.5 rounded-full ${index <= current ? "bg-blue-500" : "bg-slate-700"}`} /><span className={`mt-1 block truncate text-[10px] ${index <= current ? "text-blue-300" : "text-slate-600"}`}>{step.label}</span></div>)}</div>
    <p className="mt-2 text-xs text-slate-500">Client feedback collection progress.</p>
  </div>;
}

function ReviewDetails({ review, open, onOpenChange, onEdit, onOpenOrder }: { review: Review | null; open: boolean; onOpenChange: (open: boolean) => void; onEdit: () => void; onOpenOrder: (id: number) => void }) {
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full overflow-y-auto border-slate-800 bg-slate-950 text-white sm:max-w-xl"><SheetHeader><SheetTitle className="flex items-center justify-between gap-3 pr-6"><span>{review?.reviewNumber || "Review Details"}</span>{review && <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="mr-2 h-3.5 w-3.5" />Update</Button>}</SheetTitle></SheetHeader>{review && <div className="mt-6 space-y-5">
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-slate-500">Client feedback</p><p className="mt-2 text-lg font-medium">{review.clientName}</p><p className="mt-1 text-sm text-slate-500">{review.orderNumber || `Order #${review.orderId}`} · {review.createdAt ? format(new Date(review.createdAt), "MMM dd, yyyy h:mm a") : "—"}</p></div><div className="text-right"><p className="text-xs text-slate-500">Rating</p><p className="mt-1 text-2xl font-bold text-amber-400">{review.rating ? `${review.rating}/5` : "Not Rated"}</p></div></div><p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{review.feedbackText || "No written feedback recorded."}</p></section>
    <section className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm"><div><p className="text-xs text-slate-500">Designer</p><p className="mt-1">{review.reviewForDesigner?.name || "Unassigned"}</p></div><div><p className="text-xs text-slate-500">Added by</p><p className="mt-1">{review.createdBy?.name || "—"}</p></div><div><p className="text-xs text-slate-500">Marketing permission</p><p className="mt-1">{titleCase(review.marketingPermission)}</p></div><div><p className="text-xs text-slate-500">Related order</p><button className="mt-1 text-blue-300 hover:underline" onClick={() => onOpenOrder(review.orderId)}>{review.orderNumber || `Order #${review.orderId}`}</button></div></section>
    <ReviewProgress review={review} />
    {review.publicReviewLink && <a href={review.publicReviewLink} target="_blank" rel="noreferrer" className="block rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-blue-300 underline">Open public review link</a>}
    {review.screenshotUrl && <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="mb-3 text-xs uppercase tracking-wider text-slate-500">Evidence</p><a href={review.screenshotUrl} target="_blank" rel="noreferrer"><img src={review.screenshotUrl} alt="Review evidence" className="max-h-64 w-full rounded-lg bg-slate-950 object-contain" /></a></section>}
  </div>}</SheetContent></Sheet>;
}

function SuggestionDetails({ suggestion, open, onOpenChange, onOpenOrder, onUpdated }: { suggestion: Suggestion | null; open: boolean; onOpenChange: (open: boolean) => void; onOpenOrder: (id: number) => void; onUpdated: (suggestion: Suggestion) => void }) {
  const { user } = useAuth(); const { toast } = useToast();
  const [pendingDecision, setPendingDecision] = useState<"implemented" | "rejected" | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const update = useMutation({
    mutationFn: async ({ status, note }: { status: "implemented" | "rejected"; note: string }) => (await apiRequest("PATCH", `/api/feedback/suggestions/${suggestion?.id}`, { status, confirmDecision: true, decisionNote: note || null })).json(),
    onSuccess: (updated: Suggestion) => { onUpdated(updated); queryClient.invalidateQueries({ queryKey: ["/api/feedback"] }); queryClient.invalidateQueries({ queryKey: ["/api/feedback/stats"] }); setPendingDecision(null); setDecisionNote(""); toast({ title: "Suggestion status updated" }); },
    onError: (error: Error) => toast({ title: "Could not update suggestion", description: errorText(error), variant: "destructive" }),
  });
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full overflow-y-auto border-slate-800 bg-slate-950 text-white sm:max-w-xl"><SheetHeader><SheetTitle>{suggestion?.suggestionNumber || "Suggestion Details"}</SheetTitle></SheetHeader>{suggestion && <div className="mt-6 space-y-5">
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-slate-500">Suggestion</p><p className="mt-2 text-lg font-medium">{suggestion.clientName}</p><p className="mt-1 text-sm text-slate-500">{suggestion.orderNumber || `Order #${suggestion.orderId}`} · {suggestion.createdAt ? format(new Date(suggestion.createdAt), "MMM dd, yyyy h:mm a") : "—"}</p></div><Badge className="bg-blue-500/10 text-blue-300">{suggestionStatusLabels[suggestion.status]}</Badge></div><div className="mt-5 flex items-center gap-2 text-xs text-slate-400"><Badge variant="outline" className="border-slate-700">{titleCase(suggestion.category)}</Badge><span>Designer: {suggestion.relatedDesigner?.name || "Unassigned"}</span></div><p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{suggestion.suggestionText}</p></section>
    <section className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm"><div><p className="text-xs text-slate-500">Added by</p><p className="mt-1">{suggestion.createdBy?.name || "—"}</p></div><div><p className="text-xs text-slate-500">Related order</p><button className="mt-1 text-blue-300 hover:underline" onClick={() => onOpenOrder(suggestion.orderId)}>{suggestion.orderNumber || `Order #${suggestion.orderId}`}</button></div><div><p className="text-xs text-slate-500">Reviewed by</p><p className="mt-1">{suggestion.reviewedBy?.name || "Not reviewed"}</p></div><div className="col-span-2"><p className="text-xs text-slate-500">Admin notes</p><p className="mt-1 whitespace-pre-wrap text-slate-300">{suggestion.adminNotes || "—"}</p></div></section>
    {suggestion.decisionNote && <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-xs uppercase tracking-wider text-slate-500">{suggestion.status === "rejected" ? "Reason for Rejection" : "Implementation Note"}</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{suggestion.decisionNote}</p></section>}
    {user?.role === "admin" && suggestion.status === "new" && <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-xs uppercase tracking-wider text-slate-500">Decision</p><div className="mt-3 grid grid-cols-2 gap-2"><Button disabled={update.isPending} onClick={() => setPendingDecision("implemented")}>Implement Suggestion</Button><Button variant="outline" disabled={update.isPending} onClick={() => setPendingDecision("rejected")}>Reject Suggestion</Button></div><p className="mt-2 text-xs text-slate-500">A final decision is recorded and cannot be reversed in the normal CRM workflow.</p></section>}
    {suggestion.screenshotUrl && <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="mb-3 text-xs uppercase tracking-wider text-slate-500">Evidence</p><a href={suggestion.screenshotUrl} target="_blank" rel="noreferrer"><img src={suggestion.screenshotUrl} alt="Suggestion evidence" className="max-h-64 w-full rounded-lg bg-slate-950 object-contain" /></a></section>}
  </div>}<Dialog open={pendingDecision !== null} onOpenChange={v => !v && setPendingDecision(null)}><DialogContent className="border-slate-800 bg-slate-900 text-white"><DialogHeader><DialogTitle>{pendingDecision === "rejected" ? "Reject Suggestion" : "Implement Suggestion"}</DialogTitle></DialogHeader><p className="text-sm text-slate-400">{pendingDecision === "rejected" ? "Confirm that this suggestion will not be implemented." : "Confirm that this suggestion has been adopted and implemented."}</p><div className="space-y-2"><Label>{pendingDecision === "rejected" ? "Reason for Rejection *" : "Implementation Note (optional)"}</Label><Textarea value={decisionNote} onChange={e => setDecisionNote(e.target.value)} /></div><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setPendingDecision(null)}>Cancel</Button><Button disabled={update.isPending || (pendingDecision === "rejected" && !decisionNote.trim())} onClick={() => pendingDecision && update.mutate({ status: pendingDecision, note: decisionNote.trim() })}>{pendingDecision === "rejected" ? "Reject Suggestion" : "Mark Implemented"}</Button></div></DialogContent></Dialog></SheetContent></Sheet>;
}

export default function FeedbackPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const now = new Date();
  const [tab, setTab] = useState<"reviews" | "suggestions">("reviews");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [designerId, setDesignerId] = useState("all");
  const [suggestionStatus, setSuggestionStatus] = useState("all");
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [suggestionDialogOpen, setSuggestionDialogOpen] = useState(false);
  const [editingReview, setEditingReview] = useState<Review | null>(null);
  const [selectedReview, setSelectedReview] = useState<Review | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState<Suggestion | null>(null);
  const linkParams = new URLSearchParams(window.location.search);
  const linkedOrderId = Number(linkParams.get("order")) || null;
  const linkedAction = linkParams.get("action");
  const linkedReviewNumber = linkParams.get("review");
  const linkedSuggestionNumber = linkParams.get("suggestion");
  const requestedTab = linkParams.get("tab");
  const [deepLinkMessage, setDeepLinkMessage] = useState<string | null>(null);
  useEffect(() => {
    if (requestedTab === "reviews" || requestedTab === "suggestions") setTab(requestedTab);
    if (!linkedOrderId) return;
    if (linkedAction === "suggestion") {
      setTab("suggestions");
      setSuggestionDialogOpen(true);
    } else if (linkedAction === "review") {
      setTab("reviews");
      setReviewDialogOpen(true);
    }
  }, [linkedAction, linkedOrderId, requestedTab]);
  const effectiveSearch = search || (tab === "reviews" ? linkedReviewNumber || "" : linkedSuggestionNumber || "");
  const hasRecordDeepLink = Boolean(linkedReviewNumber || linkedSuggestionNumber);
  const params = new URLSearchParams({ ...(!hasRecordDeepLink ? { month, year } : {}), ...(effectiveSearch ? { search: effectiveSearch } : {}), ...(designerId !== "all" ? { designerId } : {}), ...(suggestionStatus !== "all" && tab === "suggestions" ? { status: suggestionStatus } : {}) }).toString();
  const { data: reviews = [], isLoading: reviewsLoading } = useQuery<Review[]>({ queryKey: [`/api/feedback/reviews?${params}`], enabled: tab === "reviews" });
  const { data: suggestions = [], isLoading: suggestionsLoading } = useQuery<Suggestion[]>({ queryKey: [`/api/feedback/suggestions?${params}`], enabled: tab === "suggestions" });
  const { data: stats } = useQuery<FeedbackStats>({ queryKey: [`/api/feedback/stats?month=${month}&year=${year}${designerId !== "all" ? `&designerId=${designerId}` : ""}`] });
  const { data: orders = [] } = useQuery<OrderWithServices[]>({ queryKey: ["/api/orders"] });
  const { data: teamMembers = [] } = useQuery<User[]>({ queryKey: ["/api/users"], staleTime: 300000 });
  const isAdmin = user?.role === "admin";
  const designers = teamMembers.filter(member => member.role === "designer");
  const displayReviews = useMemo(() => reviews, [reviews]);
  const displaySuggestions = useMemo(() => suggestions, [suggestions]);
  const isLoading = tab === "reviews" ? reviewsLoading : suggestionsLoading;
  const openReview = (review: Review) => setSelectedReview(review);
  const openOrder = (orderId: number) => {
    const order = orders.find(item => item.id === orderId);
    setLocation(`/orders?order=${encodeURIComponent(order?.orderNumber || String(orderId))}`);
  };
  useEffect(() => {
    if (!linkedReviewNumber || tab !== "reviews" || reviewsLoading) return;
    const review = reviews.find(item => item.reviewNumber === linkedReviewNumber);
    if (review) { setSelectedReview(review); setDeepLinkMessage(null); }
    else setDeepLinkMessage(`Review ${linkedReviewNumber} was not found, or you do not have permission to view it.`);
  }, [linkedReviewNumber, reviews, reviewsLoading, tab]);
  useEffect(() => {
    if (!linkedSuggestionNumber || tab !== "suggestions" || suggestionsLoading) return;
    const suggestion = suggestions.find(item => item.suggestionNumber === linkedSuggestionNumber);
    if (suggestion) { setSelectedSuggestion(suggestion); setDeepLinkMessage(null); }
    else setDeepLinkMessage(`Suggestion ${linkedSuggestionNumber} was not found, or you do not have permission to view it.`);
  }, [linkedSuggestionNumber, suggestions, suggestionsLoading, tab]);
  const resetFilters = () => { setSearch(""); setDesignerId("all"); setSuggestionStatus("all"); setMonth(String(now.getMonth() + 1)); setYear(String(now.getFullYear())); };
  const updateSuggestionStatus = useMutation({
    mutationFn: async ({ suggestion, status }: { suggestion: Suggestion; status: Suggestion["status"] }) => (await apiRequest("PATCH", `/api/feedback/suggestions/${suggestion.id}`, { status, confirmDecision: true })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/feedback"] }); queryClient.invalidateQueries({ queryKey: ["/api/feedback/stats"] }); toast({ title: "Suggestion status updated" }); },
    onError: (error: Error) => toast({ title: "Could not update suggestion", description: errorText(error), variant: "destructive" }),
  });
  const nextStatuses = (status: Suggestion["status"]): Suggestion["status"][] => status === "new" ? ["implemented", "rejected"] : [];
  const reportMonth = format(new Date(Number(year), Number(month) - 1, 1), "MMMM yyyy");
  return <div className="space-y-4 p-4 md:space-y-8 md:p-8">
    <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
      <div className="max-w-md">
        <h1 className="text-2xl font-bold leading-tight text-white md:text-3xl">Client Feedback</h1>
        <p className="mt-2 text-slate-400">Review order-linked client feedback for {reportMonth}.</p>
      </div>
      <div className="flex w-full flex-col gap-3 xl:w-auto xl:min-w-[680px]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 sm:min-w-[280px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search feedback, order, client, or designer..." className="h-10 border-slate-800 bg-slate-900 pl-10 text-white" />
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" onClick={() => { setEditingReview(null); setReviewDialogOpen(true); }}><Plus className="mr-2 h-4 w-4" />New Review</Button>
            <Button onClick={() => setSuggestionDialogOpen(true)} className="bg-primary"><Plus className="mr-2 h-4 w-4" />New Suggestion</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="mr-1 hidden h-4 w-4 text-slate-500 md:block" aria-hidden="true" />
          <FeedbackFilters designers={designers} showDesignerFilter={isAdmin || user?.role === "support"} value={designerId} onChange={setDesignerId} status={tab === "suggestions" ? suggestionStatus : undefined} onStatusChange={setSuggestionStatus} />
          {((tab === "suggestions" && suggestionStatus !== "all") || designerId !== "all" || search) && <Button variant="ghost" size="sm" onClick={resetFilters} className="text-slate-400 hover:text-white"><X className="mr-1 h-4 w-4" />Clear</Button>}
        </div>
      </div>
    </div>
    {deepLinkMessage && <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100"><span>{deepLinkMessage}</span><Button variant="ghost" size="sm" onClick={() => { setDeepLinkMessage(null); setLocation(`/feedback?tab=${tab}`); }}>Clear link</Button></div>}
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
      {tab === "reviews" ? <><MetricCard title="All Reviews" value={stats?.reviews.all ?? 0} icon={ClipboardList} testId="stat-feedback-reviews-all" /><MetricCard title="Average Rating" value={stats?.reviews.averageRating == null ? "—" : `${stats.reviews.averageRating.toFixed(1)}/5`} icon={Star} color="orange" testId="stat-feedback-average-rating" /><MetricCard title="WhatsApp Feedback" value={stats?.reviews.whatsapp ?? 0} icon={MessageSquare} color="green" /><MetricCard title="Facebook Reviews" value={stats?.reviews.facebook ?? 0} icon={Facebook} color="purple" /><MetricCard title="Video Reviews" value={stats?.reviews.video ?? 0} icon={Video} color="red" /></> : <><MetricCard title="All Suggestions" value={stats?.suggestions.all ?? 0} icon={ClipboardList} /><MetricCard title="New" value={stats?.suggestions.new ?? 0} icon={AlertTriangle} color="orange" /><MetricCard title="Implemented" value={stats?.suggestions.implemented ?? 0} icon={ThumbsUp} color="blue" /><MetricCard title="Rejected" value={stats?.suggestions.rejected ?? 0} icon={X} color="red" /></>}
    </div>
    <Tabs value={tab} onValueChange={value => setTab(value as "reviews" | "suggestions")}><TabsList className="w-full justify-start border border-slate-800 bg-slate-900 p-1 sm:w-fit"><TabsTrigger value="reviews" className="gap-2 px-5 data-[state=active]:bg-primary data-[state=active]:text-white"><Star className="h-4 w-4" />Reviews</TabsTrigger><TabsTrigger value="suggestions" className="gap-2 px-5 data-[state=active]:bg-primary data-[state=active]:text-white"><ThumbsUp className="h-4 w-4" />Suggestions</TabsTrigger></TabsList>
      <TabsContent value="reviews" className="mt-6 space-y-6"><FeedbackResultsHeader title="Reviews" count={displayReviews.length} month={reportMonth} year={year} setYear={setYear} monthValue={month} setMonth={setMonth} /><div className="glass-panel overflow-hidden rounded-2xl border border-slate-800"><div className="overflow-x-auto"><Table><TableHeader className="bg-slate-900/50"><TableRow className="border-slate-800 hover:bg-transparent"><TableHead className="whitespace-nowrap text-slate-400">Review ID</TableHead><TableHead className="text-slate-400">Date</TableHead><TableHead className="text-slate-400">Client</TableHead><TableHead className="text-slate-400">Designer</TableHead><TableHead className="text-slate-400">Order ID</TableHead><TableHead className="text-slate-400">Rating</TableHead><TableHead className="text-slate-400">Channels</TableHead><TableHead className="text-right text-slate-400">Actions</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <TableRow><TableCell colSpan={8} className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-400" /></TableCell></TableRow> : displayReviews.length ? displayReviews.map(review => <TableRow key={review.id} className="border-slate-800 hover:bg-slate-900/50"><TableCell><button className="font-mono text-xs text-blue-400 hover:underline" onClick={() => openReview(review)}>{review.reviewNumber}</button></TableCell><TableCell className="whitespace-nowrap text-xs text-slate-400">{review.createdAt ? format(new Date(review.createdAt), "MMM dd, yyyy") : "—"}</TableCell><TableCell className="text-sm font-medium text-white">{review.clientName}</TableCell><TableCell className="text-sm text-slate-300">{review.reviewForDesigner?.name || "Unassigned"}</TableCell><TableCell><button className="font-mono text-xs text-blue-400 hover:underline" onClick={() => openOrder(review.orderId)}>{review.orderNumber || `#${review.orderId}`}</button></TableCell><TableCell className="text-amber-400">{review.rating ? <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-current" />{review.rating}/5</span> : <span className="text-slate-500">Not Rated</span>}</TableCell><TableCell><ChannelBadges review={review} /></TableCell><TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="border-slate-800 bg-slate-900"><DropdownMenuItem onClick={() => openReview(review)}>View Details</DropdownMenuItem><DropdownMenuItem onClick={() => { setEditingReview(review); setReviewDialogOpen(true); }}>Update Review</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="py-16 text-center text-slate-500"><Star className="mx-auto mb-3 h-8 w-8 text-slate-700" />No reviews found for this period.</TableCell></TableRow>}</TableBody></Table></div></div></TabsContent>
      <TabsContent value="suggestions" className="mt-6 space-y-6"><FeedbackResultsHeader title="Suggestions" count={displaySuggestions.length} month={reportMonth} year={year} setYear={setYear} monthValue={month} setMonth={setMonth} /><div className="glass-panel overflow-hidden rounded-2xl border border-slate-800"><div className="overflow-x-auto"><Table><TableHeader className="bg-slate-900/50"><TableRow className="border-slate-800 hover:bg-transparent"><TableHead className="whitespace-nowrap text-slate-400">Suggestion ID</TableHead><TableHead className="text-slate-400">Date</TableHead><TableHead className="text-slate-400">Client</TableHead><TableHead className="text-slate-400">Designer</TableHead><TableHead className="text-slate-400">Order ID</TableHead><TableHead className="text-slate-400">Category</TableHead><TableHead className="text-slate-400">Status</TableHead><TableHead className="text-right text-slate-400">Actions</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <TableRow><TableCell colSpan={8} className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-400" /></TableCell></TableRow> : displaySuggestions.length ? displaySuggestions.map(suggestion => <TableRow key={suggestion.id} className="border-slate-800 hover:bg-slate-900/50"><TableCell><button className="font-mono text-xs text-blue-400 hover:underline" onClick={() => setSelectedSuggestion(suggestion)}>{suggestion.suggestionNumber}</button></TableCell><TableCell className="whitespace-nowrap text-xs text-slate-400">{suggestion.createdAt ? format(new Date(suggestion.createdAt), "MMM dd, yyyy") : "—"}</TableCell><TableCell className="text-sm font-medium text-white">{suggestion.clientName}</TableCell><TableCell className="text-sm text-slate-300">{suggestion.relatedDesigner?.name || "Unassigned"}</TableCell><TableCell><button className="font-mono text-xs text-blue-400 hover:underline" onClick={() => openOrder(suggestion.orderId)}>{suggestion.orderNumber || `#${suggestion.orderId}`}</button></TableCell><TableCell><Badge variant="outline" className="border-slate-700 text-slate-300">{titleCase(suggestion.category)}</Badge></TableCell><TableCell><Badge className="bg-blue-500/10 text-blue-300">{suggestionStatusLabels[suggestion.status]}</Badge></TableCell><TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="border-slate-800 bg-slate-900"><DropdownMenuItem onClick={() => setSelectedSuggestion(suggestion)}>View Details</DropdownMenuItem>{isAdmin && nextStatuses(suggestion.status).map(status => <DropdownMenuItem key={status} disabled={updateSuggestionStatus.isPending} onClick={() => updateSuggestionStatus.mutate({ suggestion, status: status as Suggestion["status"] })}>Mark {suggestionStatusLabels[status as Suggestion["status"]]}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="py-16 text-center text-slate-500"><ThumbsUp className="mx-auto mb-3 h-8 w-8 text-slate-700" />No suggestions found for this period.</TableCell></TableRow>}</TableBody></Table></div></div></TabsContent>
    </Tabs>
    <ReviewDetails review={selectedReview} open={Boolean(selectedReview)} onOpenChange={open => !open && setSelectedReview(null)} onEdit={() => { setEditingReview(selectedReview); setSelectedReview(null); setReviewDialogOpen(true); }} onOpenOrder={openOrder} />
    <SuggestionDetails suggestion={selectedSuggestion} open={Boolean(selectedSuggestion)} onOpenChange={open => !open && setSelectedSuggestion(null)} onOpenOrder={openOrder} onUpdated={setSelectedSuggestion} />
    <ReviewForm review={editingReview} orders={orders} open={reviewDialogOpen} onOpenChange={open => { setReviewDialogOpen(open); if (!open) setEditingReview(null); }} defaultOrderId={linkedOrderId} />
    <SuggestionForm orders={orders} open={suggestionDialogOpen} onOpenChange={setSuggestionDialogOpen} defaultOrderId={linkedOrderId} />
  </div>;
}

function FeedbackFilters({ designers, showDesignerFilter, value, onChange, status, onStatusChange }: { designers: User[]; showDesignerFilter: boolean; value: string; onChange: (value: string) => void; status?: string; onStatusChange?: (value: string) => void }) {
  return <div className="flex flex-wrap items-center gap-2">{showDesignerFilter && <Select value={value} onValueChange={onChange}><SelectTrigger className="w-40 border-slate-800 bg-slate-900 text-white"><SelectValue placeholder="All designers" /></SelectTrigger><SelectContent className="border-slate-800 bg-slate-900 text-white"><SelectItem value="all">All designers</SelectItem>{designers.map(designer => <SelectItem key={designer.id} value={String(designer.id)}>{designer.name}</SelectItem>)}</SelectContent></Select>}{status !== undefined && onStatusChange && <Select value={status} onValueChange={onStatusChange}><SelectTrigger className="w-40 border-slate-800 bg-slate-900 text-white"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent className="border-slate-800 bg-slate-900 text-white"><SelectItem value="all">All statuses</SelectItem>{Object.entries(suggestionStatusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>}</div>;
}

function FeedbackResultsHeader({ title, count, month, year, setYear, monthValue, setMonth }: { title: string; count: number; month: string; year: string; setYear: (value: string) => void; monthValue: string; setMonth: (value: string) => void }) {
  const now = new Date();
  return <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-800 p-6 sm:flex-row sm:items-center">
    <div><h3 className="text-lg font-bold text-white">{title}</h3><p className="text-sm text-slate-500">{count} {title.toLowerCase().replace(/s$/, "")}{count === 1 ? "" : "s"} for {month}</p></div>
    <div className="flex flex-wrap gap-2">
      <Select value={year} onValueChange={setYear}><SelectTrigger className="w-24 border-slate-800 bg-slate-900 text-white"><SelectValue /></SelectTrigger><SelectContent className="border-slate-800 bg-slate-900 text-white">{[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(value => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select>
      <Select value={monthValue} onValueChange={setMonth}><SelectTrigger className="w-36 border-slate-800 bg-slate-900 text-white"><SelectValue /></SelectTrigger><SelectContent className="border-slate-800 bg-slate-900 text-white">{Array.from({ length: 12 }, (_, index) => <SelectItem key={index + 1} value={String(index + 1)}>{format(new Date(2024, index, 1), "MMMM")}</SelectItem>)}</SelectContent></Select>
    </div>
  </div>;
}