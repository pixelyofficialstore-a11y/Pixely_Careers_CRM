import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Facebook,
  FileImage,
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
  status: "new" | "under_review" | "accepted" | "implemented" | "rejected";
  screenshotUrl?: string | null;
  adminNotes?: string | null;
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
    underReview: number;
    accepted: number;
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
  under_review: "Under Review",
  accepted: "Accepted",
  implemented: "Implemented",
  rejected: "Rejected",
};

const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
const errorText = (error: Error) => error.message.match(/"message":"([^"]+)"/)?.[1] || "The request could not be completed.";

function MetricCard({ title, value, icon: Icon, color = "blue", testId }: { title: string; value: string | number; icon: typeof Star; color?: string; testId?: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-500/10 text-blue-400",
    green: "bg-emerald-500/10 text-emerald-400",
    purple: "bg-violet-500/10 text-violet-400",
    orange: "bg-amber-500/10 text-amber-400",
    red: "bg-rose-500/10 text-rose-400",
  };
  return (
    <div className="glass-panel rounded-2xl p-5" data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <div className={`rounded-xl p-3 ${colors[color] || colors.blue}`}><Icon className="h-5 w-5" /></div>
        <p className="text-2xl font-bold font-display text-white">{value}</p>
      </div>
      <p className="mt-4 text-sm font-medium text-slate-400">{title}</p>
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

function ReviewDetails({ review, open, onOpenChange, onEdit }: { review: Review | null; open: boolean; onOpenChange: (open: boolean) => void; onEdit: () => void }) {
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full overflow-y-auto border-slate-800 bg-slate-950 text-white sm:max-w-xl"><SheetHeader><SheetTitle className="flex items-center justify-between gap-3 pr-6"><span>{review?.reviewNumber || "Review Details"}</span>{review && <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="mr-2 h-3.5 w-3.5" />Update</Button>}</SheetTitle></SheetHeader>{review && <div className="mt-6 space-y-5">
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-slate-500">Client feedback</p><p className="mt-2 text-lg font-medium">{review.clientName}</p><p className="mt-1 text-sm text-slate-500">{review.orderNumber || `Order #${review.orderId}`} · {review.createdAt ? format(new Date(review.createdAt), "MMM dd, yyyy h:mm a") : "—"}</p></div><div className="text-right"><p className="text-xs text-slate-500">Rating</p><p className="mt-1 text-2xl font-bold text-amber-400">{review.rating ? `${review.rating}/5` : "Not Rated"}</p></div></div><p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{review.feedbackText || "No written feedback recorded."}</p></section>
    <section className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm"><div><p className="text-xs text-slate-500">Designer</p><p className="mt-1">{review.reviewForDesigner?.name || "Unassigned"}</p></div><div><p className="text-xs text-slate-500">Added by</p><p className="mt-1">{review.createdBy?.name || "—"}</p></div><div><p className="text-xs text-slate-500">Marketing permission</p><p className="mt-1">{titleCase(review.marketingPermission)}</p></div><div><p className="text-xs text-slate-500">Channels</p><div className="mt-1"><ChannelBadges review={review} /></div></div></section>
    {review.publicReviewLink && <a href={review.publicReviewLink} target="_blank" rel="noreferrer" className="block rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-blue-300 underline">Open public review link</a>}
    {review.screenshotUrl && <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="mb-3 text-xs uppercase tracking-wider text-slate-500">Evidence</p><a href={review.screenshotUrl} target="_blank" rel="noreferrer"><img src={review.screenshotUrl} alt="Review evidence" className="max-h-64 w-full rounded-lg bg-slate-950 object-contain" /></a></section>}
  </div>}</SheetContent></Sheet>;
}

function SuggestionDetails({ suggestion, open, onOpenChange }: { suggestion: Suggestion | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full overflow-y-auto border-slate-800 bg-slate-950 text-white sm:max-w-xl"><SheetHeader><SheetTitle>{suggestion?.suggestionNumber || "Suggestion Details"}</SheetTitle></SheetHeader>{suggestion && <div className="mt-6 space-y-5">
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-slate-500">Suggestion</p><p className="mt-2 text-lg font-medium">{suggestion.clientName}</p><p className="mt-1 text-sm text-slate-500">{suggestion.orderNumber || `Order #${suggestion.orderId}`} · {suggestion.createdAt ? format(new Date(suggestion.createdAt), "MMM dd, yyyy h:mm a") : "—"}</p></div><Badge className="bg-blue-500/10 text-blue-300">{suggestionStatusLabels[suggestion.status]}</Badge></div><div className="mt-5 flex items-center gap-2 text-xs text-slate-400"><Badge variant="outline" className="border-slate-700">{titleCase(suggestion.category)}</Badge><span>Designer: {suggestion.relatedDesigner?.name || "Unassigned"}</span></div><p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{suggestion.suggestionText}</p></section>
    <section className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm"><div><p className="text-xs text-slate-500">Added by</p><p className="mt-1">{suggestion.createdBy?.name || "—"}</p></div><div><p className="text-xs text-slate-500">Reviewed by</p><p className="mt-1">{suggestion.reviewedBy?.name || "Not reviewed"}</p></div><div className="col-span-2"><p className="text-xs text-slate-500">Admin notes</p><p className="mt-1 whitespace-pre-wrap text-slate-300">{suggestion.adminNotes || "—"}</p></div></section>
    {suggestion.screenshotUrl && <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="mb-3 text-xs uppercase tracking-wider text-slate-500">Evidence</p><a href={suggestion.screenshotUrl} target="_blank" rel="noreferrer"><img src={suggestion.screenshotUrl} alt="Suggestion evidence" className="max-h-64 w-full rounded-lg bg-slate-950 object-contain" /></a></section>}
  </div>}</SheetContent></Sheet>;
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
  const linkedOrderId = Number(new URLSearchParams(window.location.search).get("order")) || null;
  const linkedAction = new URLSearchParams(window.location.search).get("action");
  useEffect(() => {
    if (!linkedOrderId) return;
    if (linkedAction === "suggestion") {
      setTab("suggestions");
      setSuggestionDialogOpen(true);
    } else if (linkedAction === "review") {
      setTab("reviews");
      setReviewDialogOpen(true);
    }
  }, [linkedAction, linkedOrderId]);
  const params = new URLSearchParams({ month, year, ...(search ? { search } : {}), ...(designerId !== "all" ? { designerId } : {}), ...(suggestionStatus !== "all" && tab === "suggestions" ? { status: suggestionStatus } : {}) }).toString();
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
  const openOrder = (orderId: number) => setLocation(`/orders?order=${orderId}`);
  const resetFilters = () => { setSearch(""); setDesignerId("all"); setSuggestionStatus("all"); setMonth(String(now.getMonth() + 1)); setYear(String(now.getFullYear())); };
  const updateSuggestionStatus = useMutation({
    mutationFn: async ({ suggestion, status }: { suggestion: Suggestion; status: Suggestion["status"] }) => (await apiRequest("PATCH", `/api/feedback/suggestions/${suggestion.id}`, { status })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/feedback"] }); queryClient.invalidateQueries({ queryKey: ["/api/feedback/stats"] }); toast({ title: "Suggestion status updated" }); },
    onError: (error: Error) => toast({ title: "Could not update suggestion", description: errorText(error), variant: "destructive" }),
  });
  const nextStatuses = (status: Suggestion["status"]) => status === "new" ? ["under_review"] : status === "under_review" ? ["accepted", "rejected"] : status === "accepted" ? ["implemented"] : [];
  return <div className="space-y-8 p-4 sm:p-8">
    <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><p className="mb-2 text-sm font-medium uppercase tracking-wider text-blue-400">Client experience</p><h1 className="text-3xl font-bold font-display text-white">Client Feedback</h1><p className="mt-2 text-slate-400">Track client reviews, testimonials and improvement suggestions.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setEditingReview(null); setReviewDialogOpen(true); }}><Plus className="mr-2 h-4 w-4" />New Review</Button><Button onClick={() => setSuggestionDialogOpen(true)} className="bg-blue-600 hover:bg-blue-500"><Plus className="mr-2 h-4 w-4" />New Suggestion</Button></div></div>
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search feedback, order, client, or designer…" className="h-10 border-slate-800 bg-slate-950 pl-9" /></div><div className="grid grid-cols-2 gap-2 sm:flex"><Select value={year} onValueChange={setYear}><SelectTrigger className="w-full sm:w-32"><SelectValue /></SelectTrigger><SelectContent>{[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map(value => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select><Select value={month} onValueChange={setMonth}><SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 12 }, (_, index) => <SelectItem key={index + 1} value={String(index + 1)}>{format(new Date(2024, index, 1), "MMMM")}</SelectItem>)}</SelectContent></Select>{(search || designerId !== "all" || suggestionStatus !== "all") && <Button variant="ghost" onClick={resetFilters} className="text-slate-400"><X className="mr-2 h-4 w-4" />Clear</Button>}</div></div>
    <Tabs value={tab} onValueChange={value => setTab(value as "reviews" | "suggestions")}><TabsList className="w-full justify-start rounded-xl border border-slate-800 bg-slate-950 p-1 sm:w-fit"><TabsTrigger value="reviews" className="gap-2 px-5 data-[state=active]:bg-blue-600 data-[state=active]:text-white"><Star className="h-4 w-4" />Reviews</TabsTrigger><TabsTrigger value="suggestions" className="gap-2 px-5 data-[state=active]:bg-blue-600 data-[state=active]:text-white"><ThumbsUp className="h-4 w-4" />Suggestions</TabsTrigger></TabsList>
      <TabsContent value="reviews" className="mt-6 space-y-6"><div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><MetricCard title="All Reviews" value={stats?.reviews.all ?? 0} icon={ClipboardList} testId="stat-feedback-reviews-all" /><MetricCard title="Average Rating" value={stats?.reviews.averageRating == null ? "—" : `${stats.reviews.averageRating.toFixed(1)}/5`} icon={Star} color="orange" testId="stat-feedback-average-rating" /><MetricCard title="WhatsApp Feedback" value={stats?.reviews.whatsapp ?? 0} icon={MessageSquare} color="green" /><MetricCard title="Facebook Reviews" value={stats?.reviews.facebook ?? 0} icon={Facebook} color="purple" /><MetricCard title="Video Reviews" value={stats?.reviews.video ?? 0} icon={Video} color="red" /></div><FeedbackFilters designers={designers} value={designerId} onChange={setDesignerId} /><div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950"><div className="overflow-x-auto"><Table><TableHeader><TableRow className="border-slate-800 hover:bg-transparent"><TableHead>Review ID</TableHead><TableHead>Date</TableHead><TableHead>Client</TableHead><TableHead>Designer</TableHead><TableHead>Order ID</TableHead><TableHead>Rating</TableHead><TableHead>Channels</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <TableRow><TableCell colSpan={8} className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-400" /></TableCell></TableRow> : displayReviews.length ? displayReviews.map(review => <TableRow key={review.id} className="border-slate-800"><TableCell className="font-mono text-xs text-blue-400">{review.reviewNumber}</TableCell><TableCell className="whitespace-nowrap text-slate-400">{review.createdAt ? format(new Date(review.createdAt), "MMM dd, yyyy") : "—"}</TableCell><TableCell className="font-medium text-white">{review.clientName}</TableCell><TableCell className="text-slate-300">{review.reviewForDesigner?.name || "Unassigned"}</TableCell><TableCell><button className="font-mono text-xs text-blue-400 hover:underline" onClick={() => openOrder(review.orderId)}>{review.orderNumber || `#${review.orderId}`}</button></TableCell><TableCell className="text-amber-400">{review.rating ? <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-current" />{review.rating}/5</span> : <span className="text-slate-500">Not Rated</span>}</TableCell><TableCell><ChannelBadges review={review} /></TableCell><TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => openReview(review)}>View Details</DropdownMenuItem><DropdownMenuItem onClick={() => { setEditingReview(review); setReviewDialogOpen(true); }}>Update Review</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="py-16 text-center text-slate-500"><Star className="mx-auto mb-3 h-8 w-8 text-slate-700" />No reviews found for this period.</TableCell></TableRow>}</TableBody></Table></div></div></TabsContent>
      <TabsContent value="suggestions" className="mt-6 space-y-6"><div className="grid grid-cols-2 gap-3 md:grid-cols-5"><MetricCard title="All Suggestions" value={stats?.suggestions.all ?? 0} icon={ClipboardList} /><MetricCard title="New" value={stats?.suggestions.new ?? 0} icon={AlertTriangle} color="orange" /><MetricCard title="Under Review" value={stats?.suggestions.underReview ?? 0} icon={Loader2} color="purple" /><MetricCard title="Accepted" value={stats?.suggestions.accepted ?? 0} icon={CheckCircle2} color="green" /><MetricCard title="Implemented" value={stats?.suggestions.implemented ?? 0} icon={ThumbsUp} color="blue" /></div><FeedbackFilters designers={designers} value={designerId} onChange={setDesignerId} /><div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950"><div className="overflow-x-auto"><Table><TableHeader><TableRow className="border-slate-800 hover:bg-transparent"><TableHead>Suggestion ID</TableHead><TableHead>Date</TableHead><TableHead>Client</TableHead><TableHead>Designer</TableHead><TableHead>Order ID</TableHead><TableHead>Category</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <TableRow><TableCell colSpan={8} className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-400" /></TableCell></TableRow> : displaySuggestions.length ? displaySuggestions.map(suggestion => <TableRow key={suggestion.id} className="border-slate-800"><TableCell className="font-mono text-xs text-blue-400">{suggestion.suggestionNumber}</TableCell><TableCell className="whitespace-nowrap text-slate-400">{suggestion.createdAt ? format(new Date(suggestion.createdAt), "MMM dd, yyyy") : "—"}</TableCell><TableCell className="font-medium text-white">{suggestion.clientName}</TableCell><TableCell className="text-slate-300">{suggestion.relatedDesigner?.name || "Unassigned"}</TableCell><TableCell><button className="font-mono text-xs text-blue-400 hover:underline" onClick={() => openOrder(suggestion.orderId)}>{suggestion.orderNumber || `#${suggestion.orderId}`}</button></TableCell><TableCell><Badge variant="outline" className="border-slate-700 text-slate-300">{titleCase(suggestion.category)}</Badge></TableCell><TableCell><Badge className="bg-blue-500/10 text-blue-300">{suggestionStatusLabels[suggestion.status]}</Badge></TableCell><TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setSelectedSuggestion(suggestion)}>View Details</DropdownMenuItem>{isAdmin && nextStatuses(suggestion.status).map(status => <DropdownMenuItem key={status} disabled={updateSuggestionStatus.isPending} onClick={() => updateSuggestionStatus.mutate({ suggestion, status: status as Suggestion["status"] })}>Mark {suggestionStatusLabels[status as Suggestion["status"]]}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="py-16 text-center text-slate-500"><ThumbsUp className="mx-auto mb-3 h-8 w-8 text-slate-700" />No suggestions found for this period.</TableCell></TableRow>}</TableBody></Table></div></div></TabsContent>
    </Tabs>
    <ReviewDetails review={selectedReview} open={Boolean(selectedReview)} onOpenChange={open => !open && setSelectedReview(null)} onEdit={() => { setEditingReview(selectedReview); setSelectedReview(null); setReviewDialogOpen(true); }} />
    <SuggestionDetails suggestion={selectedSuggestion} open={Boolean(selectedSuggestion)} onOpenChange={open => !open && setSelectedSuggestion(null)} />
    <ReviewForm review={editingReview} orders={orders} open={reviewDialogOpen} onOpenChange={open => { setReviewDialogOpen(open); if (!open) setEditingReview(null); }} defaultOrderId={linkedOrderId} />
    <SuggestionForm orders={orders} open={suggestionDialogOpen} onOpenChange={setSuggestionDialogOpen} defaultOrderId={linkedOrderId} />
  </div>;
}

function FeedbackFilters({ designers, value, onChange }: { designers: User[]; value: string; onChange: (value: string) => void }) {
  return <div className="flex flex-wrap items-center gap-3"><span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Filter</span><Select value={value} onValueChange={onChange}><SelectTrigger className="w-52"><SelectValue placeholder="All designers" /></SelectTrigger><SelectContent><SelectItem value="all">All designers</SelectItem>{designers.map(designer => <SelectItem key={designer.id} value={String(designer.id)}>{designer.name}</SelectItem>)}</SelectContent></Select></div>;
}