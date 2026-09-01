import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Facebook,
  FileImage,
  Filter,
  Loader2,
  MessageSquare,
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { OrderWithServices, User } from "@shared/schema";

export type Review = {
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
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  order?: { packageType?: string | null; services?: OrderWithServices["services"]; paymentStatus?: string | null; status?: string | null };
};

type Suggestion = {
  id: number;
  suggestionNumber: string;
  orderId: number;
  orderNumber: string | null;
  clientName: string;
  relatedDesigner?: User | null;
  createdBy?: User | null;
  suggestionText: string;
  status: "new" | "implemented" | "rejected";
  screenshotUrl?: string | null;
  adminNotes?: string | null;
  decisionNote?: string | null;
  adminNotesLog?: Array<{ id: number; noteText: string; createdAt: string | Date | null; createdBy?: Pick<User, "id" | "name" | "role"> | null }>;
  implementationDetails?: string | null;
  implementationScreenshotUrl?: string | null;
  implementedBy?: User | null;
  implementedAt?: string | Date | null;
  rejectionReason?: string | null;
  rejectedBy?: User | null;
  rejectedAt?: string | Date | null;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  order?: { packageType?: string | null; services?: OrderWithServices["services"]; status?: string | null };
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

const suggestionStatusLabels: Record<Suggestion["status"], string> = {
  new: "New",
  implemented: "Implemented",
  rejected: "Rejected",
};

const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
const packageLabels: Record<string, string> = {
  ats_career: "ATS Career Package",
  international_career_pro: "International Career Pro",
  executive_career_branding: "Executive Career Branding",
  starter: "Starter",
  professional: "Professional",
  executive: "Executive",
  custom: "Custom Order",
};
const errorText = (error: Error) => error.message.match(/"message":"([^"]+)"/)?.[1] || "The request could not be completed.";
const marketingPermissionLabel = (value?: string | null) => value === "yes" ? "Permission Granted" : value === "no" ? "Permission Not Granted" : "Not Asked";

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

export function ReviewForm({ review, orders, open, onOpenChange, defaultOrderId }: { review?: Review | null; orders: OrderWithServices[]; open: boolean; onOpenChange: (open: boolean) => void; defaultOrderId?: number | null }) {
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
      <ScreenshotField value={screenshotUrl} onChange={setScreenshotUrl} folder="reviews" />
      <Button className="w-full bg-blue-600 hover:bg-blue-500" disabled={!orderId || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{review ? "Save Review" : "Add Review"}</Button>
    </div>
  </DialogContent></Dialog>;
}

function SuggestionForm({ orders, open, onOpenChange, defaultOrderId }: { orders: OrderWithServices[]; open: boolean; onOpenChange: (open: boolean) => void; defaultOrderId?: number | null }) {
  const { toast } = useToast();
  const [orderId, setOrderId] = useState(defaultOrderId ? String(defaultOrderId) : "");
  const [suggestionText, setSuggestionText] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const selectedOrder = orders.find(order => String(order.id) === orderId);
  const mutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/feedback/suggestions", { orderId: Number(orderId), suggestionText: suggestionText.trim(), screenshotUrl: screenshotUrl || null })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feedback/stats"] });
      toast({ title: "Suggestion added" });
      onOpenChange(false);
      setOrderId(""); setSuggestionText(""); setScreenshotUrl("");
    },
    onError: (error: Error) => toast({ title: "Could not add suggestion", description: errorText(error), variant: "destructive" }),
  });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-900 text-white sm:max-w-xl"><DialogHeader><DialogTitle>New Suggestion</DialogTitle></DialogHeader>
    <div className="space-y-4">
      <div className="space-y-2"><Label>Order</Label><Select value={orderId} onValueChange={setOrderId}><SelectTrigger><SelectValue placeholder="Select an order" /></SelectTrigger><SelectContent>{orders.map(order => <SelectItem key={order.id} value={String(order.id)}>{order.orderNumber || `Order #${order.id}`} · {order.clientName}</SelectItem>)}</SelectContent></Select>{selectedOrder && <p className="text-xs text-slate-500">Designer: {selectedOrder.assignee?.name || "Unassigned"} · Client: {selectedOrder.clientName}</p>}</div>
      <div className="space-y-2"><Label htmlFor="suggestion-text">Suggestion</Label><Textarea id="suggestion-text" required value={suggestionText} onChange={event => setSuggestionText(event.target.value)} rows={6} placeholder="What could improve the client experience?" /></div>
      <ScreenshotField value={screenshotUrl} onChange={setScreenshotUrl} folder="suggestions" />
      <Button className="w-full bg-blue-600 hover:bg-blue-500" disabled={!orderId || !suggestionText.trim() || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add Suggestion</Button>
    </div>
  </DialogContent></Dialog>;
}

export function ReviewDetails({ review, open, onOpenChange, onEdit, onOpenOrder, onBack }: { review: Review | null; open: boolean; onOpenChange: (open: boolean) => void; onEdit: () => void; onOpenOrder: (id: number) => void; onBack?: () => void }) {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const channels = [
    ["WhatsApp Feedback", review?.whatsappFeedbackReceived],
    ["Facebook Review", review?.facebookReviewReceived],
    ["Video Testimonial", review?.videoReviewReceived],
  ] as const;
  return <Sheet open={open} onOpenChange={value => { if (!value) setImagePreview(null); onOpenChange(value); }}><SheetContent className="w-full overflow-y-auto border-slate-800 bg-slate-950 text-white sm:max-w-xl">
    <SheetHeader className="border-b border-slate-800 pb-5 pr-8 text-left">
      <SheetTitle className="flex items-center justify-between gap-3"><div className="flex items-center gap-2">{onBack && <Button variant="ghost" size="icon" className="-ml-2 h-8 w-8" onClick={onBack} aria-label="Back to order"><ArrowLeft className="h-4 w-4" /></Button>}<div><span className="font-mono text-xl text-blue-300">{review?.reviewNumber || "Review Details"}</span><p className="mt-1 text-xs font-normal uppercase tracking-[0.16em] text-slate-500">Client Review</p></div></div>{review && <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="mr-2 h-3.5 w-3.5" />Update</Button>}</SheetTitle>
    </SheetHeader>
    {review && <div className="mt-6 space-y-5">
      <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-lg shadow-black/10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Review Summary</p>
        <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-5">
          <div className="col-span-2"><dt className="text-xs text-slate-500">Client</dt><dd className="mt-1 text-xl font-semibold text-white">{review.clientName || "—"}</dd></div>
          <div><dt className="text-xs text-slate-500">Rating</dt><dd className="mt-1 text-2xl font-bold text-amber-400">{review.rating ? <span className="inline-flex items-center gap-1"><Star className="h-5 w-5 fill-current" />{review.rating}/5</span> : "Not Rated"}</dd></div>
          <div><dt className="text-xs text-slate-500">Designer</dt><dd className="mt-1 text-sm font-medium text-white">{review.reviewForDesigner?.name || "Unassigned"}</dd></div>
          <div><dt className="text-xs text-slate-500">Date Recorded</dt><dd className="mt-1 text-sm text-slate-300">{review.createdAt ? format(new Date(review.createdAt), "MMM dd, yyyy · h:mm a") : "—"}</dd></div>
        </dl>
      </section>

      <section className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">Client Feedback</p>
        <blockquote className="mt-4 whitespace-pre-wrap break-words text-[17px] leading-8 text-slate-100">{review.feedbackText || "No written feedback recorded."}</blockquote>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Feedback Sources</p>
        <div className="mt-4 space-y-2">{channels.map(([label, received]) => <div key={label} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-3 text-sm"><span className="text-slate-300">{label}</span><Badge variant="outline" className={received ? "border-emerald-500/30 text-emerald-300" : "border-slate-700 text-slate-500"}>{received ? "Received" : "Not Received"}</Badge></div>)}</div>
        {review.facebookReviewReceived && review.publicReviewLink && <a href={review.publicReviewLink} target="_blank" rel="noreferrer" className="mt-4 block rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-sm text-blue-300 hover:underline">Public Review Link · Open Review</a>}
      </section>

      <section className="border-b border-slate-800 pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Review Evidence</p>
        {review.screenshotUrl ? <div className="mt-4 space-y-3"><button type="button" onClick={() => setImagePreview(review.screenshotUrl!)} className="block w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900"><img src={review.screenshotUrl} alt="Review evidence" className="max-h-56 w-full object-contain" /></button><Button variant="ghost" size="sm" className="px-0 text-blue-300 hover:text-blue-200" onClick={() => setImagePreview(review.screenshotUrl!)}>View Full Image</Button></div> : <p className="mt-3 text-sm text-slate-500">No review evidence attached.</p>}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Related Order</p>
        <button className="mt-3 block font-mono text-sm font-medium text-blue-300 hover:underline" onClick={() => onOpenOrder(review.orderId)}>{review.orderNumber || `Order #${review.orderId}`}</button>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-xs text-slate-500">Client</dt><dd className="mt-1 text-slate-300">{review.clientName || "—"}</dd></div><div><dt className="text-xs text-slate-500">Designer</dt><dd className="mt-1 text-slate-300">{review.reviewForDesigner?.name || "Unassigned"}</dd></div>{review.order?.packageType && <div className="col-span-2"><dt className="text-xs text-slate-500">Package</dt><dd className="mt-1 text-slate-300">{packageLabels[review.order.packageType] || titleCase(review.order.packageType)}</dd></div>}{review.order?.services?.length ? <div className="col-span-2"><dt className="text-xs text-slate-500">Services / Add-ons</dt><dd className="mt-1 text-slate-300">{review.order.services.map(service => `${service.serviceType} ×${service.quantity || 1}`).join(", ")}</dd></div> : null}{review.order?.status && <div><dt className="text-xs text-slate-500">Order Status</dt><dd className="mt-1 text-slate-300">{titleCase(review.order.status)}</dd></div>}</dl>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Record Details</p>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-xs text-slate-500">Recorded By</dt><dd className="mt-1 text-slate-300">{review.createdBy?.name || "—"}</dd></div><div><dt className="text-xs text-slate-500">Marketing Permission</dt><dd className="mt-1 text-slate-300">{marketingPermissionLabel(review.marketingPermission)}</dd></div><div><dt className="text-xs text-slate-500">Recorded On</dt><dd className="mt-1 text-slate-300">{review.createdAt ? format(new Date(review.createdAt), "MMM dd, yyyy · h:mm a") : "—"}</dd></div>{review.updatedAt && review.createdAt && new Date(review.updatedAt).getTime() > new Date(review.createdAt).getTime() + 1000 && <div><dt className="text-xs text-slate-500">Last Updated</dt><dd className="mt-1 text-slate-300">{format(new Date(review.updatedAt), "MMM dd, yyyy · h:mm a")}</dd></div>}</dl>
      </section>
    </div>}
    <Dialog open={Boolean(imagePreview)} onOpenChange={value => !value && setImagePreview(null)}><DialogContent className="max-w-4xl border-slate-800 bg-slate-950"><DialogTitle className="sr-only">Review evidence preview</DialogTitle>{imagePreview && <img src={imagePreview} alt="Full review evidence preview" className="max-h-[80vh] w-full object-contain" />}</DialogContent></Dialog>
  </SheetContent></Sheet>;
}

export function SuggestionDetails({ suggestion, open, onOpenChange, onOpenOrder, onUpdated, onBack }: { suggestion: Suggestion | null; open: boolean; onOpenChange: (open: boolean) => void; onOpenOrder: (id: number) => void; onUpdated: (suggestion: Suggestion) => void; onBack?: () => void }) {
  const { user } = useAuth(); const { toast } = useToast();
  const [pendingDecision, setPendingDecision] = useState<"implemented" | "rejected" | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [implementationEvidence, setImplementationEvidence] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const { data: orderActivity = [] } = useQuery<any[]>({ queryKey: [`/api/orders/${suggestion?.orderId}/activity`], enabled: open && Boolean(suggestion?.orderId) });
  const history = orderActivity.filter(entry => Number((entry.details || {}).suggestionId) === suggestion?.id);
  const update = useMutation({
    mutationFn: async ({ status, note }: { status: "implemented" | "rejected"; note: string }) => (await apiRequest("PATCH", `/api/feedback/suggestions/${suggestion?.id}`, { status, confirmDecision: true, ...(status === "implemented" ? { implementationDetails: note, implementationScreenshotUrl: implementationEvidence || null } : { rejectionReason: note }) })).json(),
    onSuccess: (updated: Suggestion) => { onUpdated(updated); queryClient.invalidateQueries({ queryKey: ["/api/feedback"] }); queryClient.invalidateQueries({ queryKey: ["/api/feedback/stats"] }); queryClient.invalidateQueries({ queryKey: [`/api/orders/${suggestion?.orderId}/activity`] }); setPendingDecision(null); setDecisionNote(""); setImplementationEvidence(""); toast({ title: updated.status === "implemented" ? "Suggestion implemented" : "Suggestion rejected" }); },
    onError: (error: Error) => toast({ title: "Could not update suggestion", description: errorText(error), variant: "destructive" }),
  });
  const updateNotes = useMutation({
    mutationFn: async (note: string) => (await apiRequest("PATCH", `/api/feedback/suggestions/${suggestion?.id}`, { adminNote: note.trim() })).json(),
    onSuccess: (updated: Suggestion) => { onUpdated(updated); setAdminNote(""); queryClient.invalidateQueries({ queryKey: ["/api/feedback"] }); queryClient.invalidateQueries({ queryKey: [`/api/orders/${suggestion?.orderId}/activity`] }); toast({ title: "Admin note added" }); },
    onError: (error: Error) => toast({ title: "Could not add Admin Note", description: errorText(error), variant: "destructive" }),
  });
  const helper = suggestion?.status === "implemented" ? "Suggestion approved and implemented." : suggestion?.status === "rejected" ? "Suggestion reviewed and not implemented." : "Awaiting management decision.";
  const historyLabel = (entry: any) => entry.activityType === "suggestion_created" ? "Suggestion recorded" : entry.activityType === "suggestion_status" && entry.newValue === "implemented" ? "Suggestion implemented" : entry.activityType === "suggestion_status" && entry.newValue === "rejected" ? "Suggestion rejected" : "Admin note added";
 return <Sheet open={open} onOpenChange={value => { if (!value) { setImagePreview(null); setPendingDecision(null); } onOpenChange(value); }}><SheetContent className="w-full overflow-y-auto border-slate-800 bg-slate-950 text-white sm:max-w-xl"><SheetHeader className="border-b border-slate-800 pb-5 pr-8 text-left"><SheetTitle className="flex items-center justify-between gap-3"><div className="flex items-center gap-2">{onBack && <Button variant="ghost" size="icon" className="-ml-2 h-8 w-8" onClick={onBack} aria-label="Back to order"><ArrowLeft className="h-4 w-4" /></Button>}<span className="font-mono text-xl text-blue-300">{suggestion?.suggestionNumber || "Suggestion Details"}</span></div>{suggestion && <Badge className={suggestion.status === "implemented" ? "bg-emerald-500/15 text-emerald-300" : suggestion.status === "rejected" ? "bg-rose-500/15 text-rose-300" : "bg-blue-500/15 text-blue-300"}>{suggestionStatusLabels[suggestion.status]}</Badge>}</SheetTitle><p className="text-sm text-slate-400">{helper}</p></SheetHeader>{suggestion && <div className="mt-6 space-y-5">
    <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Suggestion Summary</p><dl className="mt-4 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-xs text-slate-500">Related Designer</dt><dd className="mt-1 text-white">{suggestion.relatedDesigner?.name || "Unassigned"}</dd></div><div><dt className="text-xs text-slate-500">Date Recorded</dt><dd className="mt-1 text-slate-300">{suggestion.createdAt ? format(new Date(suggestion.createdAt), "MMM dd, yyyy · h:mm a") : "—"}</dd></div><div><dt className="text-xs text-slate-500">Recorded By</dt><dd className="mt-1 text-slate-300">{suggestion.createdBy?.name || "—"}</dd></div></dl></section>
    <section className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">Client Suggestion</p><blockquote className="mt-4 whitespace-pre-wrap break-words text-[17px] leading-8 text-slate-100">{suggestion.suggestionText}</blockquote></section>
    <section className="border-b border-slate-800 pb-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Suggestion Evidence</p>{suggestion.screenshotUrl ? <button type="button" onClick={() => setImagePreview(suggestion.screenshotUrl!)} className="mt-4 block w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900"><img src={suggestion.screenshotUrl} alt="Suggestion evidence" className="max-h-56 w-full object-contain" /></button> : <p className="mt-3 text-sm text-slate-500">No evidence was attached to this suggestion.</p>}</section>
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Related Order</p><button className="mt-3 font-mono text-sm text-blue-300 hover:underline" onClick={() => onOpenOrder(suggestion.orderId)}>{suggestion.orderNumber || `Order #${suggestion.orderId}`}</button><dl className="mt-4 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-xs text-slate-500">Client</dt><dd className="mt-1">{suggestion.clientName}</dd></div><div><dt className="text-xs text-slate-500">Designer</dt><dd className="mt-1">{suggestion.relatedDesigner?.name || "Unassigned"}</dd></div>{suggestion.order?.packageType && <div className="col-span-2"><dt className="text-xs text-slate-500">Package</dt><dd className="mt-1">{packageLabels[suggestion.order.packageType] || titleCase(suggestion.order.packageType)}</dd></div>}{suggestion.order?.services?.length ? <div className="col-span-2"><dt className="text-xs text-slate-500">Services / Add-ons</dt><dd className="mt-1">{suggestion.order.services.map(service => `${service.serviceType} ×${service.quantity || 1}`).join(", ")}</dd></div> : null}{suggestion.order?.status && <div><dt className="text-xs text-slate-500">Order Status</dt><dd className="mt-1">{titleCase(suggestion.order.status)}</dd></div>}</dl></section>
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Management Decision</p>{suggestion.status === "new" ? <><p className="mt-2 text-sm text-slate-400">Decide whether this suggestion should be implemented or rejected.</p>{user?.role === "admin" && <div className="mt-4 grid grid-cols-2 gap-2"><Button onClick={() => setPendingDecision("implemented")}>Implement Suggestion</Button><Button variant="outline" onClick={() => setPendingDecision("rejected")}>Reject Suggestion</Button></div>}</> : suggestion.status === "implemented" ? <div className="mt-4 space-y-4"><Badge className="bg-emerald-500/15 text-emerald-300">Implemented</Badge><div><p className="text-xs text-slate-500">Implementation Summary</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{suggestion.implementationDetails || suggestion.decisionNote || "—"}</p></div><div className="grid grid-cols-2 gap-4 text-sm"><div><p className="text-xs text-slate-500">Implemented By</p><p className="mt-1">{suggestion.implementedBy?.name || "—"}</p></div><div><p className="text-xs text-slate-500">Implemented On</p><p className="mt-1">{suggestion.implementedAt ? format(new Date(suggestion.implementedAt), "MMM dd, yyyy · h:mm a") : "—"}</p></div></div>{suggestion.implementationScreenshotUrl && <button onClick={() => setImagePreview(suggestion.implementationScreenshotUrl!)} className="text-sm text-blue-300 hover:underline">View Implementation Evidence</button>}<p className="text-xs text-slate-500">This suggestion was adopted and implemented.</p></div> : <div className="mt-4 space-y-4"><Badge className="bg-rose-500/15 text-rose-300">Rejected</Badge><div><p className="text-xs text-slate-500">Reason for Rejection</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{suggestion.rejectionReason || suggestion.decisionNote || "—"}</p></div><div className="grid grid-cols-2 gap-4 text-sm"><div><p className="text-xs text-slate-500">Rejected By</p><p className="mt-1">{suggestion.rejectedBy?.name || "—"}</p></div><div><p className="text-xs text-slate-500">Rejected On</p><p className="mt-1">{suggestion.rejectedAt ? format(new Date(suggestion.rejectedAt), "MMM dd, yyyy · h:mm a") : "—"}</p></div></div><p className="text-xs text-slate-500">This suggestion will not be implemented.</p></div>}</section>
    {user?.role === "admin" && <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Internal Admin Notes</p><p className="mt-2 text-xs text-slate-500">Private management notes. These notes are not visible to Designers or Support.</p><div className="mt-4 space-y-3">{suggestion.adminNotesLog?.length ? suggestion.adminNotesLog.map(note => <div key={note.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3"><p className="whitespace-pre-wrap text-sm text-slate-200">{note.noteText}</p><p className="mt-2 text-xs text-slate-500">{note.createdBy?.name || "Admin"} · {note.createdAt ? format(new Date(note.createdAt), "MMM dd, yyyy · h:mm a") : "—"}</p></div>) : <p className="text-sm text-slate-500">No internal notes recorded.</p>}</div><div className="mt-5 space-y-2 border-t border-slate-800 pt-4"><Label>Add New Note</Label><Textarea value={adminNote} onChange={event => setAdminNote(event.target.value)} placeholder="Write an internal note..." rows={3} /><Button variant="outline" disabled={!adminNote.trim() || updateNotes.isPending} onClick={() => updateNotes.mutate(adminNote)}>{updateNotes.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add Note</Button></div></section>}
    <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Suggestion History</p><div className="mt-4 space-y-0">{history.length ? history.map((entry, index) => <div key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">{index < history.length - 1 && <span className="absolute left-[5px] top-3 h-full w-px bg-slate-800" />}<span className="relative mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-blue-400 bg-slate-950" /><div><p className="text-sm font-medium text-slate-200">{historyLabel(entry)}</p><p className="mt-1 text-xs text-slate-500">{entry.actor?.name || "System"} · {entry.createdAt ? format(new Date(entry.createdAt), "MMM dd, yyyy · h:mm a") : "—"}</p>{entry.activityType === "suggestion_status" && entry.newValue === "rejected" && entry.details?.rejectionReason && <p className="mt-2 text-sm text-slate-400">Reason: “{entry.details.rejectionReason}”</p>}{entry.activityType === "suggestion_status" && entry.newValue === "implemented" && entry.details?.implementationDetails && <p className="mt-2 text-sm text-slate-400">Implementation: “{entry.details.implementationDetails}”</p>}</div></div>) : <p className="text-sm text-slate-500">No history recorded.</p>}</div></section>
  </div>}<Dialog open={pendingDecision !== null} onOpenChange={v => !v && setPendingDecision(null)}><DialogContent className="border-slate-800 bg-slate-900 text-white"><DialogHeader><DialogTitle>{pendingDecision === "rejected" ? "Reject Suggestion" : "Implement Suggestion"}</DialogTitle></DialogHeader><p className="text-sm text-slate-400">{pendingDecision === "rejected" ? "Please explain why this suggestion will not be implemented." : "Confirm that this suggestion has been adopted and implemented."}</p><div className="space-y-2"><Label>{pendingDecision === "rejected" ? "Reason for Rejection" : "Implementation Details"}</Label><Textarea value={decisionNote} onChange={e => setDecisionNote(e.target.value)} rows={4} /></div>{pendingDecision === "implemented" && <ScreenshotField value={implementationEvidence} onChange={setImplementationEvidence} folder="suggestions" />}<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setPendingDecision(null)}>Cancel</Button><Button disabled={update.isPending || !decisionNote.trim()} onClick={() => pendingDecision && update.mutate({ status: pendingDecision, note: decisionNote.trim() })}>{pendingDecision === "rejected" ? "Reject Suggestion" : "Mark Implemented"}</Button></div></DialogContent></Dialog><Dialog open={Boolean(imagePreview)} onOpenChange={v => !v && setImagePreview(null)}><DialogContent className="max-w-4xl border-slate-800 bg-slate-950"><DialogTitle className="sr-only">Suggestion evidence preview</DialogTitle>{imagePreview && <img src={imagePreview} alt="Suggestion evidence preview" className="max-h-[80vh] w-full object-contain" />}</DialogContent></Dialog></SheetContent></Sheet>;
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
     <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${tab === "reviews" ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
      {tab === "reviews" ? <><MetricCard title="All Reviews" value={stats?.reviews.all ?? 0} icon={ClipboardList} testId="stat-feedback-reviews-all" /><MetricCard title="Average Rating" value={stats?.reviews.averageRating == null ? "—" : `${stats.reviews.averageRating.toFixed(1)}/5`} icon={Star} color="orange" testId="stat-feedback-average-rating" /><MetricCard title="WhatsApp Feedback" value={stats?.reviews.whatsapp ?? 0} icon={MessageSquare} color="green" /><MetricCard title="Facebook Reviews" value={stats?.reviews.facebook ?? 0} icon={Facebook} color="purple" /><MetricCard title="Video Reviews" value={stats?.reviews.video ?? 0} icon={Video} color="red" /></> : <><MetricCard title="All Suggestions" value={stats?.suggestions.all ?? 0} icon={ClipboardList} /><MetricCard title="New" value={stats?.suggestions.new ?? 0} icon={AlertTriangle} color="orange" /><MetricCard title="Implemented" value={stats?.suggestions.implemented ?? 0} icon={ThumbsUp} color="blue" /><MetricCard title="Rejected" value={stats?.suggestions.rejected ?? 0} icon={X} color="red" /></>}
    </div>
     <Tabs value={tab} onValueChange={value => setTab(value as "reviews" | "suggestions")}><TabsList className="w-full justify-start border border-slate-800 bg-slate-900 p-1 sm:w-fit"><TabsTrigger value="reviews" className="gap-2 px-5 data-[state=active]:bg-primary data-[state=active]:text-white"><Star className="h-4 w-4" />Reviews</TabsTrigger><TabsTrigger value="suggestions" className="gap-2 px-5 data-[state=active]:bg-primary data-[state=active]:text-white"><ThumbsUp className="h-4 w-4" />Suggestions</TabsTrigger></TabsList>
       <TabsContent value="reviews" className="mt-6 space-y-6"><FeedbackResultsHeader title="Reviews" count={displayReviews.length} month={reportMonth} year={year} setYear={setYear} monthValue={month} setMonth={setMonth} /><div className="glass-panel overflow-hidden rounded-2xl border border-slate-800"><div className="overflow-x-auto"><Table><TableHeader className="bg-slate-900/50"><TableRow className="border-slate-800 hover:bg-transparent"><TableHead className="whitespace-nowrap text-slate-400">Review ID</TableHead><TableHead className="text-slate-400">Date</TableHead><TableHead className="text-slate-400">Client</TableHead><TableHead className="text-slate-400">Designer</TableHead><TableHead className="text-slate-400">Order ID</TableHead><TableHead className="text-slate-400">Rating</TableHead><TableHead className="text-slate-400">Channels</TableHead><TableHead className="text-right text-slate-400">Details</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <TableRow><TableCell colSpan={8} className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-400" /></TableCell></TableRow> : displayReviews.length ? displayReviews.map(review => <TableRow key={review.id} className="cursor-pointer border-slate-800 hover:bg-slate-900/50" onClick={() => openReview(review)}><TableCell><button className="font-mono text-xs text-blue-400 hover:underline" onClick={event => { event.stopPropagation(); openReview(review); }}>{review.reviewNumber}</button></TableCell><TableCell className="whitespace-nowrap text-xs text-slate-400">{review.createdAt ? format(new Date(review.createdAt), "MMM dd, yyyy") : "—"}</TableCell><TableCell className="text-sm font-medium text-white">{review.clientName}</TableCell><TableCell className="text-sm text-slate-300">{review.reviewForDesigner?.name || "Unassigned"}</TableCell><TableCell><button className="font-mono text-xs text-blue-400 hover:underline" onClick={event => { event.stopPropagation(); openOrder(review.orderId); }}>{review.orderNumber || `#${review.orderId}`}</button></TableCell><TableCell className="text-amber-400">{review.rating ? <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-current" />{review.rating}/5</span> : <span className="text-slate-500">Not Rated</span>}</TableCell><TableCell><ChannelBadges review={review} /></TableCell><TableCell className="text-right"><Button variant="outline" size="sm" onClick={event => { event.stopPropagation(); openReview(review); }}>View Details</Button></TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="py-16 text-center text-slate-500"><Star className="mx-auto mb-3 h-8 w-8 text-slate-700" />No reviews found for this period.</TableCell></TableRow>}</TableBody></Table></div></div></TabsContent>
       <TabsContent value="suggestions" className="mt-6 space-y-6"><FeedbackResultsHeader title="Suggestions" count={displaySuggestions.length} month={reportMonth} year={year} setYear={setYear} monthValue={month} setMonth={setMonth} /><div className="glass-panel overflow-hidden rounded-2xl border border-slate-800"><div className="overflow-x-auto"><Table><TableHeader className="bg-slate-900/50"><TableRow className="border-slate-800 hover:bg-transparent"><TableHead className="whitespace-nowrap text-slate-400">Suggestion ID</TableHead><TableHead className="text-slate-400">Date</TableHead><TableHead className="text-slate-400">Client</TableHead><TableHead className="text-slate-400">Designer</TableHead><TableHead className="text-slate-400">Order ID</TableHead><TableHead className="text-slate-400">Status</TableHead><TableHead className="text-right text-slate-400">Details</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <TableRow><TableCell colSpan={7} className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-400" /></TableCell></TableRow> : displaySuggestions.length ? displaySuggestions.map(suggestion => <TableRow key={suggestion.id} className="cursor-pointer border-slate-800 hover:bg-slate-900/50" onClick={() => setSelectedSuggestion(suggestion)}><TableCell><button className="font-mono text-xs text-blue-400 hover:underline" onClick={event => { event.stopPropagation(); setSelectedSuggestion(suggestion); }}>{suggestion.suggestionNumber}</button></TableCell><TableCell className="whitespace-nowrap text-xs text-slate-400">{suggestion.createdAt ? format(new Date(suggestion.createdAt), "MMM dd, yyyy") : "—"}</TableCell><TableCell className="text-sm font-medium text-white">{suggestion.clientName}</TableCell><TableCell className="text-sm text-slate-300">{suggestion.relatedDesigner?.name || "Unassigned"}</TableCell><TableCell><button className="font-mono text-xs text-blue-400 hover:underline" onClick={event => { event.stopPropagation(); openOrder(suggestion.orderId); }}>{suggestion.orderNumber || `#${suggestion.orderId}`}</button></TableCell><TableCell><Badge className="bg-blue-500/10 text-blue-300">{suggestionStatusLabels[suggestion.status]}</Badge></TableCell><TableCell className="text-right"><Button variant="outline" size="sm" onClick={event => { event.stopPropagation(); setSelectedSuggestion(suggestion); }}>View Details</Button></TableCell></TableRow>) : <TableRow><TableCell colSpan={7} className="py-16 text-center text-slate-500"><ThumbsUp className="mx-auto mb-3 h-8 w-8 text-slate-700" />No suggestions found for this period.</TableCell></TableRow>}</TableBody></Table></div></div></TabsContent>
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