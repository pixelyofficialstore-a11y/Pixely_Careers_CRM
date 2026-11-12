import { useState, useRef, useEffect, useMemo } from "react";
import { recordExport } from "@/lib/http";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { fetchOrderPage, fetchOrderByRef, fetchOrderById, orderListKey, patchOrderInCaches, snapshotOrderCaches, restoreOrderCaches, toQueryString, type OrderListParams } from "@/lib/orders";
import { Link, useLocation, useSearch } from "wouter";
import { OrdersSkeleton } from "@/components/PageSkeleton";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { format, isToday, isPast, startOfMonth, addDays, addMonths, differenceInCalendarDays } from "date-fns";
import { 
  Search, 
  Loader2,
  Eye, 
  UserPlus, 
  Clock,
  AlertCircle,
  TrendingUp,
  Package,
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  X,
  XCircle,
  MoreVertical,
  Copy,
  Check,
  FileText,
  History,
  Download,
  Filter,
  Pencil,
  FileWarning,
  MessageSquareHeart,
  Lightbulb,
  ArrowLeft,
  Send,
  Globe,
  ExternalLink,
  Link2,
  Bookmark
} from "lucide-react";
import { ImageDropzone } from "@/components/ImageDropzone";
import { WhatsAppQuickReply } from "@/components/WhatsAppQuickReply";
import { rupees } from "@/lib/chart-colors";
import { pkPhoneKey } from "@shared/phone";
import { deliveryDaysFor } from "@shared/order-process";
// jsPDF is ~400 KB; load it only when a PDF is actually generated.
const loadPdf = async () => {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  return { jsPDF, autoTable };
};
const ORDERS_PAGE_SIZE = 50;
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiRequest, queryClient, getErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { OrderWithServices, User, SupportDesignerAssignment, ServiceCatalogItem, PackageConfig, PlatformCatalogItem, PaymentVerification, ComplaintResponse, ComplaintHistoryEntry, ActivityLogWithActor, ClientReview, ClientSuggestion, CatalogItem } from "@shared/schema";
import { ComplaintDialog } from "@/components/ComplaintDialog";
import { AdvancePaymentStatusBadge, ComplaintStatusBadge, OrderStatusBadge, PaymentLineStatusBadge, SuggestionStatusBadge, WorkStatusBadge, PaymentStateBadge } from "@/components/StatusBadge";
import { OrderRefunds } from "@/components/OrderRefunds";
import { processOf, WORK_STATUS_LABELS, PAYMENT_STATE_LABELS, type DisplayWorkStatus, type OrderProcess } from "@shared/order-process";
import { ComplaintDetails } from "@/pages/ComplaintsPage";
import { ReviewForm, ReviewDetails, SuggestionDetails, type Review } from "@/pages/FeedbackPage";
import { getOrderAccounting } from "@shared/order-accounting";
import { MetricCard as CRMMetricCard, PageHeader } from "@/components/CRMPrimitives";

const FALLBACK_SERVICE_TYPES = [
  "ATS CV",
  "Additional CV",
  "Cover Letter",
  "LinkedIn Optimization",
  "Indeed Optimization",
  "Naukri Gulf Optimization",
  "Bio Statement",
  "Digital Contact Card",
];

const FALLBACK_PACKAGE_LABELS: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  executive: "Executive",
  ats_career: "ATS Career Package",
  international_career_pro: "International Career Pro",
  executive_career_branding: "Executive Career Branding",
  custom: "Custom Order",
};

// Phase 2 work-status filters (server maps them to the old status values).
const ORDER_STATUS_FILTERS: Array<{ value: string; label: string; statuses: string[] }> = [
  { value: "pending", label: "Confirmed", statuses: ["new"] },
  { value: "working", label: "In progress", statuses: ["working"] },
  { value: "ready", label: "Draft sent / Revisions", statuses: ["ready"] },
  { value: "delivered", label: "Delivered / Closed", statuses: ["delivered"] },
  { value: "overdue", label: "Overdue", statuses: [] },
  { value: "canceled", label: "Canceled", statuses: ["canceled"] },
];

type OrderRow = OrderWithServices & { process?: OrderProcess };
const dueLabel = (p: OrderProcess) => p.dueAt ? format(new Date(p.dueAt), "MMM dd") : null;

const orderActivityLabel = (entry: ActivityLogWithActor) => {
  const details = (entry.details || {}) as Record<string, unknown>;
  switch (entry.activityType) {
    case "order_created": return "Order created";
    case "assignment": return entry.previousValue ? "Designer reassigned" : "Designer assigned";
    case "status_change": return `Order status updated to ${typeof details.workStatus === "string" && details.workStatus in WORK_STATUS_LABELS ? WORK_STATUS_LABELS[details.workStatus as DisplayWorkStatus] : reportStatus(entry.newValue)}${details.payLater ? " (pay later approved)" : ""}`;
    case "payment_change": return `${String(entry.newValue || "").startsWith("refund_") ? "" : "Payment "}${reportStatus(entry.newValue || "updated").toLowerCase()}`.replace(/^r/, "R");
    case "complaint_created": return `Complaint ${String(details.complaintNumber || "").trim()} filed`.replace("  ", " ");
    case "complaint_status": return `Complaint ${reportStatus(entry.newValue).toLowerCase()}`;
    case "complaint_resolved": return entry.newValue === "refunded" ? "Complaint refunded and Order canceled" : "Complaint resolved";
    case "review_created": return `Client Review ${String(details.reviewNumber || entry.newValue || "").trim()} recorded`.replace("  ", " ");
    case "review_updated": return details.channelReceived ? `${titleCase(String(details.channelReceived))} feedback received` : "Client Review updated";
    case "suggestion_created": return `Suggestion ${String(details.suggestionNumber || entry.newValue || "").trim()} recorded`.replace("  ", " ");
    case "suggestion_status": return `Suggestion ${String(details.suggestionNumber || "").trim()} ${reportStatus(entry.newValue).toLowerCase()}`.replace("  ", " ");
    default: return titleCase(entry.activityType);
  }
};

const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());

const reportDate = (value: unknown) => {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : format(date, "MMM dd, yyyy · h:mm a");
};

const reportMoney = (value: unknown) => `Rs${Math.round(Number(value || 0) / 100).toLocaleString()}`;

const reportStatus = (value: unknown) => {
  const status = String(value || "");
  const labels: Record<string, string> = {
    pending_payment: "Request",
    new: "Confirmed",
    working: "In progress",
    ready: "Draft sent",
    delivered: "Delivered",
    request: "Request",
    in_progress: "In progress",
    draft_sent: "Draft sent",
    revisions: "Revisions",
    closed: "Closed",
    refund_requested: "Refund requested",
    refund_approved: "Refund approved",
    refund_rejected: "Refund rejected",
    refund_paid: "Refund paid",
    canceled: "Canceled",
    confirmed: "Confirmed",
    dismissed: "Dismissed",
    resolved: "Resolved",
    refunded: "Refunded",
    implemented: "Implemented",
    rejected: "Rejected",
    pending_confirmation: "Pending Confirmation",
    approved: "Approved",
    disapproved: "Disapproved",
    correction_revision: "Correction / Revision",
  };
  return labels[status] || titleCase(status);
};

const reportPerson = (value: unknown) => {
  if (!value || typeof value !== "object") return "";
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" ? name : "";
};

const reportActivityCopy = (entry: Record<string, any>, orderNumber: string) => {
  const details = entry.details && typeof entry.details === "object" ? entry.details as Record<string, unknown> : {};
  const actor = reportPerson(entry.actor) || "System";
  const complaint = String(details.complaintNumber || "the related Complaint");
  const review = String(details.reviewNumber || entry.newValue || "the Client Review");
  const suggestion = String(details.suggestionNumber || entry.newValue || "the Suggestion");
  switch (entry.activityType) {
    case "order_created": return { title: "Order created", description: `${actor} created Order ${orderNumber}.` };
    case "assignment": return { title: entry.previousValue ? "Designer reassigned" : "Designer assigned", description: entry.previousValue ? `${actor} changed the assigned Designer.` : `${actor} assigned a Designer to the Order.` };
    case "status_change": return { title: "Order status updated", description: `${actor} changed the Order status to ${reportStatus(entry.newValue)}.` };
    case "payment_change": return { title: `Payment ${reportStatus(entry.newValue).toLowerCase()}`, description: `${actor} recorded a ${reportStatus(details.paymentType).toLowerCase()} payment update${details.amount ? ` for ${reportMoney(details.amount)}` : ""}.` };
    case "complaint_created": return { title: "Complaint filed", description: `${complaint} was recorded${actor !== "System" ? ` by ${actor}` : ""}.` };
    case "complaint_status": return { title: `Complaint ${reportStatus(entry.newValue).toLowerCase()}`, description: `${actor} marked ${complaint} as ${reportStatus(entry.newValue)}.` };
    case "complaint_resolved": return { title: entry.newValue === "refunded" ? "Complaint refunded and Order canceled" : "Complaint resolved", description: `${actor} marked ${complaint} as ${reportStatus(entry.newValue)}.` };
    case "complaint_resolution": return { title: "Complaint resolution updated", description: `${actor} updated the resolution for ${complaint}.` };
    case "review_created": return { title: "Client Review recorded", description: `${review} was recorded by ${actor}.` };
    case "review_updated": return { title: "Client Review updated", description: `${actor} updated ${review}.` };
    case "suggestion_created": return { title: "Suggestion recorded", description: `${suggestion} was recorded by ${actor}.` };
    case "suggestion_status": return { title: `Suggestion ${reportStatus(entry.newValue).toLowerCase()}`, description: `${actor} marked ${suggestion} as ${reportStatus(entry.newValue)}.` };
    case "suggestion_updated": return { title: "Suggestion updated", description: `${actor} updated ${suggestion}.` };
    default: return { title: "Order record updated", description: `${actor} updated the Order record.` };
  }
};

type OrderFormService = {
  id: number;
  serviceNumber: number;
  serviceType: string;
  quantity: number;
  instructions: string;
};

type OrderServiceType = "documentation" | "resume_distribution" | "portfolio_website";

const ORDER_SERVICE_TYPE_OPTIONS: Array<{ value: OrderServiceType; label: string; icon: typeof FileText }> = [
  { value: "documentation", label: "Documentation Services", icon: FileText },
  { value: "resume_distribution", label: "Resume Distribution Service", icon: Send },
  { value: "portfolio_website", label: "Portfolio Website", icon: Globe },
];

const ORDER_SERVICE_TYPE_FILTER_LABELS: Record<OrderServiceType, string> = {
  documentation: "Documentation Services",
  resume_distribution: "Resume Distribution",
  portfolio_website: "Portfolio Website",
};

const ORDER_SERVICE_TYPE_TITLES: Record<OrderServiceType, string> = {
  documentation: "Documentation Services Order",
  resume_distribution: "Resume Distribution Order",
  portfolio_website: "Portfolio Website Order",
};

const REVISION_COUNT_OPTIONS = ["1", "2", "3", "4", "5"];
// Remaining-revisions options are capped at the order's own original revision
// limit — never lets staff bump remaining above what was originally purchased.
const getRemainingRevisionOptions = (originalLimit: number | null | undefined) => {
  const max = originalLimit != null ? originalLimit : 5;
  return Array.from({ length: max + 1 }, (_, n) => String(n));
};
const SUPPORT_PERIOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "15_days", label: "15 Days" },
  { value: "1_month", label: "1 Month" },
  { value: "2_months", label: "2 Months" },
  { value: "3_months", label: "3 Months" },
  { value: "4_months", label: "4 Months" },
  { value: "5_months", label: "5 Months" },
  { value: "6_months", label: "6 Months" },
];
const SUPPORT_PERIOD_LABELS: Record<string, string> = Object.fromEntries(SUPPORT_PERIOD_OPTIONS.map(o => [o.value, o.label]));

// Support validity end date, computed from Order Date + Support Period (calendar-accurate for months).
const SUPPORT_PERIOD_END: Record<string, (start: Date) => Date> = {
  "15_days": (d) => addDays(d, 15),
  "1_month": (d) => addMonths(d, 1),
  "2_months": (d) => addMonths(d, 2),
  "3_months": (d) => addMonths(d, 3),
  "4_months": (d) => addMonths(d, 4),
  "5_months": (d) => addMonths(d, 5),
  "6_months": (d) => addMonths(d, 6),
};

type SupportStatusInfo = { status: "active" | "expiring_soon" | "expired"; startDate: Date; endDate: Date; daysLeft: number };

const getSupportStatusInfo = (order: OrderWithServices): SupportStatusInfo | null => {
  if (!order.supportPeriod || !order.createdAt) return null;
  const computeEnd = SUPPORT_PERIOD_END[order.supportPeriod];
  if (!computeEnd) return null;
  const startDate = new Date(order.createdAt);
  const endDate = computeEnd(startDate);
  const now = new Date();
  const daysLeft = differenceInCalendarDays(endDate, now);
  const status: SupportStatusInfo["status"] = now >= endDate ? "expired" : daysLeft <= 3 ? "expiring_soon" : "active";
  return { status, startDate, endDate, daysLeft };
};


type OrderReview = ClientReview & {
  reviewForDesigner?: Pick<User, "id" | "name"> | null;
  createdBy?: Pick<User, "id" | "name" | "role"> | null;
};

type OrderSuggestion = ClientSuggestion & {
  relatedDesigner?: Pick<User, "id" | "name"> | null;
  createdBy?: Pick<User, "id" | "name" | "role"> | null;
  implementedBy?: Pick<User, "id" | "name" | "role"> | null;
  rejectedBy?: Pick<User, "id" | "name" | "role"> | null;
  adminNotesLog?: Array<{ id: number; noteText: string; createdAt: string | Date | null; createdBy?: Pick<User, "id" | "name" | "role"> | null }>;
  order?: { packageType?: string | null; services?: OrderWithServices["services"]; status?: string | null };
};

type OrderDrawerTab = "overview" | "services" | "payments" | "activity";
type OrderPeriod = "today" | "month" | "all";
type SavedOrderFilter = { name: string; period: OrderPeriod; month: string; year: string; status: string; designer: string; service: string };
type OrderDrawerFrame =
  | { kind: "order"; tab: OrderDrawerTab }
  | { kind: "complaint"; id: number }
  | { kind: "review"; id: number }
  | { kind: "suggestion"; id: number };

// Keep numbering tied to each card's creation identity: removing a card never
// renumbers or reuses a label, while every new card is inserted first.
const prependNumberedService = (
  services: OrderFormService[],
  id: number,
  serviceNumber: number,
): OrderFormService[] => {
  return [
    { id, serviceNumber, serviceType: "", quantity: 1, instructions: "" },
    ...services,
  ];
};

export default function OrdersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth().toString());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [orderPeriod, setOrderPeriod] = useState<OrderPeriod>("month");
  const [orderView, setOrderView] = useState<"orders" | "requests">("orders");
  const [assignOrder, setAssignOrder] = useState<OrderWithServices | null>(null);
  // Kept for the PDF export file name.
  const activeOrdersTab = orderView === "requests" ? "requests" : orderPeriod === "today" ? "today" : orderPeriod === "all" ? "all" : "monthly";
  const isCurrentMonth = Number(selectedMonth) === new Date().getMonth() && Number(selectedYear) === new Date().getFullYear();
  const yearOptions = Array.from({ length: new Date().getFullYear() - 2024 + 2 }, (_, i) => 2024 + i);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState("all");
  const [selectedDesignerFilter, setSelectedDesignerFilter] = useState("all");
  const [selectedServiceTypeFilter, setSelectedServiceTypeFilter] = useState("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createOrderType, setCreateOrderType] = useState<OrderServiceType | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderWithServices | null>(null);
  const [drawerStack, setDrawerStack] = useState<OrderDrawerFrame[]>([]);
  const [copiedPhone, setCopiedPhone] = useState<number | null>(null);
  const [orderToEdit, setOrderToEdit] = useState<OrderWithServices | null>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<OrderWithServices | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [orderToCancel, setOrderToCancel] = useState<OrderWithServices | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [advanceDisposition, setAdvanceDisposition] = useState<"refunded" | "retained" | "">("");
  const [complaintDialogOpen, setComplaintDialogOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<OrderDrawerTab>("overview");
  const [nestedReviewEditOpen, setNestedReviewEditOpen] = useState(false);
  const [deepLinkMessage, setDeepLinkMessage] = useState<string | null>(null);
  // Subscribed to the query string, so a notification click on /orders opens the new order.
  const locationSearch = useSearch();
  const requestedOrderNumber = new URLSearchParams(locationSearch).get("order");
  const activeDrawer = drawerStack[drawerStack.length - 1];
  const detailsSheetOpen = drawerStack.length > 0;

  // Debounce the search input (300ms) so typing stays smooth on large order lists.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const [page, setPage] = useState(1);
  const trimmedSearch = debouncedSearch.trim();
  const listParams: OrderListParams = {
    page,
    pageSize: ORDERS_PAGE_SIZE,
    search: trimmedSearch || undefined,
    ...(activeOrdersTab === "requests"
      ? { view: "requests" as const }
      : { status: selectedStatusFilter, designerId: selectedDesignerFilter, orderType: selectedServiceTypeFilter }),
    period: trimmedSearch || orderView === "requests" ? "all" : orderPeriod,
    year: Number(selectedYear),
    month: Number(selectedMonth) + 1,
  };
  // Any filter change starts again at page 1.
  useEffect(() => { setPage(1); }, [trimmedSearch, selectedStatusFilter, selectedDesignerFilter, selectedServiceTypeFilter, orderPeriod, orderView, selectedMonth, selectedYear]);

  // Server-side filtering, search and pagination (50 per page). Live updates
  // arrive over SSE, which invalidates ["/api/orders"]; no polling here.
  const { data: orderPage, isLoading, isFetching: listFetching } = useQuery({
    queryKey: orderListKey(listParams),
    queryFn: () => fetchOrderPage(listParams),
    placeholderData: keepPreviousData,
  });
  const pageRows = orderPage?.rows ?? [];
  const totalRows = orderPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / ORDERS_PAGE_SIZE));

  const summaryParams = { year: Number(selectedYear), month: Number(selectedMonth) + 1, status: selectedStatusFilter === "overdue" ? "all" : selectedStatusFilter, designerId: selectedDesignerFilter, orderType: selectedServiceTypeFilter };
  const { data: orderSummary } = useQuery<{ monthCount: number; monthSales: number; monthCollected: number; monthRemaining: number; todaySales: number }>({
    queryKey: ["/api/orders", "summary", summaryParams],
    queryFn: async () => {
      const res = await fetch(`/api/orders/summary?${toQueryString(summaryParams)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    enabled: user?.role === "admin",
  });

  // ?order=PC-1234 deep links load that one order from the server.
  useEffect(() => {
    if (!requestedOrderNumber) return;
    let cancelled = false;
    fetchOrderByRef(requestedOrderNumber).then(order => {
      if (cancelled) return;
      if (order) {
        setSelectedOrder(order);
        setDetailsTab("overview");
        setDrawerStack([{ kind: "order", tab: "overview" }]);
        setDeepLinkMessage(null);
      } else {
        setDeepLinkMessage(`Order ${requestedOrderNumber} was not found, or you do not have permission to view it.`);
      }
    }).catch(() => { if (!cancelled) setDeepLinkMessage(`Order ${requestedOrderNumber} could not be loaded.`); });
    return () => { cancelled = true; };
  }, [requestedOrderNumber]);

  // "+ New order" (top bar / Ctrl+K) links here with ?new=1.
  const wantsNewOrder = new URLSearchParams(locationSearch).get("new") === "1";
  useEffect(() => { if (wantsNewOrder && (user?.role === "admin" || user?.role === "support")) setCreateDialogOpen(true); }, [wantsNewOrder, user?.role]);

  // Saved filters (per user, this device).
  const savedFiltersKey = `px-order-filters:${user?.id ?? "anon"}`;
  const [savedFilters, setSavedFilters] = useState<SavedOrderFilter[]>(() => {
    try { return JSON.parse(localStorage.getItem(savedFiltersKey) || "[]"); } catch { return []; }
  });
  const persistSavedFilters = (next: SavedOrderFilter[]) => {
    setSavedFilters(next);
    try { localStorage.setItem(savedFiltersKey, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const saveCurrentFilter = () => {
    const name = window.prompt("Name this filter", "")?.trim();
    if (!name) return;
    const entry: SavedOrderFilter = { name, period: orderPeriod, month: selectedMonth, year: selectedYear, status: selectedStatusFilter, designer: selectedDesignerFilter, service: selectedServiceTypeFilter };
    persistSavedFilters([...savedFilters.filter(f => f.name !== name), entry]);
    toast({ title: "Filter saved", description: name });
  };
  const removeSavedFilter = (name: string) => persistSavedFilters(savedFilters.filter(f => f.name !== name));
  const applySavedFilter = (f: SavedOrderFilter) => {
    setOrderView("orders");
    setOrderPeriod(f.period);
    setSelectedMonth(f.month); setSelectedYear(f.year);
    setSelectedStatusFilter(f.status); setSelectedDesignerFilter(f.designer); setSelectedServiceTypeFilter(f.service);
  };

  const { data: teamMembers } = useQuery<User[]>({
    queryKey: ["/api/users"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: designerAssignments } = useQuery<SupportDesignerAssignment[]>({
    queryKey: ["/api/designer-assignments"],
    enabled: user?.role === "support",
    staleTime: 5 * 60 * 1000,
  });

  const { data: servicesCatalog = [] } = useQuery<ServiceCatalogItem[]>({
    queryKey: ["/api/services-catalog"],
    staleTime: 5 * 60 * 1000,
  });

  // Package catalog is only kept to render historical orders that still carry a
  // legacy packageType — packages are no longer offered when creating orders.
  const { data: packageConfigs = [] } = useQuery<PackageConfig[]>({
    queryKey: ["/api/package-configs"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: selectedOrderComplaints = [] } = useQuery<ComplaintResponse[]>({
    queryKey: [`/api/orders/${selectedOrder?.id}/complaints`],
    enabled: Boolean(detailsSheetOpen && selectedOrder?.id),
    staleTime: 15 * 1000,
  });

  const { data: selectedOrderReviews = [], isLoading: reviewsLoading, isError: reviewsError } = useQuery<OrderReview[]>({
    queryKey: [`/api/orders/${selectedOrder?.id}/client-reviews`],
    enabled: Boolean(detailsSheetOpen && selectedOrder?.id),
  });

  const { data: selectedOrderSuggestions = [], isLoading: suggestionsLoading, isError: suggestionsError } = useQuery<OrderSuggestion[]>({
    queryKey: [`/api/orders/${selectedOrder?.id}/client-suggestions`],
    enabled: Boolean(detailsSheetOpen && selectedOrder?.id),
  });

  const { data: selectedOrderActivity = [] } = useQuery<ActivityLogWithActor[]>({
    queryKey: [`/api/orders/${selectedOrder?.id}/activity`],
    enabled: Boolean(detailsSheetOpen && selectedOrder?.id),
  });


  const activeServiceTypes = servicesCatalog.filter(s => s.isActive).map(s => s.name);
  const serviceTypes = activeServiceTypes.length > 0 ? activeServiceTypes : FALLBACK_SERVICE_TYPES;

  const packageLabels: Record<string, string> = {
    ...FALLBACK_PACKAGE_LABELS,
    ...Object.fromEntries(packageConfigs.map(p => [p.key, p.label])),
  };

  // Patches one order's fields in-place across the cached orders list and the
  // open details drawer — avoids refetching the entire order list (which can
  // be 1000+ rows) for a small, single-order change.
  const patchOrderInPlace = (id: number, updates: Partial<OrderWithServices>) => {
    patchOrderInCaches(queryClient, id, o => ({ ...o, ...updates }));
    setSelectedOrder(current => (current && current.id === id ? { ...current, ...updates } : current));
  };

  const updateOrderServiceLinkMutation = useMutation({
    mutationFn: async ({ id, deliverableLink }: { id: number; orderId: number; deliverableLink: string | null }) => {
      const res = await apiRequest("PATCH", `/api/order-services/${id}`, { deliverableLink });
      return res.json();
    },
    onMutate: async ({ id, orderId, deliverableLink }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/orders", "list"] });
      const previousOrders = snapshotOrderCaches(queryClient);
      const patchServices = (services: OrderWithServices["services"]) =>
        services.map(s => (s.id === id ? { ...s, deliverableLink } : s));
      patchOrderInCaches(queryClient, orderId, o => ({ ...o, services: patchServices(o.services) }));
      setSelectedOrder(current => (current && current.id === orderId ? { ...current, services: patchServices(current.services) } : current));
      return { previousOrders };
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Link saved" });
    },
    onError: (_err, _variables, context) => {
      if (context?.previousOrders) restoreOrderCaches(queryClient, context.previousOrders);
      toast({ title: "Error", description: "Failed to save link", variant: "destructive" });
    },
  });

  const updateOrderMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      const res = await apiRequest("PATCH", `/api/orders/${id}`, updates);
      return res.json();
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/orders", "list"] });
      const previousOrders = snapshotOrderCaches(queryClient);
      patchOrderInPlace(id, updates);
      return { previousOrders };
    },
    onSuccess: (updated) => {
      patchOrderInPlace(updated.id, updated);
      toast({ title: "Success", description: "Order updated successfully" });
    },
    onError: (err, _variables, context) => {
      if (context?.previousOrders) restoreOrderCaches(queryClient, context.previousOrders);
      toast({ title: "Couldn't update order", description: getErrorMessage(err, "Failed to update order"), variant: "destructive" });
    },
  });

  // Phase 2: admin confirms a Request without a payment ("pay later").
  const approvePayLaterMutation = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/orders/${id}/approve-pay-later`, {})).json(),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order confirmed", description: `${order.orderNumber || "The order"} was approved to pay later.` });
    },
    onError: (err) => toast({ title: "Couldn't approve", description: getErrorMessage(err), variant: "destructive" }),
  });

  const metaRetryMutation = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/orders/${id}/meta-retry`)).json(),
    onMutate: (id: number) => { if (selectedOrder?.id === id) setSelectedOrder(current => current ? { ...current, metaStatus: "pending" } : current); },
    onSuccess: (_data, id: number) => {
      toast({ title: "Retrying Meta Purchase" });
      // The send runs in the background (with retries); re-read the order once it has had time to finish.
      for (const delay of [3_000, 15_000]) setTimeout(async () => {
        const match = await fetchOrderById(id).catch(() => null);
        if (match) setSelectedOrder(current => current && current.id === match.id ? { ...current, metaStatus: match.metaStatus, metaPurchaseSentAt: match.metaPurchaseSentAt } : current);
      }, delay);
    },
    onError: (err: Error, id: number) => {
      if (selectedOrder?.id === id) setSelectedOrder(current => current ? { ...current, metaStatus: "failed" } : current);
      toast({ title: "Meta retry failed", description: getErrorMessage(err), variant: "destructive" });
    },
  });

  const cancelOrderMutation = useMutation({
    mutationFn: async ({ id, reason, advanceRefunded }: { id: number; reason: string; advanceRefunded: boolean }) =>
      (await apiRequest("POST", `/api/orders/${id}/cancel`, { reason, advanceRefunded })).json(),
    onSuccess: (updated: OrderWithServices) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      if (selectedOrder?.id === updated.id) setSelectedOrder(current => current ? { ...current, ...updated } : current);
      setOrderToCancel(null);
      setCancellationReason("");
      setAdvanceDisposition("");
      toast({ title: "Order canceled", description: updated.advanceRefunded ? "The advance refund was recorded." : "The advance was recorded as retained." });
    },
    onError: async (error: Error, variables) => {
      // A dropped response can happen after the server commits the
      // cancellation. Re-read the order before telling the user it failed.
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      try {
        const refreshed = await fetchOrderById(variables.id);
        if (refreshed?.status === "canceled") {
          if (selectedOrder?.id === refreshed.id) setSelectedOrder(current => current ? { ...current, ...refreshed } : current);
          setOrderToCancel(null);
          setCancellationReason("");
          setAdvanceDisposition("");
          toast({ title: "Order canceled", description: refreshed.advanceRefunded ? "The advance refund was recorded." : "The advance was recorded as retained." });
          return;
        }
      } catch {
        // Keep the original error when the reconciliation request also fails.
      }
      toast({ title: "Could not cancel order", description: error.message || "Please refresh and check the order status.", variant: "destructive" });
    },
  });

  const clientCaseReportMutation = useMutation({
    mutationFn: async (orderId: number) => {
      const response = await fetch(`/api/orders/${orderId}/client-case-report`, { credentials: "include" });
      if (!response.ok) throw new Error("The client case report could not be generated.");
      return response.json();
    },
    onSuccess: async (report: Record<string, any>) => {
      const { jsPDF, autoTable } = await loadPdf();
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const order = (report.order || {}) as Record<string, any>;
      const payments = Array.isArray(report.payments) ? report.payments as Array<Record<string, any>> : [];
      const complaints = Array.isArray(report.complaints) ? report.complaints as Array<Record<string, any>> : [];
      const suggestions = Array.isArray(report.suggestions) ? report.suggestions as Array<Record<string, any>> : [];
      const activity = Array.isArray(report.activity) ? report.activity as Array<Record<string, any>> : [];
      const review = report.review && typeof report.review === "object" ? report.review as Record<string, any> : null;
      const orderNumber = String(order.orderNumber || selectedOrder?.orderNumber || "Order");
      const designer = reportPerson(order.assignee) || "Unassigned";
      const createdBy = reportPerson(order.createdBy);
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 42;
      const BLUE: [number, number, number] = [37, 99, 235];
      const NAVY: [number, number, number] = [30, 41, 59];
      const SLATE: [number, number, number] = [100, 116, 139];
      const LIGHT: [number, number, number] = [241, 245, 249];
      let cursorY = 0;

      const rows = (values: Array<[string, unknown]>) => values
        .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
        .map(([label, value]) => [label, String(value)]);
      const ensureSpace = (height = 80) => {
        if (cursorY + height > pageHeight - 52) {
          doc.addPage();
          cursorY = 48;
        }
      };
      const section = (title: string, body: string[][], options: { head?: [string, string]; minHeight?: number } = {}) => {
        if (!body.length) return;
        ensureSpace(options.minHeight || 92);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(...NAVY);
        doc.text(title.toUpperCase(), margin, cursorY);
        autoTable(doc, {
          startY: cursorY + 8,
          head: options.head ? [options.head] : undefined,
          body,
          theme: "grid",
          margin: { left: margin, right: margin, bottom: 54 },
          styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5, overflow: "linebreak", valign: "top", textColor: NAVY, lineColor: [226, 232, 240], lineWidth: 0.35 },
          headStyles: { fillColor: BLUE, textColor: [255, 255, 255], fontStyle: "bold" },
          columnStyles: { 0: { cellWidth: 135, fontStyle: "bold", fillColor: LIGHT } },
          rowPageBreak: "avoid",
        });
        cursorY = (doc as any).lastAutoTable.finalY + 25;
      };

      doc.setFillColor(...LIGHT);
      doc.roundedRect(margin, 32, pageWidth - margin * 2, 92, 8, 8, "F");
      doc.setFillColor(...BLUE);
      doc.rect(margin, 32, 7, 92, "F");
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...NAVY);
      doc.setFontSize(13);
      doc.text("PIXELY CAREERS", margin + 22, 58);
      doc.setFontSize(22);
      doc.text("CLIENT CASE REPORT", margin + 22, 84);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...SLATE);
      doc.text("Complete Order & Client Experience Record", margin + 22, 103);
      doc.text(`Order ${orderNumber}`, pageWidth - margin - 18, 62, { align: "right" });
      doc.text(`Generated ${format(new Date(), "MMM dd, yyyy · h:mm a")}`, pageWidth - margin - 18, 80, { align: "right" });
      doc.text("INTERNAL MANAGEMENT RECORD", pageWidth - margin - 18, 100, { align: "right" });
      cursorY = 154;

      section("Case Overview", rows([
        ["Client", order.clientName],
        ["Order ID", orderNumber],
        ["Order Status", reportStatus(order.status)],
        ["Assigned Designer", designer],
        ["Order Value", order.totalPrice !== undefined ? reportMoney(order.totalPrice) : ""],
        ["Client Rating", review?.rating ? `${review.rating}/5` : "Not recorded"],
        ["Complaints", complaints.length],
        ["Suggestions", suggestions.length],
      ]));
      section("Client Information", rows([
        ["Full Name", order.clientName],
        ["Contact Number", order.clientPhone],
        ["Email", order.clientEmail],
        ["Client Type", order.clientType ? `${reportStatus(order.clientType)} Client` : ""],
        ["Client Source", order.platform ? reportStatus(order.platform) : ""],
      ]));
      section("Order Information", rows([
        ["Order ID", orderNumber],
        ["Created Date", reportDate(order.createdAt)],
        ["Created By", createdBy],
        ["Current Status", reportStatus(order.status)],
        ["Completion Date", reportDate(order.deliveredAt || order.readyDate)],
        ["Current Designer", designer],
      ]));
      const serviceRows: string[][] = [];
      if (order.packageType) serviceRows.push(["Package", FALLBACK_PACKAGE_LABELS[order.packageType] || reportStatus(order.packageType)]);
      if (Array.isArray(order.services)) order.services.forEach((service: Record<string, any>) => {
        const quantity = Math.max(1, Number(service.quantity || 1));
        serviceRows.push(["Service", `${String(service.serviceType || "Service")}${quantity > 1 ? ` ×${quantity}` : ""}${service.instructions ? `\n${String(service.instructions)}` : ""}`]);
      });
      section("Services & Package", serviceRows.length ? serviceRows : [["Services", "No services recorded."]]);
      section("Assignment", rows([
        ["Current Designer", designer],
        ["Role", order.assignee ? "Designer" : ""],
      ]));

      const canceled = order.status === "canceled";
      const accounting = getOrderAccounting(order);
      const advanceWasRefunded = canceled && order.advanceRefunded === true;
      section("Financial Summary", canceled ? rows([
        ["Original Order Value", reportMoney(order.totalPrice)],
        ["Discount", reportMoney(order.discountAmount)],
        ["Original Advance", reportMoney(order.advanceAmount)],
        ["Advance Disposition", advanceWasRefunded ? "Refunded" : "Retained"],
        ["Refunded Amount", reportMoney(order.refundAmount)],
        ["Net Collected", reportMoney(accounting.netCollected)],
        ["Original Remaining", reportMoney(order.remainingAmount)],
        ["Remaining Receivable", reportMoney(accounting.remainingReceivable)],
        ["Order Status", "Canceled"],
      ]) : rows([
        ["Order Value", reportMoney(order.totalPrice)],
        ["Discount", reportMoney(order.discountAmount)],
        ["Advance Received", reportMoney(order.advanceAmount)],
        ["Remaining Balance", reportMoney(accounting.remainingReceivable)],
        ["Net Collected", reportMoney(accounting.netCollected)],
        ["Payment Status", order.paymentStatus === "paid" ? "Paid" : "Payment Pending"],
      ]));

      payments.sort((a, b) => +new Date(a.createdAt || 0) - +new Date(b.createdAt || 0)).forEach(payment => {
        section(`Payment History · ${reportDate(payment.createdAt) || "Date not recorded"}`, rows([
          ["Payment Type", reportStatus(payment.paymentType)],
          ["Amount", reportMoney(payment.amount)],
          ["Status", reportStatus(payment.status)],
          ["Submitted By", reportPerson(payment.submittedBy)],
          ["Reviewed By", reportPerson(payment.reviewedBy)],
          ["Reviewed On", reportDate(payment.reviewedAt)],
          ["Evidence", payment.screenshotUrl ? "Payment evidence is available in the CRM." : "No evidence attached."],
          ["Notes", payment.notes],
        ]));
      });

      complaints.forEach(complaint => {
        const complaintRows = rows([
          ["Status", reportStatus(complaint.status)],
          ["Category", reportStatus(complaint.category)],
          ["Reported Against", reportPerson(complaint.complaintAgainst)],
          ["Reported By", reportPerson(complaint.filedBy)],
          ["Reported On", reportDate(complaint.createdAt)],
          ["Complaint Details", complaint.description],
          ["Evidence", complaint.screenshotUrl ? "Complaint evidence is available in the CRM." : "No evidence attached."],
          ["Management Decision", complaint.status === "new" ? "Awaiting Management Decision" : reportStatus(complaint.status)],
          ["Reason for Dismissal", complaint.dismissalReason],
          ["Dismissed By", reportPerson(complaint.dismissedBy)],
          ["Dismissed On", reportDate(complaint.dismissedAt)],
          ["Resolution", complaint.resolution],
          ["Resolution Type", complaint.resolutionOutcome ? reportStatus(complaint.resolutionOutcome) : ""],
          ["Resolved By", reportPerson(complaint.resolvedBy)],
          ["Resolved On", reportDate(complaint.resolvedAt)],
          ["Resolution / Refund Evidence", complaint.resolutionScreenshotUrl ? "Evidence is available in the CRM." : ""],
          ["Final Outcome", complaint.status === "refunded" ? "Refunded & Order Canceled" : ""],
        ]);
        section(`Complaint ${String(complaint.complaintNumber || "")}`.trim(), complaintRows, { minHeight: 130 });
      });

      if (review) {
        const channels = [
          review.whatsappFeedbackReceived && "WhatsApp Feedback — Received",
          review.facebookReviewReceived && "Facebook Review — Received",
          review.videoReviewReceived && "Video Testimonial — Received",
        ].filter(Boolean).join("\n");
        section("Client Review", rows([
          ["Review ID", review.reviewNumber],
          ["Client Rating", review.rating ? `${review.rating}/5` : "Not recorded"],
          ["Client Feedback", review.feedbackText],
          ["Feedback Sources", channels || "No feedback sources recorded."],
          ["Public Review Link", review.publicReviewLink],
          ["Marketing Permission", review.marketingPermission === "yes" ? "Permission Granted" : review.marketingPermission === "no" ? "Permission Not Granted" : "Not Asked"],
          ["Designer", reportPerson(review.reviewForDesigner)],
          ["Recorded By", reportPerson(review.createdBy)],
          ["Recorded On", reportDate(review.createdAt)],
          ["Evidence", review.screenshotUrl ? "Review evidence is available in the CRM." : "No evidence attached."],
        ]), { minHeight: 150 });
      }

      suggestions.forEach(suggestion => {
        section(`Suggestion ${String(suggestion.suggestionNumber || "")}`.trim(), rows([
          ["Status", suggestion.status === "new" ? "Awaiting Management Decision" : reportStatus(suggestion.status)],
          ["Client Suggestion", suggestion.suggestionText],
          ["Recorded By", reportPerson(suggestion.createdBy)],
          ["Recorded On", reportDate(suggestion.createdAt)],
          ["Evidence", suggestion.screenshotUrl ? "Suggestion evidence is available in the CRM." : "No evidence attached."],
          ["Management Decision", suggestion.status === "new" ? "" : reportStatus(suggestion.status)],
          ["Implementation Summary", suggestion.implementationDetails],
          ["Implemented By", reportPerson(suggestion.implementedBy)],
          ["Implemented On", reportDate(suggestion.implementedAt)],
          ["Implementation Evidence", suggestion.implementationScreenshotUrl ? "Implementation evidence is available in the CRM." : ""],
          ["Reason for Rejection", suggestion.rejectionReason],
          ["Rejected By", reportPerson(suggestion.rejectedBy)],
          ["Rejected On", reportDate(suggestion.rejectedAt)],
        ]), { minHeight: 130 });
      });

      section("Client Experience Summary", rows([
        ["Client Rating", review?.rating ? `${review.rating}/5` : "Not recorded"],
        ["Complaints", complaints.length],
        ["Confirmed Complaints", complaints.filter(item => item.status === "confirmed").length],
        ["Resolved Complaints", complaints.filter(item => item.status === "resolved").length],
        ["Refunded Complaints", complaints.filter(item => item.status === "refunded").length],
        ["Suggestions", suggestions.length],
        ["Implemented Suggestions", suggestions.filter(item => item.status === "implemented").length],
        ["Rejected Suggestions", suggestions.filter(item => item.status === "rejected").length],
        ["Public Review", review?.facebookReviewReceived ? "Received" : "Not received"],
        ["Video Testimonial", review?.videoReviewReceived ? "Received" : "Not received"],
      ]));

      const timelineRows = activity
        .slice()
        .sort((a, b) => +new Date(a.createdAt || 0) - +new Date(b.createdAt || 0))
        .map(entry => {
          const copy = reportActivityCopy(entry, orderNumber);
          return [reportDate(entry.createdAt), `${copy.title}\n${copy.description}`];
        });
      section("Case Timeline", timelineRows, { head: ["Date & Time", "Activity"], minHeight: 140 });

      const managementNotes: string[][] = [];
      complaints.forEach(complaint => (complaint.adminNotesLog || []).forEach((note: Record<string, any>) => {
        managementNotes.push([`Complaint ${complaint.complaintNumber}`, `${String(note.noteText || "")}\n${reportPerson(note.createdBy) || "Migrated Admin Note"} · ${reportDate(note.createdAt)}`]);
      }));
      suggestions.forEach(suggestion => (suggestion.adminNotesLog || []).forEach((note: Record<string, any>) => {
        managementNotes.push([`Suggestion ${suggestion.suggestionNumber}`, `${String(note.noteText || "")}\n${reportPerson(note.createdBy) || "Migrated Admin Note"} · ${reportDate(note.createdAt)}`]);
      }));
      section("Internal Management Notes", managementNotes, { head: ["Record", "Private Note"], minHeight: 120 });

      const pageCount = doc.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        doc.setPage(page);
        doc.setDrawColor(226, 232, 240);
        doc.line(margin, pageHeight - 35, pageWidth - margin, pageHeight - 35);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...SLATE);
        doc.text(`Pixely Careers CRM · Client Case Report · ${orderNumber}`, margin, pageHeight - 19);
        doc.text(`Confidential Internal Record · Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 19, { align: "right" });
      }
      doc.save(`Pixely_Careers_Client_Case_Report_${orderNumber.replace(/[^A-Za-z0-9-]/g, "_")}.pdf`);
      void recordExport("client case report", "pdf");
      toast({ title: "Client case report downloaded" });
    },
    onError: (error: Error) => toast({ title: "Could not generate report", description: error.message, variant: "destructive" }),
  });

  const deleteOrderMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/orders/${id}`);
    },
    onSuccess: (_data, id) => {
      const label = orderToDelete?.orderNumber || `#${id}`;
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Order Deleted", description: `Order ${label} has been permanently deleted.` });
      setOrderToDelete(null);
      setDeleteConfirmText("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete order", variant: "destructive" });
    },
  });

  const isSearchActive = trimmedSearch.length > 0;
  const isSearchSettling = search.trim() !== trimmedSearch || listFetching;

  if (isLoading) return <OrdersSkeleton />;

  const isAdmin = user?.role === "admin";
  const isSupport = user?.role === "support";
  const isDesigner = user?.role === "designer";
  const canSeeFinance = isAdmin;
  const canSeeAmounts = isAdmin || isDesigner || isSupport;
  const canCreateOrder = isAdmin || isSupport;

  const getAvailableDesigners = () => {
    // Disabled designers are hidden from assignment dropdowns (existing orders still
    // display their name for history — only new assignments are restricted).
    const allDesigners = teamMembers?.filter(u => u.role === 'designer' && u.isActive) || [];
    if (isSupport) {
      if (!designerAssignments) return [];
      const assignedIds = designerAssignments.map(a => a.designerUserId);
      return allDesigners.filter(d => assignedIds.includes(d.id));
    }
    return allDesigners;
  };
  const availableDesigners = getAvailableDesigners();
  const filterableDesigners = (teamMembers || []).filter(u => u.role === 'designer');
  const designerFilterOptions = isSupport
    ? filterableDesigners.filter(d => (designerAssignments || []).some(a => a.designerUserId === d.id))
    : filterableDesigners;
  
  const copyPhone = (orderId: number, phone: string) => {
    navigator.clipboard.writeText(phone);
    setCopiedPhone(orderId);
    toast({ title: "Copied", description: "Phone number copied to clipboard" });
    setTimeout(() => setCopiedPhone(null), 2000);
  };
  
  const openOrderDetails = (order: OrderWithServices) => {
    setSelectedOrder(order);
    setDetailsTab("overview");
    setDrawerStack([{ kind: "order", tab: "overview" }]);
  };
  const closeDrawer = () => {
    setDrawerStack([]);
    setSelectedOrder(null);
  };
  const goBackInDrawer = () => setDrawerStack(stack => stack.slice(0, -1));
  const openNestedDrawer = (frame: Exclude<OrderDrawerFrame, { kind: "order" }>) =>
    setDrawerStack(stack => [...stack, frame]);
  const setOrderDrawerTab = (tab: OrderDrawerTab) => {
    setDetailsTab(tab);
    setDrawerStack(stack => stack.map((frame, index) =>
      index === 0 && frame.kind === "order" ? { ...frame, tab } : frame,
    ));
  };

  // The server applies visibility (placed orders only; designers see their own),
  // filters, search and the today/month period. This is one page of results.
  const hasActiveOrderFilters = selectedStatusFilter !== "all" || selectedDesignerFilter !== "all" || selectedServiceTypeFilter !== "all";
  const universalSearchResults = pageRows;
  const todayOrders = pageRows;
  const monthlyOrders = pageRows;

  const getStatusBadge = (status: string) => <OrderStatusBadge status={status} />;
  const getAdvancePaymentStatusBadge = (status: string | null | undefined) => <AdvancePaymentStatusBadge status={status} />;

  const getServicesDisplay = (order: OrderWithServices) => {
    // Historical orders keep showing exactly what was originally recorded —
    // the new service-count / order-type display only applies to new orders,
    // which never set packageType.
    if (order.packageType && order.packageType !== "custom") {
      const packageLabel = packageLabels[order.packageType] || order.packageType;
      const services = order.services || [];
      if (services.length === 0) {
        return (
          <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
            {packageLabel}
          </Badge>
        );
      }
      const totalServices = services.reduce((acc, s) => acc + (s.quantity || 1), 0);
      const servicesList = services.map(s => `${s.serviceType} (${s.quantity || 1})`);
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex flex-wrap items-center gap-1.5 cursor-pointer" onClick={() => openOrderDetails(order)}>
              <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
                {packageLabel}
              </Badge>
              <span className="text-slate-300 underline decoration-dotted underline-offset-2 whitespace-nowrap">
                +{totalServices} {totalServices === 1 ? "Add-on" : "Add-ons"}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent className="bg-slate-800 border-slate-700 text-white">
            <p className="mb-2 font-medium text-blue-300">{packageLabel}</p>
            <ul className="list-disc list-inside space-y-1">
              {servicesList.map((s, i) => (
                <li key={i} className="text-sm">{s}</li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      );
    }

    if (order.orderType === "portfolio_website") {
      return (
        <span className="cursor-pointer text-slate-300 underline decoration-dotted underline-offset-2" onClick={() => openOrderDetails(order)}>
          Website
        </span>
      );
    }
    if (order.orderType === "resume_distribution") {
      return (
        <span className="cursor-pointer text-slate-300 underline decoration-dotted underline-offset-2" onClick={() => openOrderDetails(order)}>
          Distribution Service
        </span>
      );
    }

    const services = order.services;
    if (!services || services.length === 0) return "-";
    const totalServices = services.reduce((acc, s) => acc + (s.quantity || 1), 0);
    const servicesList = services.map(s => `${s.serviceType} (${s.quantity || 1})`);

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="text-slate-300 underline decoration-dotted underline-offset-2 whitespace-nowrap cursor-pointer"
            onClick={() => openOrderDetails(order)}
            data-testid={`link-services-${order.id}`}
          >
            {totalServices} {totalServices === 1 ? "Service" : "Services"}
          </span>
        </TooltipTrigger>
        <TooltipContent className="bg-slate-800 border-slate-700 text-white">
          <ul className="list-disc list-inside space-y-1">
            {servicesList.map((s, i) => (
              <li key={i} className="text-sm">{s}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    );
  };

  const formatRs = (value: number | null | undefined) => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "Rs0";
    return `Rs${Math.round(amount / 100).toLocaleString()}`;
  };

  const formatDateSafe = (value: string | Date | null | undefined, withTime = false) => {
    if (!value) return "Not Specified";
    const d = new Date(value);
    if (isNaN(d.getTime())) return "Not Specified";
    return format(d, withTime ? "MMM dd, yyyy h:mm a" : "MMM dd, yyyy");
  };

  const paymentMethodLabels: Record<string, string> = {
    cash: "Cash",
    jazzcash: "JazzCash",
    easypaisa: "Easypaisa",
    bank_transfer: "Bank Transfer",
    other: "Other",
  };

  const getServicesLabel = (order: OrderWithServices) => {
    if (order.packageType && order.packageType !== "custom") {
      const packageLabel = packageLabels[order.packageType] || order.packageType;
      const services = order.services || [];
      const totalServices = services.reduce((total, service) => total + (service.quantity || 1), 0);
      return totalServices > 0
        ? `${packageLabel} +${totalServices} ${totalServices === 1 ? "Add-on" : "Add-ons"}`
        : packageLabel;
    }
    if (order.orderType === "portfolio_website") return "Website";
    if (order.orderType === "resume_distribution") return "Distribution Service";
    const services = order.services || [];
    return services
      .map(service => `${service.serviceType || "Service"}${(service.quantity || 1) > 1 ? ` × ${service.quantity}` : ""}`)
      .join(", ") || "Not Specified";
  };

  const getCreatedByLabel = (order: OrderWithServices) => {
    const creator = teamMembers?.find(member => member.id === order.createdById);
    if (!creator) return order.createdById ? "Unknown user" : "Not Specified";
    const roleLabel = creator.role.charAt(0).toUpperCase() + creator.role.slice(1);
    return `${creator.name} (${roleLabel})`;
  };

  const getClientTypeLabel = (order: OrderWithServices) =>
    order.clientType === "international" ? "International" : "National";

  const exportOrdersPDF = async () => {
    let reportSubtitle: string;
    if (isSearchActive) {
      reportSubtitle = "Search Results";
    } else if (activeOrdersTab === "today") {
      reportSubtitle = `Today — ${format(new Date(), "MMMM dd, yyyy")}`;
    } else {
      reportSubtitle = format(new Date(parseInt(selectedYear), parseInt(selectedMonth), 1), "MMMM yyyy");
    }

    const exportOrders: OrderWithServices[] = [];
    try {
      for (let p = 1; p <= 200; p++) {
        const chunk = await fetchOrderPage({ ...listParams, page: p, pageSize: 100 });
        exportOrders.push(...chunk.rows);
        if (chunk.rows.length === 0 || exportOrders.length >= chunk.total) break;
      }
    } catch (error) {
      toast({ title: "Export failed", description: getErrorMessage(error), variant: "destructive" });
      return;
    }

    const { jsPDF, autoTable } = await loadPdf();
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 32;
    const contentWidth = pageWidth - marginX * 2;

    const BRAND: [number, number, number] = [37, 99, 235];
    const BRAND_DARK: [number, number, number] = [22, 60, 140];
    const INK: [number, number, number] = [30, 41, 59];
    const MUTED: [number, number, number] = [100, 116, 139];
    const LINE: [number, number, number] = [226, 232, 240];
    const SOFT_BLUE: [number, number, number] = [239, 246, 255];

    // ---- Header ----
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
    doc.setTextColor(...BRAND_DARK);
    doc.text(`Orders Report  •  ${reportSubtitle}`, marginX + 20, 68);

    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(`Generated ${format(new Date(), "MMM dd, yyyy · h:mm a")}`, pageWidth - marginX, 68, { align: "right" });

    const tableStartY = 112;

    // Keep the export intentionally focused: one table with the nine requested
    // order fields, rather than splitting order data across two tables.
    // Revisions + Support Period share one column so the export still fits on one page.
    const getRevisionsSupportExportLabel = (order: OrderWithServices) => {
      const revisionsPart = order.orderType !== "resume_distribution" && order.numberOfRevisions
        ? `${order.numberOfRevisions} Rev`
        : null;
      const supportPart = order.supportPeriod ? (SUPPORT_PERIOD_LABELS[order.supportPeriod] || order.supportPeriod) : null;
      const parts = [revisionsPart, supportPart].filter(Boolean);
      return parts.length > 0 ? parts.join(" / ") : "—";
    };

    const tableData = exportOrders.length > 0 ? exportOrders.map(order => [
      order.orderNumber || "Not Specified",
      formatDateSafe(order.createdAt),
      order.clientName || "Not Specified",
      getClientTypeLabel(order),
      order.clientPhone && order.clientPhone.trim() ? order.clientPhone.trim() : "Not Specified",
      getServicesLabel(order),
      getRevisionsSupportExportLabel(order),
      order.assignee?.name || "Unassigned",
      formatRs(order.totalPrice),
      formatRs(order.remainingAmount),
    ]) : [["No orders found.", "", "", "", "", "", "", "", "", ""]];

    const tableBaseStyles = {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 4,
      overflow: "linebreak" as const,
      valign: "middle" as const,
      textColor: INK,
      lineColor: LINE,
      lineWidth: 0.35,
    };
    const tableHeadStyles = {
      fillColor: BRAND,
      textColor: [255, 255, 255] as [number, number, number],
      fontStyle: "bold" as const,
      fontSize: 7.5,
      halign: "left" as const,
      cellPadding: 5,
      valign: "middle" as const,
    };
    const tableBodyStyles = { fillColor: [255, 255, 255] as [number, number, number] };
    const tableAlternateStyles = { fillColor: [248, 250, 252] as [number, number, number] };
    const drawReportFooter = () => {
      const pageNumber = doc.getNumberOfPages();
      const footerY = doc.internal.pageSize.getHeight() - 14;
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.5);
      doc.line(marginX, footerY - 14, pageWidth - marginX, footerY - 14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text("Pixely Careers • Confidential order report", marginX, footerY);
      doc.text(`Page ${pageNumber}`, pageWidth - marginX, footerY, { align: "right" });
    };

    autoTable(doc, {
      startY: tableStartY,
      head: [[
        "Order ID", "Date", "Client Name", "Type", "Phone",
        "Service", "Revisions / Support", "Designer", "Total Bill", "Remaining",
      ]],
      body: tableData,
      theme: "grid",
      tableWidth: "wrap",
      styles: tableBaseStyles,
      headStyles: tableHeadStyles,
      bodyStyles: tableBodyStyles,
      alternateRowStyles: tableAlternateStyles,
      rowPageBreak: "avoid",
      columnStyles: {
        0: { cellWidth: 64 },
        1: { cellWidth: 58 },
        2: { cellWidth: 92 },
        3: { cellWidth: 48 },
        4: { cellWidth: 76 },
        5: { cellWidth: 132 },
        6: { cellWidth: 62 },
        7: { cellWidth: 72 },
        8: { cellWidth: 66, halign: "right" },
        9: { cellWidth: 72, halign: "right" },
      },
      margin: { left: marginX, right: marginX, bottom: 42 },
      showHead: "everyPage",
      didDrawPage: drawReportFooter,
    });

    const fileSuffix = isSearchActive
      ? `search-results-${format(new Date(), "yyyy-MM-dd")}`
      : activeOrdersTab === "today"
      ? `today-${format(new Date(), "yyyy-MM-dd")}`
      : activeOrdersTab === "all"
      ? `all-${format(new Date(), "yyyy-MM-dd")}`
      : format(new Date(parseInt(selectedYear), parseInt(selectedMonth), 1), "MMMM-yyyy");

    doc.save(`orders-${fileSuffix}.pdf`);
    void recordExport("orders list", "pdf");
  };

  // ── Shared order table (used by Search, Today, and Monthly so they stay identical) ──
  // Phase 2 work statuses. Delivered is offered only when fully paid (server enforces it too).
  const getStatusOptionsFor = (order: OrderRow) => {
    const ws = processOf(order).workStatus;
    const opt = (value: DisplayWorkStatus) => ({ value, label: WORK_STATUS_LABELS[value] });
    const fullyPaid = (order.remainingAmount ?? 0) === 0;
    if (ws === "request" || ws === "canceled") return [];
    if (isDesigner) {
      if (ws === "delivered" || ws === "closed") return [];
      if (ws === "draft_sent" || ws === "revisions") return [opt("draft_sent"), opt("revisions"), ...(fullyPaid ? [opt("delivered")] : [])];
      return [opt("confirmed"), opt("in_progress"), opt("draft_sent"), ...(fullyPaid ? [opt("delivered")] : [])];
    }
    const opts = [opt("confirmed"), opt("in_progress"), opt("draft_sent"), opt("revisions"), ...(fullyPaid || ws === "delivered" || ws === "closed" ? [opt("delivered")] : [])];
    return isAdmin ? [...opts, opt("canceled")] : opts;
  };

  const renderWorkStatusCell = (order: OrderRow) => {
    const p = processOf(order);
    const options = getStatusOptionsFor(order);
    return (
      <div className="flex flex-col items-start gap-1">
        {options.length === 0 ? <WorkStatusBadge status={p.workStatus} /> : (
          <Select
            value={p.workStatus}
            onValueChange={(val) => {
              if (val === p.workStatus) return;
              if (val === "canceled") { setOrderToCancel(order); return; }
              updateOrderMutation.mutate({ id: order.id, updates: { workStatus: val } });
            }}
          >
            <SelectTrigger className="h-auto w-auto gap-1 rounded-md border-0 bg-transparent p-0 px-1 py-1 shadow-none hover:bg-white/5 focus:ring-0" data-testid={`select-status-${order.id}`}>
              <SelectValue><WorkStatusBadge status={p.workStatus} /></SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800">
              {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
    );
  };

  // Columns: Order · Client · Package · Work status · Payment status · Designer · Due · Amount
  const orderColSpan = 6 + (!isDesigner ? 2 : 0) + (canSeeAmounts ? 1 : 0);
  const packageText = (order: OrderWithServices) =>
    order.packageType && order.packageType !== "custom"
      ? packageLabels[order.packageType] || titleCase(order.packageType)
      : getServicesDisplay(order);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  const orderTableHead = (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead>Order</TableHead>
        <TableHead>Client</TableHead>
        <TableHead>Package</TableHead>
        <TableHead>Work status</TableHead>
        {!isDesigner && <TableHead>Payment</TableHead>}
        {!isDesigner && <TableHead>Designer</TableHead>}
        <TableHead>Due</TableHead>
        {canSeeAmounts && <TableHead className="text-right">Amount</TableHead>}
        <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
      </TableRow>
    </TableHeader>
  );

  const renderDue = (order: OrderRow, className?: string) => {
    const p = processOf(order);
    const due = dueLabel(p);
    if (!due || p.workStatus === "canceled" || p.workStatus === "request") return <span className={cn("text-slate-500", className)}>—</span>;
    const closed = p.workStatus === "delivered" || p.workStatus === "closed";
    return (
      <span
        className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium",
          p.overdue ? "bg-rose-500/10 text-rose-400" : closed ? "text-slate-500" : "bg-slate-900 text-slate-300", className)}
        title={p.dueStored ? "Due date" : "Estimated from the order date and package"}
        data-testid={`text-due-${order.id}`}
      >
        {p.overdue ? `Overdue · ${due}` : due}{!p.dueStored && !p.overdue ? "*" : ""}
      </span>
    );
  };

  const renderRowMenu = (order: OrderWithServices) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9 text-slate-500" onClick={stop} aria-label="Order actions" data-testid={`button-menu-${order.id}`}>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={stop}>
        <DropdownMenuItem onClick={() => openOrderDetails(order)} data-testid={`menu-view-details-${order.id}`}><FileText className="mr-2 h-4 w-4" />View details</DropdownMenuItem>
        {(isAdmin || isSupport) && <DropdownMenuItem onClick={() => setAssignOrder(order)} data-testid={`button-assign-${order.id}`}><UserPlus className="mr-2 h-4 w-4" />Assign designer</DropdownMenuItem>}
        {(isAdmin || isSupport) && (
          <DropdownMenuItem disabled={!order.assignedToId} onClick={() => { setSelectedOrder(order); setComplaintDialogOpen(true); }} data-testid={`button-complaint-${order.id}`}>
            <FileWarning className="mr-2 h-4 w-4" />Raise complaint
          </DropdownMenuItem>
        )}
        {isAdmin && <DropdownMenuItem onClick={() => { setOrderToEdit(order); setEditSheetOpen(true); }} data-testid={`menu-edit-${order.id}`}><Pencil className="mr-2 h-4 w-4" />Edit order</DropdownMenuItem>}
        {isAdmin && order.status !== "canceled" && <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => { setOrderToCancel(order); setCancellationReason(""); setAdvanceDisposition(""); }} className="text-red-500" data-testid={`menu-cancel-${order.id}`}><XCircle className="mr-2 h-4 w-4" />Cancel order</DropdownMenuItem>
        </>}
        {isAdmin && <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => { setOrderToDelete(order); setDeleteConfirmText(""); }} className="text-red-500" data-testid={`menu-delete-${order.id}`}><Trash2 className="mr-2 h-4 w-4" />Delete order</DropdownMenuItem>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderOrderRow = (order: OrderWithServices) => (
    <TableRow
      key={order.id}
      className="cursor-pointer"
      onClick={() => openOrderDetails(order)}
      onKeyDown={(e) => { if (e.key === "Enter") openOrderDetails(order); }}
      tabIndex={0}
      data-testid={`row-order-${order.id}`}
    >
      <TableCell className="whitespace-nowrap">
        <p className="font-mono text-xs font-medium text-primary">{order.orderNumber || "—"}</p>
        <p className="mt-0.5 text-xs text-slate-500">{order.createdAt ? format(new Date(order.createdAt), "MMM dd") : ""}</p>
      </TableCell>
      <TableCell className="min-w-40">
        <p className="font-medium text-slate-100">{order.clientName || "—"}</p>
        <p className="text-xs text-slate-500">{order.clientPhone || ""}</p>
      </TableCell>
      <TableCell className="max-w-56 text-sm text-slate-300"><span className="line-clamp-2">{packageText(order)}</span></TableCell>
      <TableCell className="whitespace-nowrap" onClick={stop}>{renderWorkStatusCell(order)}</TableCell>
      {!isDesigner && <TableCell className="whitespace-nowrap"><PaymentStateBadge state={processOf(order).paymentState} /></TableCell>}
      {!isDesigner && (
        <TableCell className="whitespace-nowrap">
          <span className={cn("text-sm", order.assignee ? "text-slate-300" : "text-slate-500")}>{order.assignee?.name || "Unassigned"}</span>
        </TableCell>
      )}
      <TableCell className="whitespace-nowrap">{renderDue(order)}</TableCell>
      {canSeeAmounts && (
        <TableCell className="whitespace-nowrap text-right">
          <p className={cn("font-medium", order.status === "canceled" ? "text-slate-500 line-through" : "text-slate-100")}>{formatRs(order.totalPrice)}</p>
          {order.status !== "canceled" && getOrderAccounting(order).remainingReceivable > 0 && <p className="text-xs text-rose-400">{formatRs(getOrderAccounting(order).remainingReceivable)} due</p>}
        </TableCell>
      )}
      <TableCell className="text-right" onClick={stop}>{renderRowMenu(order)}</TableCell>
    </TableRow>
  );

  // Phone layout: one card per order, whole card opens the drawer.
  const renderOrderCard = (order: OrderWithServices) => {
    const p = processOf(order as OrderRow);
    return (
      <div
        key={order.id}
        role="button"
        tabIndex={0}
        onClick={() => openOrderDetails(order)}
        onKeyDown={(e) => { if (e.key === "Enter") openOrderDetails(order); }}
        className="rounded-xl border border-border bg-card p-4 active:bg-[hsl(var(--surface-2))]"
        data-testid={`card-order-${order.id}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs font-medium text-primary">{order.orderNumber || "—"}</p>
            <p className="mt-1 truncate text-[15px] font-medium text-slate-100">{order.clientName || "—"}</p>
            <p className="truncate text-xs text-slate-500">{packageText(order)}</p>
          </div>
          <div className="flex shrink-0 items-start gap-1" onClick={stop}>
            {canSeeAmounts && <p className="pt-2 text-sm font-semibold text-slate-100">{formatRs(order.totalPrice)}</p>}
            {renderRowMenu(order)}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <WorkStatusBadge status={p.workStatus} />
          {!isDesigner && <PaymentStateBadge state={p.paymentState} />}
          {renderDue(order as OrderRow)}
          {!isDesigner && order.assignee?.name && <span className="ml-auto text-xs text-slate-500">{order.assignee.name}</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="crm-page space-y-5">
      {deepLinkMessage && <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100"><span>{deepLinkMessage}</span><Button variant="ghost" size="sm" onClick={() => { setDeepLinkMessage(null); setLocation("/orders"); }}>Clear link</Button></div>}

      <PageHeader
        title="Orders"
        actions={<>
          {isAdmin && (
            <Button variant="outline" onClick={exportOrdersPDF} className="hidden sm:inline-flex" data-testid="button-export-orders">
              <Download className="h-4 w-4" />Export
            </Button>
          )}
        </>}
      />

      {canCreateOrder && (
        <Dialog
          open={createDialogOpen}
          onOpenChange={(open) => {
            setCreateDialogOpen(open);
            if (!open) {
              setCreateOrderType(null);
              if (new URLSearchParams(locationSearch).get("new")) setLocation("/orders");
            }
          }}
        >
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl">
                {createOrderType ? ORDER_SERVICE_TYPE_TITLES[createOrderType] : "Choose service"}
              </DialogTitle>
            </DialogHeader>
            {createOrderType ? (
              <CreateOrderForm
                designers={availableDesigners}
                orderType={createOrderType}
                onBack={() => setCreateOrderType(null)}
                onSuccess={() => setCreateDialogOpen(false)}
              />
            ) : (
              <ServiceTypeSelector onSelect={setCreateOrderType} />
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* View switch: placed orders vs. requests waiting for payment */}
      {(isAdmin || isSupport) && (
        <div className="inline-flex rounded-lg border border-border bg-[hsl(var(--surface-2))] p-1" role="tablist" aria-label="Order view">
          {(["orders", "requests"] as const).map(v => (
            <button
              key={v}
              role="tab"
              aria-selected={orderView === v}
              onClick={() => setOrderView(v)}
              className={cn("min-h-9 rounded-md px-4 text-sm font-medium", orderView === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              data-testid={v === "orders" ? "tab-orders" : "tab-order-requests"}
            >
              {v === "orders" ? "Orders" : "Requests"}
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2" data-testid="order-filters">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[260px] sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="Search order ID, client or phone"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-orders"
          />
          {isSearchSettling && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-500" data-testid="icon-search-loading" />}
        </div>

        {orderView === "orders" && <>
          <Select value={orderPeriod} onValueChange={(v) => setOrderPeriod(v as OrderPeriod)}>
            <SelectTrigger className="w-[170px]" data-testid="select-order-period" aria-label="Date">
              <CalendarIcon className="h-4 w-4 shrink-0 text-slate-500" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="month">{orderPeriod === "month" && !isCurrentMonth ? "Month" : "This month"}</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          {orderPeriod === "month" && <>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[130px]" data-testid="select-month" aria-label="Month"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }).map((_, i) => <SelectItem key={i} value={i.toString()}>{format(new Date(2026, i, 1), "MMMM")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-[92px]" data-testid="select-year" aria-label="Year"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map(year => <SelectItem key={year} value={year.toString()}>{year}</SelectItem>)}
              </SelectContent>
            </Select>
          </>}

          <Select value={selectedStatusFilter} onValueChange={setSelectedStatusFilter}>
            <SelectTrigger className="w-[150px]" data-testid="select-order-status-filter" aria-label="Status"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {ORDER_STATUS_FILTERS.map(filter => <SelectItem key={filter.value} value={filter.value}>{filter.label}</SelectItem>)}
            </SelectContent>
          </Select>

          {(isAdmin || isSupport) && (
            <Select value={selectedDesignerFilter} onValueChange={setSelectedDesignerFilter}>
              <SelectTrigger className="w-[150px]" data-testid="select-order-designer-filter" aria-label="Designer"><SelectValue placeholder="All designers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All designers</SelectItem>
                {designerFilterOptions.map(designer => <SelectItem key={designer.id} value={designer.id.toString()}>{designer.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          <Select value={selectedServiceTypeFilter} onValueChange={setSelectedServiceTypeFilter}>
            <SelectTrigger className="w-[160px]" data-testid="select-order-service-type-filter" aria-label="Service"><SelectValue placeholder="All services" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All services</SelectItem>
              {ORDER_SERVICE_TYPE_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{ORDER_SERVICE_TYPE_FILTER_LABELS[option.value]}</SelectItem>)}
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="button-saved-filters"><Bookmark className="h-4 w-4" />Saved</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              {savedFilters.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No saved filters yet.</p>}
              {savedFilters.map(f => (
                <DropdownMenuItem key={f.name} onClick={() => applySavedFilter(f)} className="justify-between gap-2">
                  <span className="truncate">{f.name}</span>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${f.name}`}
                    onClick={(e) => { e.stopPropagation(); removeSavedFilter(f.name); }}
                  ><X className="h-3.5 w-3.5" /></button>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={saveCurrentFilter}><Plus className="mr-2 h-4 w-4" />Save current filters…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {hasActiveOrderFilters && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setSelectedStatusFilter("all"); setSelectedDesignerFilter("all"); setSelectedServiceTypeFilter("all"); }}
              className="text-slate-500"
              data-testid="button-clear-order-filters"
            >
              <X className="h-4 w-4" />Clear
            </Button>
          )}
        </>}
      </div>

      {isAdmin && orderView === "orders" && orderPeriod === "month" && !isSearchActive && orderSummary && (
        <p className="text-sm text-slate-500" data-testid="text-monthly-revenue">
          {orderSummary.monthCount} orders · {formatRs(orderSummary.monthSales)} sales · {formatRs(orderSummary.monthCollected)} collected · {formatRs(orderSummary.monthRemaining)} remaining
        </p>
      )}

      {orderView === "requests" && (isAdmin || isSupport) ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="table-scroll-wrapper">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Requested</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Created by</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((order: OrderRow) => (
                  <TableRow key={order.id} data-testid={`row-request-${order.id}`}>
                    <TableCell className="whitespace-nowrap text-sm text-slate-400">{order.createdAt ? format(new Date(order.createdAt), "MMM dd · h:mm a") : "—"}</TableCell>
                    <TableCell><p className="text-sm font-medium text-slate-100">{order.clientName}</p><p className="text-xs text-slate-500">{order.clientPhone || ""}</p></TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-slate-400">{getCreatedByLabel(order).split(" (")[0]}</TableCell>
                    <TableCell><AdvancePaymentStatusBadge status={order.advancePaymentStatus} /></TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium text-slate-100">{formatRs(order.totalPrice)}</TableCell>
                    <TableCell className="text-right">
                      {isAdmin ? (
                        <Button size="sm" variant="outline" disabled={approvePayLaterMutation.isPending} onClick={() => approvePayLaterMutation.mutate(order.id)} data-testid={`button-approve-pay-later-${order.id}`}>
                          Approve pay later
                        </Button>
                      ) : <span className="text-xs text-slate-500">Waiting for admin</span>}
                    </TableCell>
                  </TableRow>
                ))}
                {pageRows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-slate-500" data-testid="text-no-requests">No open requests.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className={cn("hidden overflow-hidden rounded-xl border border-border bg-card md:block", listFetching && "opacity-80")} data-testid={isSearchActive ? "panel-search-results" : "panel-orders"}>
            <div className="table-scroll-wrapper">
              <Table className="crm-table">
                {orderTableHead}
                <TableBody>
                  {pageRows.map((order) => renderOrderRow(order))}
                  {pageRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={orderColSpan} className="py-12 text-center text-slate-500" data-testid={isSearchActive ? "text-no-search-results" : "text-no-orders"}>
                        {hasActiveOrderFilters ? "No orders match these filters." : isSearchActive ? "No matching orders." : "No orders for this period."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden" data-testid="orders-cards">
            {pageRows.map(order => renderOrderCard(order))}
            {pageRows.length === 0 && <p className="rounded-xl border border-border bg-card py-10 text-center text-sm text-slate-500">{isSearchActive ? "No matching orders." : "No orders for this period."}</p>}
          </div>
        </>
      )}

      {totalRows > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 text-sm text-slate-500 sm:flex-row" data-testid="orders-pagination">
          <span data-testid="text-search-result-count">
            {(page - 1) * ORDERS_PAGE_SIZE + 1}–{Math.min(page * ORDERS_PAGE_SIZE, totalRows)} of {totalRows}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || listFetching} onClick={() => setPage(p => Math.max(1, p - 1))} data-testid="button-orders-prev">Previous</Button>
            <span className="tabular-nums">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages || listFetching} onClick={() => setPage(p => Math.min(totalPages, p + 1))} data-testid="button-orders-next">Next</Button>
          </div>
        </div>
      )}

      {/* Mobile sticky primary action */}
      {canCreateOrder && (
        <Button
          onClick={() => setCreateDialogOpen(true)}
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-30 h-12 rounded-full px-5 shadow-lg shadow-[hsl(var(--shadow)/.25)] lg:hidden"
          data-testid="button-create-order-mobile"
        >
          <Plus className="h-5 w-5" />New order
        </Button>
      )}

      {/* One assign dialog for all rows */}
      <Dialog open={Boolean(assignOrder)} onOpenChange={(open) => { if (!open) setAssignOrder(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Assign designer</DialogTitle>{assignOrder && <DialogDescription>{assignOrder.orderNumber} · {assignOrder.clientName}</DialogDescription>}</DialogHeader>
          {assignOrder && (
            <Select
              defaultValue={assignOrder.assignedToId?.toString()}
              onValueChange={(val) => { updateOrderMutation.mutate({ id: assignOrder.id, updates: { assignedToId: parseInt(val) } }); setAssignOrder(null); }}
            >
              <SelectTrigger data-testid="select-assign-designer"><SelectValue placeholder="Select designer" /></SelectTrigger>
              <SelectContent>
                {availableDesigners.map(designer => <SelectItem key={designer.id} value={designer.id.toString()}>{designer.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </DialogContent>
      </Dialog>

      <Sheet open={detailsSheetOpen} onOpenChange={open => { if (!open) closeDrawer(); }}>
        <SheetContent className="detail-drawer bg-slate-950 border-slate-800 w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="detail-drawer-header border-b border-slate-800 pb-5 pr-8 text-left">
            <SheetTitle className="text-white font-display flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                {activeDrawer?.kind !== "order" && <Button variant="ghost" size="icon" className="h-8 w-8 -ml-2" onClick={goBackInDrawer} aria-label="Back to order details"><ArrowLeft className="h-4 w-4" /></Button>}
                <FileText className="w-5 h-5" />
                {activeDrawer?.kind === "complaint" ? "Complaint Details" : activeDrawer?.kind === "review" ? "Review Details" : activeDrawer?.kind === "suggestion" ? "Suggestion Details" : "Order Details"}
              </span>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white" onClick={closeDrawer} aria-label="Close order details" data-testid="button-close-order-details">
                <X className="h-4 w-4" />
              </Button>
            </SheetTitle>
          </SheetHeader>
          {selectedOrder && activeDrawer?.kind === "order" && (
            <div className="detail-drawer-body mt-8 space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2 pr-8">
                  <span className="text-2xl font-bold text-blue-400 font-mono">{selectedOrder.orderNumber || "Request"}</span>
                  <span className="flex items-center gap-1.5">
                    <WorkStatusBadge status={processOf(selectedOrder as OrderRow).workStatus} />
                    {!isDesigner && <PaymentStateBadge state={processOf(selectedOrder as OrderRow).paymentState} />}
                  </span>
                </div>
                <p className="text-slate-400 text-sm">Created {format(new Date(selectedOrder.createdAt!), "MMMM dd, yyyy 'at' h:mm a")}</p>
                <Button size="sm" variant="outline" disabled={clientCaseReportMutation.isPending} onClick={() => clientCaseReportMutation.mutate(selectedOrder.id)}><Download className="mr-2 h-4 w-4" />{clientCaseReportMutation.isPending ? "Preparing report…" : "Client Case Report"}</Button>
              </div>

              <div className="detail-section detail-section-emphasis">
                <h4 className="detail-section-label">Order Summary</h4>
                <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div><p className="text-xs text-slate-500">Order ID</p><p className="mt-1 font-mono text-sm text-white">{selectedOrder.orderNumber}</p></div>
                  <div><p className="text-xs text-slate-500">Status</p><p className="mt-1 text-sm text-white">{WORK_STATUS_LABELS[processOf(selectedOrder as OrderRow).workStatus]}</p></div>
                  <div>
                    <p className="text-xs text-slate-500">Due</p>
                    {(() => { const p = processOf(selectedOrder as OrderRow); return (
                      <p className={cn("mt-1 text-sm", p.overdue ? "font-semibold text-rose-400" : "text-white")} title={p.dueStored ? undefined : "Estimated from the order date and package"}>
                        {p.dueAt ? format(new Date(p.dueAt), "MMM dd, yyyy") : "—"}{p.overdue ? " · Overdue" : ""}{p.dueAt && !p.dueStored ? " (est.)" : ""}
                      </p>
                    ); })()}
                  </div>
                  <div><p className="text-xs text-slate-500">Payment</p><p className="mt-1 text-sm text-white">{PAYMENT_STATE_LABELS[processOf(selectedOrder as OrderRow).paymentState]}</p></div>
                  <div><p className="text-xs text-slate-500">Created</p><p className="mt-1 text-sm text-white">{format(selectedOrder.createdAt ? new Date(selectedOrder.createdAt) : new Date(), "MMM dd, yyyy · h:mm a")}</p></div>
                  <div><p className="text-xs text-slate-500">Created By</p><p className="mt-1 text-sm text-white">{getCreatedByLabel(selectedOrder).split(" (")[0]}</p><p className="mt-0.5 text-xs text-slate-500">{getCreatedByLabel(selectedOrder).match(/\(([^)]+)\)/)?.[1] || ""}</p></div>
                </div>
              </div>

              <Tabs value={detailsTab} onValueChange={value => setOrderDrawerTab(value as OrderDrawerTab)}>
                <TabsList className="grid h-auto w-full grid-cols-4 p-1">
                  <TabsTrigger value="overview" className="min-h-9 text-xs sm:text-sm">Overview</TabsTrigger>
                  <TabsTrigger value="services" className="min-h-9 text-xs sm:text-sm">Services & files</TabsTrigger>
                  <TabsTrigger value="payments" className="min-h-9 text-xs sm:text-sm">Payments</TabsTrigger>
                  <TabsTrigger value="activity" className="min-h-9 text-xs sm:text-sm">Activity</TabsTrigger>
                </TabsList>
              </Tabs>

              {detailsTab === "overview" && <>
              <div className="space-y-3 p-4 bg-slate-950 rounded-lg border border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Client Information</h4>
                  <WhatsAppQuickReply
                    phone={selectedOrder.clientPhone}
                    testId="button-order-whatsapp"
                    vars={{
                      name: (selectedOrder.clientName || "").split(" ")[0],
                      order: selectedOrder.orderNumber || "",
                      amount: selectedOrder.advanceAmount ? rupees(selectedOrder.advanceAmount) : "",
                      balance: selectedOrder.remainingAmount ? rupees(selectedOrder.remainingAmount) : "",
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-slate-500">Name</p>
                    {(user?.role === "admin" || user?.role === "support") && pkPhoneKey(selectedOrder.clientPhone) ? (
                      <Link href={`/clients/${pkPhoneKey(selectedOrder.clientPhone)}`} className="font-medium text-white hover:text-primary hover:underline" data-testid="link-order-client-profile">{selectedOrder.clientName}</Link>
                    ) : (
                      <p className="text-white font-medium">{selectedOrder.clientName}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Client Type</p>
                    <p className="text-white">{selectedOrder.clientType === "international" ? "International Client" : "National Client"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Contact</p>
                    {selectedOrder.clientPhone ? (
                      <div className="flex items-center gap-2">
                        <p className="text-white">{selectedOrder.clientPhone}</p>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-slate-400 hover:text-white"
                          onClick={() => copyPhone(selectedOrder.id, selectedOrder.clientPhone!)}
                        >
                          {copiedPhone === selectedOrder.id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-slate-500">-</p>
                    )}
                  </div>
                  {selectedOrder.clientEmail && (
                    <div className="col-span-2">
                      <p className="text-xs text-slate-500">Email</p>
                      <p className="text-white">{selectedOrder.clientEmail}</p>
                    </div>
                  )}
                  {selectedOrder.platform && (
                    <div className="col-span-2">
                      <p className="text-xs text-slate-500">Client Source</p>
                      <p className="text-white capitalize">{selectedOrder.platform}</p>
                    </div>
                  )}
                </div>
              </div>

              </>}

              {detailsTab === "services" && <>
              <div className="space-y-3 p-4 bg-slate-950 rounded-lg border border-slate-800">
                <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Services</h4>
                {selectedOrder.packageType && selectedOrder.packageType !== "custom" && (
                  <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-sm px-3 py-1">
                    {packageLabels[selectedOrder.packageType] || selectedOrder.packageType}
                  </Badge>
                )}
                {selectedOrder.services.length > 0 ? (
                  <div>
                    {selectedOrder.services.map(service => (
                      <DeliverableLinkRow
                        key={service.id}
                        service={service}
                        label={selectedOrder.packageType && selectedOrder.packageType !== "custom" ? `+ ${service.serviceType}` : service.serviceType}
                        quantity={service.quantity}
                        instructions={service.instructions}
                        isSaving={updateOrderServiceLinkMutation.isPending}
                        onSave={(id, link) => updateOrderServiceLinkMutation.mutate({ id, orderId: selectedOrder.id, deliverableLink: link })}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No services selected.</p>
                )}
              </div>

              </>}

              {detailsTab === "overview" && <>
              <div className="space-y-3 p-4 bg-slate-950 rounded-lg border border-slate-800">
                <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Assignment</h4>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-lg text-slate-400">
                    {selectedOrder.assignee?.name?.charAt(0) || "?"}
                  </div>
                  <div>
                    <p className="text-white font-medium">{selectedOrder.assignee?.name || "Unassigned"}</p>
                    <p className="text-xs text-slate-500">{selectedOrder.assignee?.title || "Designer"}</p>
                  </div>
                </div>
              </div>

              {(selectedOrder.orderType !== "resume_distribution" || selectedOrder.supportPeriod) && (
                <div className="space-y-3 p-4 bg-slate-950 rounded-lg border border-slate-800">
                  <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Order Settings</h4>
                  <div className="grid grid-cols-2 gap-4">
                    {selectedOrder.orderType !== "resume_distribution" && (
                      <div>
                        <p className="text-xs text-slate-500">Revisions Remaining</p>
                        <p className={getSupportStatusInfo(selectedOrder)?.status === "expired" ? "text-slate-500 line-through" : "text-white"}>
                          {selectedOrder.remainingRevisions != null
                            ? `${selectedOrder.remainingRevisions} Revision${selectedOrder.remainingRevisions === 1 ? "" : "s"}`
                            : selectedOrder.numberOfRevisions
                            ? `${selectedOrder.numberOfRevisions} Revision${selectedOrder.numberOfRevisions === 1 ? "" : "s"}`
                            : "Not Specified"}
                        </p>
                        {selectedOrder.numberOfRevisions != null && selectedOrder.remainingRevisions != null && selectedOrder.remainingRevisions !== selectedOrder.numberOfRevisions && (
                          <p className="text-xs text-slate-500">of {selectedOrder.numberOfRevisions} original</p>
                        )}
                      </div>
                    )}
                    {isAdmin && selectedOrder.orderType !== "resume_distribution" && (
                      <div>
                        <p className="text-xs text-slate-500">Set remaining revisions</p>
                        <Select
                          value={selectedOrder.remainingRevisions != null ? String(selectedOrder.remainingRevisions) : undefined}
                          onValueChange={(val) => updateOrderMutation.mutate({ id: selectedOrder.id, updates: { remainingRevisions: parseInt(val) } })}
                        >
                          <SelectTrigger className="mt-1" data-testid={`select-revisions-${selectedOrder.id}`}><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            {getRemainingRevisionOptions(selectedOrder.numberOfRevisions).map(n => <SelectItem key={n} value={n}>{n} Revision{n === "1" ? "" : "s"}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-slate-500">Support Period</p>
                      {selectedOrder.supportPeriod ? <SupportPeriodCell order={selectedOrder} /> : <p className="text-white">Not Specified</p>}
                    </div>
                  </div>
                </div>
              )}

              </>}

              {detailsTab === "payments" && !canSeeAmounts && <p className="py-8 text-center text-sm text-slate-500">Payment details are not shown for your role.</p>}
              {detailsTab === "payments" && <>
              {canSeeAmounts && (
                <div className="space-y-3 p-4 bg-slate-950 rounded-lg border border-slate-800">
                  <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Payment</h4>
                  <div className="grid grid-cols-3 gap-4">
                    {canSeeFinance && (
                      <div>
                        <p className="text-xs text-slate-500">Total</p>
                        <p className="text-white font-medium">₨{Math.round((selectedOrder.totalPrice || 0) / 100).toLocaleString()}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-slate-500">Advance</p>
                      <p className={selectedOrder.status === "canceled" && selectedOrder.advanceRefunded ? "font-medium text-slate-500 line-through" : "text-green-400 font-medium"}>₨{Math.round((selectedOrder.advanceAmount || 0) / 100).toLocaleString()} {selectedOrder.status === "canceled" && <span className={`ml-1 text-xs ${selectedOrder.advanceRefunded ? "text-rose-400" : "text-amber-300"}`}>{selectedOrder.advanceRefunded ? "Refunded" : "Retained"}</span>}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Remaining</p>
                      <p className={selectedOrder.status === "canceled" ? "font-medium text-slate-500 line-through" : "text-red-400 font-medium"}>₨{Math.round((selectedOrder.remainingAmount || 0) / 100).toLocaleString()} {selectedOrder.status === "canceled" && <span className="no-underline text-xs text-rose-400">Canceled</span>}</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-800">
                    <Badge variant="outline" className={selectedOrder.paymentStatus === 'paid' ? "text-green-500 border-green-500/30" : "text-yellow-500 border-yellow-500/30"}>
                      {selectedOrder.paymentStatus === 'paid' ? "Paid" : "Payment Pending"}
                    </Badge>
                    {isAdmin && (
                      <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-slate-500" data-testid="order-meta-status">
                        Meta:
                        {selectedOrder.metaStatus === "sent" ? <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200">Sent ✓</Badge>
                          : selectedOrder.metaStatus === "test" ? <Badge variant="outline" className="border-slate-600 bg-slate-800/70 text-slate-300">Test ✓</Badge>
                          : selectedOrder.metaStatus === "pending" ? <span className="text-slate-400">Sending…</span>
                          : selectedOrder.metaStatus === "failed" ? <button type="button" disabled={metaRetryMutation.isPending} onClick={() => metaRetryMutation.mutate(selectedOrder.id)} className="rounded-md border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 font-medium text-rose-200 hover:bg-rose-400/20" data-testid="button-order-meta-retry">Failed · Retry</button>
                          : <span>—</span>}
                      </span>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-3">
                      <p className="text-xs text-slate-500">Advance payment</p>
                      <Select value={selectedOrder.advancePaymentStatus || "pending"} onValueChange={(val) => updateOrderMutation.mutate({ id: selectedOrder.id, updates: { advancePaymentStatus: val } })}>
                        <SelectTrigger className="w-40" data-testid={`select-adv-payment-${selectedOrder.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="disapproved">Disapproved</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {(isAdmin || isSupport) && selectedOrder.advancePaymentStatus === "approved" && (
                    <div className="border-t border-slate-800 pt-3">
                      <OrderRefunds orderId={selectedOrder.id} isAdmin={isAdmin} canRequest={isAdmin || isSupport} />
                    </div>
                  )}
                  {selectedOrder.status === "canceled" && <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-3 text-sm"><div><p className="text-xs text-slate-500">Net Collected</p><p className="mt-1 font-medium text-white">{formatRs(selectedOrder.advanceRefunded ? 0 : selectedOrder.advanceAmount)}</p></div><div><p className="text-xs text-slate-500">Remaining Receivable</p><p className="mt-1 font-medium text-white">Rs0</p></div><div className="col-span-2"><p className="text-xs text-slate-500">Cancellation Reason</p><p className="mt-1 text-slate-300">{selectedOrder.cancellationReason || "Legacy cancellation — reason not recorded."}</p></div></div>}
                </div>
              )}

              </>}

              {detailsTab === "overview" && <>
              {!isDesigner && (selectedOrder.campaign || selectedOrder.adSet || selectedOrder.creative) && (
                <div className="space-y-3 p-4 bg-slate-950 rounded-lg border border-slate-800">
                  <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Marketing Data</h4>
                  <div className="space-y-2">
                    {selectedOrder.campaign && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Campaign</span>
                        <span className="text-white">{selectedOrder.campaign}</span>
                      </div>
                    )}
                    {selectedOrder.adSet && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Ad Set</span>
                        <span className="text-white">{selectedOrder.adSet}</span>
                      </div>
                    )}
                    {selectedOrder.creative && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Creative</span>
                        <span className="text-white">{selectedOrder.creative}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedOrder.notes && (
                <div className="space-y-3 p-4 bg-slate-950 rounded-lg border border-slate-800">
                  <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Notes</h4>
                  <p className="text-slate-300 text-sm whitespace-pre-wrap">{selectedOrder.notes}</p>
                </div>
              )}

              {selectedOrder.internalNotes && (isAdmin || isSupport) && (
                <div className="space-y-3 p-4 bg-slate-950 rounded-lg border border-slate-800">
                  <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Internal Notes</h4>
                  <p className="text-slate-300 text-sm whitespace-pre-wrap">{selectedOrder.internalNotes}</p>
                </div>
              )}

              {selectedOrder.readyDate && (
                <div className="text-xs text-slate-500 flex items-center gap-1">
                  <History className="w-3 h-3" />
                  Ready on {format(new Date(selectedOrder.readyDate), "MMM dd, yyyy")}
                </div>
              )}
              </>}

              {detailsTab === "activity" && (
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                  <div className="mb-5 flex items-center gap-2">
                    <History className="h-4 w-4 text-blue-400" />
                    <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Chronological History</h4>
                  </div>
                  {selectedOrderActivity.length ? (
                    <div className="space-y-5">
                      {selectedOrderActivity.map(entry => {
                        const details = (entry.details || {}) as Record<string, unknown>;
                        const related = entry.activityType.startsWith("complaint") ? { kind: "complaint" as const, id: Number(details.complaintId) } : entry.activityType.startsWith("review") ? { kind: "review" as const, id: Number(details.reviewId) } : entry.activityType.startsWith("suggestion") ? { kind: "suggestion" as const, id: Number(details.suggestionId) } : null;
                        return <div key={entry.id} className="relative border-l border-slate-700 pl-5">
                          <span className="absolute -left-1.5 top-1 h-3 w-3 rounded-full border-2 border-slate-950 bg-blue-500" />
                          <p className="text-sm text-slate-200">{orderActivityLabel(entry)}</p>
                          {related && Number.isInteger(related.id) && related.id > 0 && <button onClick={() => openNestedDrawer(related)} className="mt-1 font-mono text-xs text-blue-400 hover:underline">Open {String(details.complaintNumber || details.reviewNumber || details.suggestionNumber || "related record")}</button>}
                          <p className="mt-1 text-xs text-slate-500">
                            {entry.actor?.name || "System"} · {entry.createdAt ? format(new Date(entry.createdAt), "MMM dd, yyyy h:mm a") : "—"}
                          </p>
                        </div>
                      })}
                    </div>
                  ) : (
                    <p className="py-10 text-center text-sm text-slate-500">No recorded activity is available for this order yet.</p>
                  )}
                </div>
              )}

              {detailsTab === "overview" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-center"><p className="text-2xl font-bold text-white">{selectedOrderComplaints.length}</p><p className="mt-1 text-xs text-slate-500">Complaints</p></div>
                     <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-center"><p className="text-2xl font-bold text-amber-400">{selectedOrderReviews[0]?.rating ? `${selectedOrderReviews[0].rating}/5` : "—"}</p><p className="mt-1 text-xs text-slate-500">Client Rating</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-center"><p className="text-2xl font-bold text-blue-400">{selectedOrderSuggestions.length}</p><p className="mt-1 text-xs text-slate-500">Suggestions</p></div>
                  </div>

                  <section className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div><h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Complaints</h4><p className="mt-1 text-xs text-slate-600">{selectedOrderComplaints.filter(item => item.status === "confirmed").length} currently confirmed</p></div>
                      {(isAdmin || isSupport) && <Button size="sm" variant="outline" disabled={!selectedOrder.assignedToId} onClick={() => setComplaintDialogOpen(true)}><FileWarning className="mr-2 h-4 w-4" />Raise Complaint</Button>}
                    </div>
                    <div className="mt-4 space-y-2">{selectedOrderComplaints.length ? selectedOrderComplaints.map(complaint => <button key={complaint.id} onClick={() => openNestedDrawer({ kind: "complaint", id: complaint.id })} className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900 p-3 text-left hover:border-slate-700"><div><p className="font-mono text-xs text-blue-400">{complaint.complaintNumber}</p><p className="mt-1 text-xs text-slate-500">{titleCase(complaint.category)}</p></div><ComplaintStatusBadge status={complaint.status} /></button>) : <p className="py-4 text-sm text-slate-500">No visible complaints.</p>}</div>
                  </section>

                  <section className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <div className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Client Review</h4><p className="mt-1 text-xs text-slate-600">{selectedOrderReviews.length ? "Review collected" : "No review added"}</p></div><Button size="sm" variant="outline" onClick={() => selectedOrderReviews[0] ? openNestedDrawer({ kind: "review", id: selectedOrderReviews[0].id }) : setLocation(`/feedback?order=${selectedOrder.id}&action=review`)}><MessageSquareHeart className="mr-2 h-4 w-4" />{selectedOrderReviews.length ? "View / Update" : "Add Review"}</Button></div>
                    {selectedOrderReviews[0] && <button onClick={() => openNestedDrawer({ kind: "review", id: selectedOrderReviews[0].id })} className="mt-4 w-full rounded-lg border border-slate-800 bg-slate-900 p-3 text-left hover:border-slate-700"><div className="flex items-center justify-between"><p className="font-mono text-xs text-blue-400">{selectedOrderReviews[0].reviewNumber}</p><span className="text-sm font-bold text-amber-400">{selectedOrderReviews[0].rating ? `${selectedOrderReviews[0].rating}/5` : "Not Rated"}</span></div><div className="mt-3 flex flex-wrap gap-2">{selectedOrderReviews[0].whatsappFeedbackReceived && <Badge variant="outline">WhatsApp</Badge>}{selectedOrderReviews[0].facebookReviewReceived && <Badge variant="outline">Facebook</Badge>}{selectedOrderReviews[0].videoReviewReceived && <Badge variant="outline">Video</Badge>}</div></button>}
                  </section>

                  <section className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <div className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Suggestions</h4><p className="mt-1 text-xs text-slate-600">{selectedOrderSuggestions.length} recorded</p></div><Button size="sm" variant="outline" onClick={() => setLocation(`/feedback?order=${selectedOrder.id}&action=suggestion`)}><Lightbulb className="mr-2 h-4 w-4" />Add Suggestion</Button></div>
                    <div className="mt-4 space-y-2">{selectedOrderSuggestions.length ? selectedOrderSuggestions.slice(0, 4).map(suggestion => <button key={suggestion.id} onClick={() => openNestedDrawer({ kind: "suggestion", id: suggestion.id })} className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900 p-3 text-left hover:border-slate-700"><div><p className="font-mono text-xs text-blue-400">{suggestion.suggestionNumber}</p><p className="mt-1 text-xs text-slate-500">Client suggestion</p></div><SuggestionStatusBadge status={suggestion.status} /></button>) : <p className="py-4 text-sm text-slate-500">No suggestions recorded.</p>}</div>
                  </section>
                </div>
              )}
            </div>
          )}
        </SheetContent>
       </Sheet>
       <ComplaintDetails
         id={activeDrawer?.kind === "complaint" ? activeDrawer.id : null}
         open={activeDrawer?.kind === "complaint"}
         onOpenChange={open => { if (!open) goBackInDrawer(); }}
         onBack={goBackInDrawer}
       />
       <ReviewDetails
         review={activeDrawer?.kind === "review"
           ? (selectedOrderReviews.find(item => item.id === activeDrawer.id) as unknown as Review) || null
           : null}
         open={activeDrawer?.kind === "review"}
         onOpenChange={open => { if (!open) goBackInDrawer(); }}
         onBack={goBackInDrawer}
         onEdit={() => setNestedReviewEditOpen(true)}
         onOpenOrder={() => {}}
       />
       <SuggestionDetails
         suggestion={activeDrawer?.kind === "suggestion"
           ? (selectedOrderSuggestions.find(item => item.id === activeDrawer.id) as any) || null
           : null}
         open={activeDrawer?.kind === "suggestion"}
         onOpenChange={open => { if (!open) goBackInDrawer(); }}
         onBack={goBackInDrawer}
         onOpenOrder={() => {}}
         onUpdated={updated => queryClient.setQueryData(
           [`/api/orders/${selectedOrder?.id}/client-suggestions`],
           (current: OrderSuggestion[] | undefined) => current?.map(item => item.id === updated.id ? { ...item, ...updated } : item),
         )}
       />
      <ReviewForm
        review={(selectedOrderReviews.find(item => item.id === (activeDrawer?.kind === "review" ? activeDrawer.id : -1)) as unknown as Review) || null}
        open={nestedReviewEditOpen}
        onOpenChange={open => {
          setNestedReviewEditOpen(open);
          if (!open && selectedOrder) queryClient.invalidateQueries({ queryKey: [`/api/orders/${selectedOrder.id}/client-reviews`] });
        }}
        defaultOrderId={selectedOrder?.id}
      />

      <ComplaintDialog
        order={selectedOrder}
        open={complaintDialogOpen}
        onOpenChange={setComplaintDialogOpen}
      />

      {isAdmin && (
        <Sheet open={editSheetOpen} onOpenChange={(open) => { setEditSheetOpen(open); if (!open) setOrderToEdit(null); }}>
          <SheetContent className="bg-slate-900 border-slate-800 w-full sm:max-w-xl overflow-y-auto">
            <SheetHeader className="pr-8">
              <SheetTitle className="text-white font-display flex items-center gap-2">
                <Pencil className="w-5 h-5" />
                Edit Order {orderToEdit?.orderNumber}
              </SheetTitle>
            </SheetHeader>
            {orderToEdit && (
              <EditOrderForm
                key={orderToEdit.id}
                order={orderToEdit}
                designers={availableDesigners}
                onSuccess={() => { setEditSheetOpen(false); setOrderToEdit(null); }}
              />
            )}
          </SheetContent>
        </Sheet>
      )}

      {isAdmin && (
        <Dialog open={Boolean(orderToCancel)} onOpenChange={open => { if (!open) { setOrderToCancel(null); setCancellationReason(""); setAdvanceDisposition(""); } }}>
          <DialogContent className="w-[calc(100%-2rem)] max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto border-slate-800 bg-slate-900 p-0 text-white">
            <div className="space-y-4 p-5 sm:p-6">
              <DialogHeader className="space-y-1 text-left">
                <DialogTitle className="flex items-center gap-2 text-lg"><XCircle className="h-5 w-5 text-rose-400" />Cancel order</DialogTitle>
                {orderToCancel && <DialogDescription className="text-slate-400">{orderToCancel.orderNumber} · {orderToCancel.clientName}</DialogDescription>}
              </DialogHeader>
              {orderToCancel && <>
                <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Cancellation impact</p>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                    <div><p className="text-xs text-slate-500">Order total</p><p className="mt-1 font-medium text-white">{formatRs(orderToCancel.totalPrice)}</p></div>
                    <div><p className="text-xs text-slate-500">Advance</p><p className="mt-1 font-medium text-white">{formatRs(orderToCancel.advanceAmount)}</p></div>
                    <div><p className="text-xs text-slate-500">Balance closed</p><p className="mt-1 font-medium text-rose-300">{formatRs(orderToCancel.remainingAmount)}</p></div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cancellation-reason">Cancellation reason <span className="text-rose-400">*</span></Label>
                  <Textarea id="cancellation-reason" value={cancellationReason} onChange={event => setCancellationReason(event.target.value)} placeholder="Briefly explain why this order is being canceled." rows={2} className="resize-none border-slate-700 bg-slate-950" />
                  <p className="text-xs text-slate-500">{cancellationReason.trim().length}/3 minimum characters</p>
                </div>
                <div className="space-y-2">
                  <div><Label>Advance handling <span className="text-rose-400">*</span></Label><p className="mt-1 text-xs text-slate-500">Choose how the received advance should be recorded.</p></div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" aria-pressed={advanceDisposition === "refunded"} onClick={() => setAdvanceDisposition("refunded")} className={cn("h-auto min-h-12 justify-between border-slate-700 px-3 py-2 text-left", advanceDisposition === "refunded" && "border-cyan-400/60 bg-cyan-400/10 text-cyan-100")}>
                      <span className="text-xs font-medium">Refund advance</span><span className="font-mono text-xs text-slate-400">{formatRs(orderToCancel.advanceAmount)}</span>
                    </Button>
                    <Button type="button" variant="outline" aria-pressed={advanceDisposition === "retained"} onClick={() => setAdvanceDisposition("retained")} className={cn("h-auto min-h-12 justify-between border-slate-700 px-3 py-2 text-left", advanceDisposition === "retained" && "border-cyan-400/60 bg-cyan-400/10 text-cyan-100")}>
                      <span className="text-xs font-medium">Retain advance</span><span className="font-mono text-xs text-slate-400">{formatRs(orderToCancel.advanceAmount)}</span>
                    </Button>
                  </div>
                </div>
                {advanceDisposition && <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs leading-5 text-slate-400"><span className="font-medium text-slate-200">{advanceDisposition === "refunded" ? "Refund recorded." : "Advance retained."}</span> {advanceDisposition === "refunded" ? "Net collected will become Rs0." : "The advance remains collected."} The balance will be closed.</div>}
                <div className="flex flex-col-reverse gap-2 border-t border-slate-800 pt-4 sm:flex-row sm:justify-end">
                  <Button variant="ghost" onClick={() => setOrderToCancel(null)}>Keep order</Button>
                  <Button className="bg-rose-600 hover:bg-rose-500" disabled={cancelOrderMutation.isPending || cancellationReason.trim().length < 3 || !advanceDisposition} onClick={() => cancelOrderMutation.mutate({ id: orderToCancel.id, reason: cancellationReason.trim(), advanceRefunded: advanceDisposition === "refunded" })}>{cancelOrderMutation.isPending ? "Canceling…" : "Confirm cancellation"}</Button>
                </div>
              </>}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {isAdmin && (
        <Dialog open={!!orderToDelete} onOpenChange={(open) => { if (!open) { setOrderToDelete(null); setDeleteConfirmText(""); } }}>
          <DialogContent className="bg-slate-900 border-slate-800 max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white font-display flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-400" />
                Delete Order
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-slate-300 text-sm">
                This will <span className="text-red-400 font-semibold">permanently delete</span> order{" "}
                <span className="font-mono text-white">{orderToDelete?.orderNumber}</span> for{" "}
                <span className="text-white">{orderToDelete?.clientName}</span>, including all its services,
                payment records, and activity history. This action cannot be undone.
              </p>
              <div className="space-y-2">
                <Label className="text-slate-300">
                  Type <span className="font-mono text-white">{orderToDelete?.orderNumber}</span> to confirm
                </Label>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className="bg-slate-950 border-slate-800 text-white"
                  placeholder={orderToDelete?.orderNumber || ""}
                  data-testid="input-delete-confirm"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="ghost"
                  className="text-slate-300 hover:text-white"
                  onClick={() => { setOrderToDelete(null); setDeleteConfirmText(""); }}
                  data-testid="button-delete-cancel"
                >
                  Cancel
                </Button>
                <Button
                  className="bg-red-600 hover:bg-red-700 text-on-color"
                  disabled={
                    deleteOrderMutation.isPending ||
                    !orderToDelete ||
                    deleteConfirmText.trim() !== (orderToDelete?.orderNumber || "")
                  }
                  onClick={() => orderToDelete && deleteOrderMutation.mutate(orderToDelete.id)}
                  data-testid="button-delete-confirm"
                >
                  {deleteOrderMutation.isPending ? "Deleting..." : "Delete Permanently"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function EditOrderForm({ order, designers, onSuccess }: { order: OrderWithServices; designers: User[]; onSuccess: () => void }) {
  const { toast } = useToast();

  const { data: servicesCatalogData = [] } = useQuery<ServiceCatalogItem[]>({
    queryKey: ["/api/services-catalog"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: platformsCatalogData = [] } = useQuery<PlatformCatalogItem[]>({
    queryKey: ["/api/platforms-catalog"],
    staleTime: 5 * 60 * 1000,
  });

  const activeFormServiceTypes = servicesCatalogData.filter(s => s.isActive).map(s => s.name);
  const formServiceTypes = activeFormServiceTypes.length > 0 ? activeFormServiceTypes : FALLBACK_SERVICE_TYPES;
  const activePlatforms = platformsCatalogData.filter(p => p.isActive);
  const orderType = (order.orderType || "documentation") as OrderServiceType;

  const toRupees = (paisa: number | null | undefined) => (paisa ? String(Math.round(paisa / 100)) : "");

  const [clientName, setClientName] = useState(order.clientName || "");
  const [clientPhone, setClientPhone] = useState(order.clientPhone || "");
  const [clientType, setClientType] = useState<"national" | "international">(order.clientType || "national");
  const [assignedToId, setAssignedToId] = useState(order.assignedToId ? String(order.assignedToId) : "");
  const [totalBill, setTotalBill] = useState(toRupees(order.totalPrice));
  const [advanceAmount, setAdvanceAmount] = useState(toRupees(order.advanceAmount));
  const [paymentMethod, setPaymentMethod] = useState<string>(order.paymentMethod || "");
  const [paymentStatus, setPaymentStatus] = useState<string>(order.paymentStatus || "pending");
  const [platform, setPlatform] = useState(order.platform || "");
  const [campaign, setCampaign] = useState(order.campaign || "");
  const [adSet, setAdSet] = useState(order.adSet || "");
  const [creative, setCreative] = useState(order.creative || "");
  const [notes, setNotes] = useState(order.notes || "");
  const [numberOfRevisions, setNumberOfRevisions] = useState(order.numberOfRevisions ? String(order.numberOfRevisions) : "");
  const [supportPeriod, setSupportPeriod] = useState(order.supportPeriod || "");
  const serviceIdRef = useRef(1);
  const nextServiceNumberRef = useRef((order.services?.length || 0) + 1);
  const [services, setServices] = useState<OrderFormService[]>(() => {
    const existing = (order.services || []).map((s, i) => ({
      id: serviceIdRef.current++,
      serviceNumber: i + 1,
      serviceType: s.serviceType || "",
      quantity: s.quantity || 1,
      instructions: s.instructions || "",
    }));
    return existing;
  });
  const customServicesTopRef = useRef<HTMLDivElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const addService = () => {
    setServices((prev) => prependNumberedService(
      prev,
      serviceIdRef.current++,
      nextServiceNumberRef.current++,
    ));
    requestAnimationFrame(() => {
      customServicesTopRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const trigger = customServicesTopRef.current?.querySelector<HTMLButtonElement>('[data-testid^="select-service-type-"]');
      trigger?.focus();
    });
  };

  const removeService = (id: number) => {
    setServices((prev) => prev.filter((s) => s.id !== id));
  };

  const updateService = (id: number, field: string, value: any) => {
    setServices((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const missingFields: string[] = [];
    if (!clientName.trim()) missingFields.push("Client Name");
    if (!clientPhone.trim()) missingFields.push("Phone Number");
    if (!clientType) missingFields.push("Client Type");
    if (orderType === "documentation" && services.every(s => !s.serviceType)) missingFields.push("At least one service");

    if (missingFields.length > 0) {
      toast({ title: "Missing Fields", description: `Please fill: ${missingFields.join(", ")}`, variant: "destructive" });
      return;
    }

    const totalPriceValue = totalBill ? Math.round(parseFloat(totalBill) * 100) : 0;
    const discountValue = order.discountAmount || 0;
    const finalPayableValue = Math.max(0, totalPriceValue - discountValue);
    const advanceValue = advanceAmount ? Math.round(parseFloat(advanceAmount) * 100) : 0;
    const remainingValue = Math.max(0, finalPayableValue - advanceValue);

    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim(),
        clientType,
        assignedToId: assignedToId ? parseInt(assignedToId) : null,
        totalPrice: totalPriceValue,
        discountAmount: discountValue,
        advanceAmount: advanceValue,
        remainingAmount: remainingValue,
        paymentMethod: paymentMethod || null,
        paymentStatus,
        numberOfRevisions: numberOfRevisions ? parseInt(numberOfRevisions) : null,
        supportPeriod: supportPeriod || null,
        platform: platform.trim() || null,
        campaign: campaign.trim() || null,
        adSet: adSet.trim() || null,
        creative: creative.trim() || null,
        notes: notes.trim() || null,
      };
      // Only documentation orders let the team edit the services list here —
      // Portfolio Website / Resume Distribution keep their one fixed service,
      // so omit `services` entirely to avoid replacing (and losing the link on) it.
      if (orderType === "documentation") {
        payload.services = services.filter(s => s.serviceType).map(s => ({
          serviceType: s.serviceType,
          quantity: s.quantity || 1,
          instructions: s.instructions || null,
        }));
      }
      await apiRequest("PATCH", `/api/orders/${order.id}`, payload);

      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "Order Updated", description: `Order ${order.orderNumber} has been updated.` });
      onSuccess();
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to update order", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const remainingDisplay = Math.max(0, (parseInt(totalBill) || 0) - Math.round((order.discountAmount || 0) / 100) - (parseInt(advanceAmount) || 0));

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-6">
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Client Information</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">Client Name *</Label>
            <Input value={clientName} onChange={(e) => setClientName(e.target.value)} className="bg-slate-950 border-slate-800 text-white" placeholder="Enter client name" data-testid="edit-input-client-name" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Phone Number *</Label>
            <Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} className="bg-slate-950 border-slate-800 text-white" placeholder="+92 300 1234567" data-testid="edit-input-client-phone" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Client Type *</Label>
            <Select value={clientType} onValueChange={(value: "national" | "international") => setClientType(value)}>
              <SelectTrigger className="bg-slate-950 border-slate-800 text-white" data-testid="edit-select-client-type">
                <SelectValue placeholder="Select client type" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-white">
                <SelectItem value="national">National Client</SelectItem>
                <SelectItem value="international">International Client</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Assigned Designer</h4>
        <Select value={assignedToId} onValueChange={setAssignedToId}>
          <SelectTrigger className="bg-slate-950 border-slate-800 text-white" data-testid="edit-select-designer">
            <SelectValue placeholder="Select designer" />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-800 text-white">
            {designers.map(d => (
              <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {orderType === "documentation" && (
        <div className="space-y-4" ref={customServicesTopRef}>
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Services *</h4>
              <p className="mt-1 text-xs text-slate-500">Add the services included in this order.</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={addService} className="text-blue-400 hover:text-blue-300" data-testid="edit-button-add-service">
              <Plus className="w-4 h-4 mr-1" /> Add Service
            </Button>
          </div>

          {services.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/60 px-4 py-5 text-sm text-slate-500">
              Add at least one service for this order.
            </div>
          ) : services.map((service, index) => (
            <div key={service.id} className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Service {service.serviceNumber}</span>
                <Button type="button" variant="ghost" size="icon" onClick={() => removeService(service.id)} className="h-6 w-6 text-red-400 hover:text-red-300" data-testid={`edit-button-remove-service-${index}`}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <Select value={service.serviceType} onValueChange={(val) => updateService(service.id, 'serviceType', val)}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white" data-testid={`edit-select-service-type-${index}`}>
                      <SelectValue placeholder="Select service type" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-800 text-white">
                      {formServiceTypes.map(type => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Input type="number" min="1" value={service.quantity} onChange={(e) => updateService(service.id, 'quantity', parseInt(e.target.value) || 1)} onWheel={(e) => e.currentTarget.blur()} className="bg-slate-900 border-slate-700 text-white" placeholder="Qty" data-testid={`edit-input-quantity-${index}`} />
                </div>
              </div>
              <Textarea value={service.instructions} onChange={(e) => updateService(service.id, 'instructions', e.target.value)} className="bg-slate-900 border-slate-700 text-white resize-none" placeholder="Special instructions for this service..." rows={2} data-testid={`edit-input-instructions-${index}`} />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Order Settings</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {orderType !== "resume_distribution" && (
            <div className="space-y-2">
              <Label className="text-slate-300">Number of Revisions</Label>
              <Select value={numberOfRevisions} onValueChange={setNumberOfRevisions}>
                <SelectTrigger className="bg-slate-950 border-slate-800 text-white" data-testid="edit-select-revisions">
                  <SelectValue placeholder="Select revisions" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-white">
                  {REVISION_COUNT_OPTIONS.map(count => (
                    <SelectItem key={count} value={count}>{count} Revision{count === "1" ? "" : "s"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-slate-300">Support Period</Label>
            <Select value={supportPeriod} onValueChange={setSupportPeriod}>
              <SelectTrigger className="bg-slate-950 border-slate-800 text-white" data-testid="edit-select-support-period">
                <SelectValue placeholder="Select support period" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-white">
                {SUPPORT_PERIOD_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Billing (PKR)</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">Total Bill (₨)</Label>
            <Input type="number" min="0" step="1" value={totalBill} onChange={(e) => setTotalBill(e.target.value.replace(/[^0-9]/g, ''))} onWheel={(e) => e.currentTarget.blur()} className="bg-slate-950 border-slate-800 text-white" placeholder="0" data-testid="edit-input-total-bill" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Advance / Collected (₨)</Label>
            <Input type="number" min="0" step="1" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value.replace(/[^0-9]/g, ''))} onWheel={(e) => e.currentTarget.blur()} className="bg-slate-950 border-slate-800 text-white" placeholder="0" data-testid="edit-input-advance-amount" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Remaining</Label>
            <div className="h-9 flex items-center px-3 bg-slate-950 border border-slate-800 rounded-md text-white">
              ₨{remainingDisplay.toLocaleString()}
            </div>
          </div>
        </div>
        {(parseInt(advanceAmount) || 0) > (parseInt(totalBill) || 0) && (
          <p className="text-xs text-red-400" data-testid="edit-text-advance-warning">Advance paid cannot be greater than total bill.</p>
        )}
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Marketing</h4>
        <div className="space-y-2">
          <Label className="text-slate-300">How did the client find us?</Label>
          <Select value={platform} onValueChange={(val) => {
            setPlatform(val);
            const found = platformsCatalogData.find(p => p.name === val);
            if (!found?.hasCampaignFields) {
              setCampaign("");
              setAdSet("");
              setCreative("");
            }
          }}>
            <SelectTrigger className="bg-slate-950 border-slate-800 text-white" data-testid="edit-select-platform">
              <SelectValue placeholder="Select platform..." />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700">
              {activePlatforms.length > 0 ? activePlatforms.map(p => (
                <SelectItem key={p.id} value={p.name} className="text-white hover:bg-slate-800">{p.name}</SelectItem>
              )) : (
                <SelectItem value="Other" className="text-white hover:bg-slate-800">Other</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        {(() => {
          const selectedPlatform = platformsCatalogData.find(p => p.name === platform);
          if (!selectedPlatform?.hasCampaignFields) return null;
          return (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-300">Campaign</Label>
                <Input value={campaign} onChange={(e) => setCampaign(e.target.value)} className="bg-slate-950 border-slate-800 text-white" placeholder="Campaign name..." data-testid="edit-input-campaign" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Ad Set</Label>
                <Input value={adSet} onChange={(e) => setAdSet(e.target.value)} className="bg-slate-950 border-slate-800 text-white" placeholder="Ad set name..." data-testid="edit-input-ad-set" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Creative</Label>
                <Input value={creative} onChange={(e) => setCreative(e.target.value)} className="bg-slate-950 border-slate-800 text-white" placeholder="Creative name..." data-testid="edit-input-creative" />
              </div>
            </div>
          );
        })()}
      </div>

      <div className="space-y-2">
        <Label className="text-slate-300">Internal Notes</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-slate-950 border-slate-800 text-white resize-none" placeholder="Add any internal notes..." rows={3} data-testid="edit-input-notes" />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
        <Button type="submit" className="bg-primary" disabled={isSaving} data-testid="edit-button-submit-order">
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}

function SupportPeriodCell({ order }: { order: OrderWithServices }) {
  if (!order.supportPeriod) return <span className="text-sm text-slate-500">—</span>;
  const label = SUPPORT_PERIOD_LABELS[order.supportPeriod] || order.supportPeriod;
  const info = getSupportStatusInfo(order);
  if (!info) return <span className="text-sm text-slate-300">{label}</span>;

  const statusMeta = info.status === "active"
    ? { text: "Active", dot: "bg-emerald-400", textColor: "text-emerald-400" }
    : info.status === "expiring_soon"
    ? { text: info.daysLeft > 0 ? `${info.daysLeft} Day${info.daysLeft === 1 ? "" : "s"} Left` : "Expiring Soon", dot: "bg-amber-400", textColor: "text-amber-400" }
    : { text: "Expired", dot: "bg-slate-500", textColor: "text-slate-500" };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex cursor-default flex-col gap-0.5" data-testid={`support-period-${order.id}`}>
          <span className="text-sm text-slate-300">{label}</span>
          <span className={`flex items-center gap-1 text-xs ${statusMeta.textColor}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
            {statusMeta.text}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="space-y-1 bg-slate-800 border-slate-700 text-xs text-white">
        <p>Support Started: {format(info.startDate, "dd MMM yyyy")}</p>
        <p>Support {info.status === "expired" ? "Ended" : "Ends"}: {format(info.endDate, "dd MMM yyyy")}</p>
        <p>Status: {info.status === "active" ? "Active" : info.status === "expiring_soon" ? "Expiring Soon" : "Expired"}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function ServiceTypeSelector({ onSelect }: { onSelect: (type: OrderServiceType) => void }) {
  return (
    <div className="space-y-3">
      {ORDER_SERVICE_TYPE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onSelect(option.value)}
          className="flex w-full items-center gap-3 rounded-xl border-2 border-slate-800 bg-slate-950 p-4 text-left transition-all hover:border-slate-700"
          data-testid={`button-service-type-${option.value}`}
        >
          <option.icon className="h-5 w-5 shrink-0 text-blue-400" />
          <span className="text-sm font-semibold text-white">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function DeliverableLinkRow({ service, onSave, isSaving, label, quantity, instructions }: {
  service: { id: number; serviceType: string; deliverableLink?: string | null };
  onSave: (id: number, link: string | null) => void;
  isSaving: boolean;
  label?: string;
  quantity?: number;
  instructions?: string | null;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [value, setValue] = useState(service.deliverableLink || "");
  const hasLink = Boolean(service.deliverableLink);
  const displayName = label || service.serviceType;

  useEffect(() => {
    setValue(service.deliverableLink || "");
  }, [service.deliverableLink]);

  const handleSave = () => {
    if (!value.trim()) return;
    onSave(service.id, value.trim());
    setModalOpen(false);
  };

  const handleDelete = () => {
    onSave(service.id, null);
    setDeleteConfirmOpen(false);
  };

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0 border-b border-slate-800/70 last:border-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {hasLink ? (
            <button
              type="button"
              onClick={() => window.open(service.deliverableLink!, "_blank", "noopener,noreferrer")}
              className="group inline-flex items-center gap-1.5 text-left font-medium text-white transition-colors hover:text-cyan-300"
              data-testid={`link-open-service-${service.id}`}
            >
              {displayName}
              <ExternalLink className="h-3 w-3 text-slate-500 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ) : (
            <p className="font-medium text-white">{displayName}</p>
          )}
          {quantity && quantity > 1 && <Badge variant="outline" className="text-slate-400 border-slate-700">×{quantity}</Badge>}
        </div>
        {instructions && <p className="mt-0.5 text-xs text-slate-500">{instructions}</p>}
        {!hasLink && <p className="mt-0.5 text-xs text-slate-500">Add Link</p>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {hasLink ? (
          <>
            <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-500 hover:text-white" onClick={() => { setValue(service.deliverableLink || ""); setModalOpen(true); }} data-testid={`button-edit-link-${service.id}`}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-500 hover:text-red-400" onClick={() => setDeleteConfirmOpen(true)} data-testid={`button-delete-link-${service.id}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-slate-500 hover:text-white" onClick={() => { setValue(""); setModalOpen(true); }} aria-label={`Add link for ${displayName}`} data-testid={`button-add-link-${service.id}`}>
            <Link2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white font-display">{displayName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste URL here"
              className="bg-slate-950 border-slate-800 text-white"
              autoFocus
              data-testid={`input-link-${service.id}`}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)} data-testid={`button-cancel-link-${service.id}`}>Cancel</Button>
            <Button type="button" disabled={isSaving || !value.trim()} onClick={handleSave} data-testid={`button-save-link-${service.id}`}>{isSaving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white font-display">Remove Link?</DialogTitle>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDeleteConfirmOpen(false)} data-testid={`button-cancel-delete-link-${service.id}`}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={isSaving} onClick={handleDelete} data-testid={`button-confirm-delete-link-${service.id}`}>Remove</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Prefill for converting a pixelycareers.com request (Website Requests page).
 * When passed, CreateOrderForm submits to /api/website-requests/orders/:id/place
 * (admin only), which creates the CRM order + payment record and updates the
 * website row in one transaction. Without it, the form behaves exactly as on the Orders page.
 */
export type WebsiteOrderPrefill = {
  requestId: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  clientType: "national" | "international";
  services: Array<{ serviceType: string; quantity: number; instructions: string }>;
  totalBill: string;
  amountReceived: string;
  paymentMethod: string;
  transactionId: string;
  screenshotUrl: string;
  notes: string;
  numberOfRevisions: string;
  supportPeriod: string;
  platform: string;
  campaign: string;
  adSet: string;
  creative: string;
  totalHint?: string;
  /** Request is awaiting approval → POST .../approve instead of .../place. */
  approve?: boolean;
};

export { ServiceTypeSelector, ORDER_SERVICE_TYPE_TITLES };
export type { OrderServiceType };

/** Contact details to prefill a normal (non-website) order, e.g. from a free CV review. */
export type ContactPrefill = { clientName: string; clientPhone: string; clientType?: "national" | "international"; notes?: string };

type ClientLookup = {
  found: boolean;
  key?: string;
  profile?: { key: string; name: string; email: string | null; orderCount: number; placedCount: number; totalSpent: number; lastOrderAt: string | null };
  clientType?: "national" | "international" | null;
  recentOrders?: Array<{ id: number; orderNumber: string | null; status: string | null; packageType: string | null; createdAt: string | null }>;
};
type DesignerWorkload = { id: number; name: string; active: number };
type PayMode = "half" | "full" | "custom";

const ORDER_DRAFT_PREFIX = "crm:create-order-draft:v1:";
type OrderDraft = {
  clientName: string; clientPhone: string; clientType: "national" | "international"; clientEmail: string;
  packageKey: string; addonKeys: string[]; totalBill: string; priceTouched: boolean;
  payMode: PayMode; advanceAmount: string; transactionId: string;
  assignedToId: string; numberOfRevisions: string; supportPeriod: string;
  platform: string; campaign: string; adSet: string; creative: string; notes: string;
  services: OrderFormService[]; savedAt: number;
};
function readOrderDraft(key: string): OrderDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as OrderDraft;
    // Drafts expire after 3 days.
    return d && typeof d === "object" && Date.now() - (d.savedAt || 0) < 3 * 24 * 3600 * 1000 ? d : null;
  } catch { return null; }
}

/** Numbered section card used by the one-screen Create Order form. */
function FormSection({ n, title, hint, children, testId }: { n: number; title: string; hint?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4" data-testid={testId}>
      <header className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-sm font-semibold text-primary">{n}</span>
        <div className="min-w-0">
          <h4 className="text-base font-semibold text-slate-200">{title}</h4>
          {hint && <p className="text-xs text-slate-500">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function FieldError({ show, children, testId }: { show: boolean; children: React.ReactNode; testId?: string }) {
  if (!show) return null;
  return <p className="text-xs text-rose-400" role="alert" data-testid={testId}>{children}</p>;
}

export function CreateOrderForm({ designers, onSuccess, orderType, onBack, websitePrefill, onConverted, contactPrefill, onCreated }: { designers: User[]; onSuccess: () => void; orderType: OrderServiceType; onBack: () => void; websitePrefill?: WebsiteOrderPrefill; onConverted?: (result: { order: { id: number; orderNumber: string | null } }) => void; contactPrefill?: ContactPrefill; onCreated?: (order: { id: number; orderNumber: string | null }) => void | Promise<void> }) {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const isWebsite = !!websitePrefill;
  const isAdmin = currentUser?.role === "admin";
  const isSupport = !isAdmin;
  // Drafts only for a blank manual order (website / contact prefills already carry their data).
  const draftKey = !isWebsite && !contactPrefill ? `${ORDER_DRAFT_PREFIX}${orderType}` : null;
  const [draft] = useState<OrderDraft | null>(() => (draftKey ? readOrderDraft(draftKey) : null));
  const [draftNotice, setDraftNotice] = useState(!!draft);

  const { data: servicesCatalogData = [] } = useQuery<ServiceCatalogItem[]>({ queryKey: ["/api/services-catalog"], staleTime: 5 * 60 * 1000 });
  const { data: platformsCatalogData = [] } = useQuery<PlatformCatalogItem[]>({ queryKey: ["/api/platforms-catalog"], staleTime: 5 * 60 * 1000 });
  const { data: catalogData = [] } = useQuery<CatalogItem[]>({ queryKey: ["/api/catalog"], staleTime: 5 * 60 * 1000 });
  const { data: packageConfigsData = [] } = useQuery<PackageConfig[]>({ queryKey: ["/api/package-configs"], staleTime: 5 * 60 * 1000 });
  const { data: workload = [] } = useQuery<DesignerWorkload[]>({ queryKey: ["/api/designers/workload"], staleTime: 60 * 1000 });

  const activeFormServiceTypes = servicesCatalogData.filter(s => s.isActive).map(s => s.name);
  const baseFormServiceTypes = activeFormServiceTypes.length > 0 ? activeFormServiceTypes : FALLBACK_SERVICE_TYPES;
  // Website prefill may map an add-on to a service name outside the catalog; keep it selectable.
  const formServiceTypes = isWebsite
    ? Array.from(new Set([...baseFormServiceTypes, ...websitePrefill!.services.map(s => s.serviceType).filter(Boolean)]))
    : baseFormServiceTypes;
  const activePlatforms = platformsCatalogData.filter(p => p.isActive);

  const [clientName, setClientName] = useState(websitePrefill?.clientName ?? contactPrefill?.clientName ?? draft?.clientName ?? "");
  const [clientPhone, setClientPhone] = useState(websitePrefill?.clientPhone ?? contactPrefill?.clientPhone ?? draft?.clientPhone ?? "");
  const [clientType, setClientType] = useState<"national" | "international">(websitePrefill?.clientType ?? contactPrefill?.clientType ?? draft?.clientType ?? "national");
  const [clientEmail, setClientEmail] = useState(websitePrefill?.clientEmail ?? draft?.clientEmail ?? "");
  const [packageKey, setPackageKey] = useState(draft?.packageKey ?? "");
  const [addonKeys, setAddonKeys] = useState<string[]>(draft?.addonKeys ?? []);
  const [totalBill, setTotalBill] = useState(websitePrefill?.totalBill ?? draft?.totalBill ?? "");
  // Once someone types a price, catalog picks no longer overwrite it.
  const [priceTouched, setPriceTouched] = useState(isWebsite || !!draft?.priceTouched);
  const [payMode, setPayMode] = useState<PayMode>(isWebsite ? "custom" : draft?.payMode ?? "half");
  const [advanceAmount, setAdvanceAmount] = useState(websitePrefill?.amountReceived ?? draft?.advanceAmount ?? "");
  const [paymentMethod, setPaymentMethod] = useState<string>(websitePrefill?.paymentMethod ?? "");
  const [transactionId, setTransactionId] = useState(websitePrefill?.transactionId ?? draft?.transactionId ?? "");
  const [screenshotUrl, setScreenshotUrl] = useState(websitePrefill?.screenshotUrl ?? "");
  const [assignedToId, setAssignedToId] = useState(draft?.assignedToId ?? "");
  const [platform, setPlatform] = useState(websitePrefill?.platform ?? draft?.platform ?? "");
  const [campaign, setCampaign] = useState(websitePrefill?.campaign ?? draft?.campaign ?? "");
  const [adSet, setAdSet] = useState(websitePrefill?.adSet ?? draft?.adSet ?? "");
  const [creative, setCreative] = useState(websitePrefill?.creative ?? draft?.creative ?? "");
  const [notes, setNotes] = useState(websitePrefill?.notes ?? contactPrefill?.notes ?? draft?.notes ?? "");
  const [numberOfRevisions, setNumberOfRevisions] = useState(websitePrefill?.numberOfRevisions ?? draft?.numberOfRevisions ?? "");
  const [supportPeriod, setSupportPeriod] = useState(websitePrefill?.supportPeriod ?? draft?.supportPeriod ?? "");
  const initialServices: OrderFormService[] = websitePrefill
    ? websitePrefill.services.map((s, i) => ({ id: i + 1, serviceNumber: i + 1, serviceType: s.serviceType, quantity: s.quantity, instructions: s.instructions } as OrderFormService))
    : (draft?.services ?? []);
  const maxServiceNo = initialServices.reduce((m, s) => Math.max(m, s.id, s.serviceNumber), 0);
  const serviceIdRef = useRef(maxServiceNo + 1);
  const nextServiceNumberRef = useRef(maxServiceNo + 1);
  const [services, setServices] = useState<OrderFormService[]>(initialServices);
  const customServicesTopRef = useRef<HTMLDivElement | null>(null);
  const advanceInputRef = useRef<HTMLInputElement | null>(null);
  const [paymentScreenshot, setPaymentScreenshot] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // ---- 1) Client lookup by WhatsApp number -------------------------------------------
  const phoneKey = pkPhoneKey(clientPhone);
  const [lookupKey, setLookupKey] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setLookupKey(phoneKey && phoneKey.length >= 11 ? phoneKey : null), 400);
    return () => clearTimeout(t);
  }, [phoneKey]);
  const { data: lookup, isFetching: lookingUp } = useQuery<ClientLookup>({
    queryKey: [`/api/clients/lookup?phone=${lookupKey ?? ""}`],
    enabled: !!lookupKey,
    staleTime: 60 * 1000,
  });
  const autofilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!lookup?.found || !lookup.profile || autofilledFor.current === lookup.key) return;
    autofilledFor.current = lookup.key ?? null;
    // Only fill empty fields: never overwrite what was typed.
    if (!clientName.trim()) setClientName(lookup.profile.name || "");
    if (!clientEmail.trim() && lookup.profile.email) setClientEmail(lookup.profile.email);
    if (!isWebsite && !contactPrefill && lookup.clientType && (lookup.clientType === "national" || lookup.clientType === "international")) setClientType(lookup.clientType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup]);

  // ---- 2) Catalog: packages + add-ons, auto price ----------------------------------------
  const pkrCatalog = catalogData.filter(i => i.isActive && i.currency === "PKR");
  const preferredMarket = clientType === "international" ? "intl" : "pk";
  const marketItems = pkrCatalog.some(i => i.market === preferredMarket) ? pkrCatalog.filter(i => i.market === preferredMarket) : pkrCatalog.filter(i => i.market === "pk");
  const catalogPackages = marketItems.filter(i => i.kind === "package");
  const catalogAddons = marketItems.filter(i => i.kind === "addon");
  const selectedPackage = catalogPackages.find(p => p.key === packageKey) ?? null;
  const selectedAddons = catalogAddons.filter(a => addonKeys.includes(a.key));
  const catalogTotal = (selectedPackage?.price ?? 0) + selectedAddons.reduce((s, a) => s + a.price, 0); // paisa
  useEffect(() => {
    if (priceTouched || (!selectedPackage && selectedAddons.length === 0)) return;
    setTotalBill(String(Math.round(catalogTotal / 100)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogTotal, priceTouched]);

  // ---- 3) Payment quick buttons ---------------------------------------------------------
  const totalRupees = parseInt(totalBill) || 0;
  const advanceRupees = parseInt(advanceAmount) || 0;
  useEffect(() => {
    if (payMode === "half") setAdvanceAmount(totalRupees > 0 ? String(Math.round(totalRupees / 2)) : "");
    if (payMode === "full") setAdvanceAmount(totalRupees > 0 ? String(totalRupees) : "");
  }, [payMode, totalRupees]);

  // ---- 4) Assign: lowest workload + due date --------------------------------------------
  const activeDesignerIds = new Set(designers.map(d => d.id));
  const loadById = new Map(workload.map(w => [w.id, w.active]));
  const suggested = workload.find(w => activeDesignerIds.has(w.id)) ?? null;
  const sortedDesigners = [...designers].sort((a, b) => (loadById.get(a.id) ?? 0) - (loadById.get(b.id) ?? 0) || a.name.localeCompare(b.name));
  const packageTypeForOrder = selectedPackage ? (selectedPackage.crmPackageKey || selectedPackage.key) : null;
  const configuredDays = useMemo(() => {
    const m = new Map<string, number | null>();
    packageConfigsData.forEach(p => m.set(p.key.toLowerCase(), p.deliveryDays ?? null));
    return m;
  }, [packageConfigsData]);
  const deliveryDays = selectedPackage?.deliveryDays && !selectedPackage.crmPackageKey
    ? selectedPackage.deliveryDays
    : deliveryDaysFor(packageTypeForOrder, orderType, configuredDays);
  const dueFrom = new Date();
  const duePreview = addDays(dueFrom, deliveryDays);

  // ---- Draft save -------------------------------------------------------------------------
  useEffect(() => {
    if (!draftKey) return;
    const t = setTimeout(() => {
      const blank = !clientName.trim() && !clientPhone.trim() && !totalBill && services.length === 0 && !notes.trim();
      try {
        if (blank) localStorage.removeItem(draftKey);
        else localStorage.setItem(draftKey, JSON.stringify({
          clientName, clientPhone, clientType, clientEmail, packageKey, addonKeys, totalBill, priceTouched, payMode, advanceAmount,
          transactionId, assignedToId, numberOfRevisions, supportPeriod, platform, campaign, adSet, creative, notes, services, savedAt: Date.now(),
        } satisfies OrderDraft));
      } catch { /* storage full / private mode: drafts are best effort */ }
    }, 500);
    return () => clearTimeout(t);
  }, [draftKey, clientName, clientPhone, clientType, clientEmail, packageKey, addonKeys, totalBill, priceTouched, payMode, advanceAmount, transactionId, assignedToId, numberOfRevisions, supportPeriod, platform, campaign, adSet, creative, notes, services]);

  const clearDraft = () => { if (draftKey) { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } } };
  const startFresh = () => {
    clearDraft();
    setDraftNotice(false);
    setClientName(""); setClientPhone(""); setClientType("national"); setClientEmail("");
    setPackageKey(""); setAddonKeys([]); setTotalBill(""); setPriceTouched(false); setPayMode("half"); setAdvanceAmount("");
    setTransactionId(""); setAssignedToId(""); setNumberOfRevisions(""); setSupportPeriod("");
    setPlatform(""); setCampaign(""); setAdSet(""); setCreative(""); setNotes(""); setServices([]); setPaymentScreenshot(null);
    setShowErrors(false); autofilledFor.current = null;
  };

  // ---- Services ---------------------------------------------------------------------------
  const addService = (serviceType = "") => {
    const id = serviceIdRef.current++;
    const no = nextServiceNumberRef.current++;
    setServices((prev) => {
      const next = prependNumberedService(prev, id, no);
      return serviceType ? next.map(s => (s.id === id ? { ...s, serviceType } : s)) : next;
    });
    if (!serviceType) requestAnimationFrame(() => {
      customServicesTopRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      customServicesTopRef.current?.querySelector<HTMLButtonElement>('[data-testid^="select-service-type-"]')?.focus();
    });
  };
  const removeService = (id: number) => setServices((prev) => prev.filter((s) => s.id !== id));
  const updateService = (id: number, field: string, value: any) => setServices((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));

  const pickPackage = (key: string) => {
    const next = key === packageKey ? "" : key;
    setPackageKey(next);
    setPriceTouched(false);
    const pkg = catalogPackages.find(p => p.key === next);
    // Documentation orders: add the package's services that are not listed yet.
    if (pkg && orderType === "documentation") {
      const have = new Set(services.map(s => s.serviceType));
      pkg.services.filter(s => !have.has(s)).forEach(s => addService(s));
    }
  };
  const toggleAddon = (key: string) => {
    setPriceTouched(false);
    setAddonKeys(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  };

  // ---- Validation (inline + on submit) ----------------------------------------------------
  const emailBad = !!clientEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail.trim());
  const errors = {
    clientName: !clientName.trim() ? "Enter the client name." : "",
    clientPhone: !clientPhone.trim() ? "Enter the WhatsApp number." : (phoneKey ?? "").length < 10 ? "This number looks too short." : "",
    clientEmail: emailBad ? "Check the email address." : "",
    services: orderType === "documentation" && services.every(s => !s.serviceType) ? "Add at least one service." : "",
    totalBill: totalRupees <= 0 ? "Enter the total bill." : "",
    advance: advanceRupees > totalRupees && totalRupees > 0 ? `${isWebsite ? "Amount received" : "Advance"} cannot be more than the total bill.`
      : !isWebsite && isSupport && advanceRupees <= 0 ? "Enter the advance received." : "",
    screenshot: !isWebsite && isSupport && advanceRupees > 0 && !paymentScreenshot ? "Add the payment screenshot." : "",
    screenshotUrl: isWebsite && screenshotUrl.trim() && !/^https?:\/\/\S+$/i.test(screenshotUrl.trim()) ? "Paste a full http(s) link." : "",
  };
  const errorCount = Object.values(errors).filter(Boolean).length;
  const err = (k: keyof typeof errors) => showErrors && !!errors[k];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    if (errorCount > 0) {
      toast({ title: "Check the form", description: Object.values(errors).filter(Boolean).slice(0, 3).join(" "), variant: "destructive" });
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-create-order] [role="alert"]')?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }

    const totalPriceValue = totalRupees * 100;
    const advanceValue = advanceRupees * 100;
    const remainingValue = Math.max(0, totalPriceValue - advanceValue);
    const paymentType: "advance" | "full" = advanceValue >= totalPriceValue && advanceValue > 0 ? "full" : "advance";
    const catalogNote = selectedPackage || selectedAddons.length
      ? `Catalog: ${[selectedPackage?.label, ...selectedAddons.map(a => `+ ${a.label}`)].filter(Boolean).join(", ")}`
      : "";
    // Admin orders have no verification record, so the transaction ID is kept in the notes.
    const txnNote = !isWebsite && isAdmin && transactionId.trim() ? `Txn ID: ${transactionId.trim()}` : "";
    const finalNotes = [notes.trim(), catalogNote, txnNote].filter(Boolean).join("\n");

    setIsUploading(true);
    try {
      const orderServices = orderType === "documentation"
        ? services.filter(s => s.serviceType).map(s => ({ serviceType: s.serviceType, quantity: s.quantity || 1, instructions: s.instructions || null }))
        : [];

      if (isWebsite) {
        // One server call = one DB transaction (order + payment record + website row).
        const res = await fetch(`/api/website-requests/orders/${websitePrefill!.requestId}/${websitePrefill!.approve ? "approve" : "place"}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientName: clientName.trim(), clientPhone: clientPhone.trim(), clientEmail: clientEmail.trim() || null, clientType, orderType,
            assignedToId: assignedToId ? parseInt(assignedToId) : null,
            totalPrice: totalPriceValue, amountReceived: advanceValue,
            paymentMethod: paymentMethod.trim() || null, transactionId: transactionId.trim() || null, screenshotUrl: screenshotUrl.trim() || null,
            numberOfRevisions: numberOfRevisions ? parseInt(numberOfRevisions) : null, supportPeriod: supportPeriod || null,
            platform: platform.trim() || null, campaign: campaign.trim() || null, adSet: adSet.trim() || null, creative: creative.trim() || null,
            notes: notes.trim() || null, services: orderServices,
          }),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(result.message || result.error || "Failed to place order");
        queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications"] });
        toast({ title: "Order placed", description: `CRM order ${result.order?.orderNumber || ""} created and approved.` });
        onConverted?.(result);
        onSuccess();
        return;
      }

      const orderRes = await apiRequest("POST", "/api/orders", {
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim(),
        clientEmail: clientEmail.trim() || null,
        clientType,
        orderType,
        packageType: packageTypeForOrder,
        assignedToId: assignedToId ? parseInt(assignedToId) : null,
        paymentStatus: "pending",
        totalPrice: totalPriceValue,
        // Admin: advance is collected immediately. Support: it goes through verification, starts at 0.
        advanceAmount: isAdmin ? advanceValue : 0,
        remainingAmount: isAdmin ? remainingValue : totalPriceValue,
        numberOfRevisions: numberOfRevisions ? parseInt(numberOfRevisions) : null,
        supportPeriod: supportPeriod || null,
        platform: platform.trim() || null,
        campaign: campaign.trim() || null,
        adSet: adSet.trim() || null,
        creative: creative.trim() || null,
        notes: finalNotes || null,
        services: orderServices,
      });
      const order = await orderRes.json();

      if (paymentScreenshot && advanceValue > 0 && !isAdmin) {
        const formData = new FormData();
        formData.append("screenshot", paymentScreenshot);
        formData.append("orderId", order.id.toString());
        formData.append("paymentType", paymentType);
        formData.append("amount", advanceValue.toString());
        if (transactionId.trim()) formData.append("transactionId", transactionId.trim());
        const verificationRes = await fetch("/api/payment-verifications", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!verificationRes.ok) {
          const errorData = await verificationRes.json().catch(() => ({}));
          throw new Error(errorData.error || "Order saved, but the payment screenshot failed. Add it from the order.");
        }
      }

      clearDraft();
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications"] });
      toast({
        title: "Order placed",
        description: isAdmin ? "Order created and approved automatically" : paymentScreenshot ? "Payment screenshot submitted — awaiting admin approval" : "Order created successfully",
      });
      await onCreated?.(order);
      onSuccess();
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to create order", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const inputCls = "bg-slate-950 border-slate-800 text-white";
  const bad = "border-rose-500/70 focus-visible:ring-rose-500/40";

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-create-order noValidate>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="-ml-2 h-auto p-2 text-slate-400 hover:text-white" data-testid="button-back-to-service-selection">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Choose Service
        </Button>
        {draftKey && <span className="text-xs text-slate-500" data-testid="text-draft-status">Draft saves automatically on this device</span>}
      </div>

      {draftNotice && draft && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-[hsl(var(--accent))] px-3 py-2 text-sm" data-testid="banner-draft-restored">
          <span className="text-slate-200">Restored your unsaved order from {format(new Date(draft.savedAt), "d MMM, h:mm a")}.</span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraftNotice(false)}>Keep</Button>
            <Button type="button" size="sm" variant="outline" onClick={startFresh} data-testid="button-draft-discard">Start fresh</Button>
          </div>
        </div>
      )}

      {/* 1) Client */}
      <FormSection n={1} title="Client" hint="Start with the WhatsApp number. Returning clients fill in automatically." testId="section-client">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-slate-300" htmlFor="co-phone">WhatsApp number *</Label>
            <div className="relative">
              <Input id="co-phone" type="tel" inputMode="tel" autoComplete="off" autoFocus={!isWebsite && !clientPhone} value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} className={cn(inputCls, err("clientPhone") && bad)} placeholder="0300 1234567" data-testid="input-client-phone" />
              {lookingUp && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-500" />}
            </div>
            <FieldError show={err("clientPhone")} testId="error-client-phone">{errors.clientPhone}</FieldError>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300" htmlFor="co-name">Client name *</Label>
            <Input id="co-name" value={clientName} onChange={(e) => setClientName(e.target.value)} className={cn(inputCls, err("clientName") && bad)} placeholder="Full name" data-testid="input-client-name" />
            <FieldError show={err("clientName")} testId="error-client-name">{errors.clientName}</FieldError>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Client type *</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Client type" data-testid="select-client-type">
              {(["national", "international"] as const).map(t => (
                <button key={t} type="button" role="radio" aria-checked={clientType === t} onClick={() => setClientType(t)}
                  className={cn("min-h-touch rounded-md border px-3 text-sm transition-colors", clientType === t ? "border-primary bg-[hsl(var(--accent))] font-medium text-primary" : "border-slate-800 text-slate-400 hover:text-white")}
                  data-testid={`radio-client-type-${t}`}>
                  {t === "national" ? "National" : "International"}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300" htmlFor="co-email">Email <span className="text-slate-500">(optional)</span></Label>
            <Input id="co-email" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} className={cn(inputCls, err("clientEmail") && bad)} placeholder="client@email.com" data-testid="input-client-email" />
            <FieldError show={err("clientEmail")}>{errors.clientEmail}</FieldError>
          </div>
        </div>
        {lookup?.found && lookup.profile && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm" data-testid="card-returning-client">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-slate-200">
                <span className="font-semibold text-emerald-400">Returning client</span> · {lookup.profile.orderCount} order{lookup.profile.orderCount === 1 ? "" : "s"} · spent {rupees(lookup.profile.totalSpent)}
                {lookup.profile.lastOrderAt && <> · last {format(new Date(lookup.profile.lastOrderAt), "d MMM yyyy")}</>}
              </p>
              <a href={`/clients/${lookup.profile.key}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" data-testid="link-client-profile">
                Profile <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {!!lookup.recentOrders?.length && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {lookup.recentOrders.map(o => (
                  <span key={o.id} className="rounded-md border border-border bg-card px-2 py-0.5 text-xs text-slate-400">
                    {o.orderNumber || `#${o.id}`} · {o.status?.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {lookupKey && lookup && !lookup.found && !lookingUp && (
          <p className="text-xs text-slate-500" data-testid="text-new-client">New client — no previous orders on this number.</p>
        )}
      </FormSection>

      {/* 2) Package & add-ons */}
      <FormSection n={2} title={orderType === "documentation" ? "Package, services & add-ons" : "Package & price"} hint={catalogPackages.length || catalogAddons.length ? "Prices come from the catalog in Settings. You can still edit the total." : "No catalog items yet. Enter the price manually (admins can add packages in Settings → Catalog)."} testId="section-package">
        {catalogPackages.length > 0 && (
          <div className="space-y-2">
            <Label className="text-slate-300">Package</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {catalogPackages.map(p => (
                <button key={p.key} type="button" onClick={() => pickPackage(p.key)} aria-pressed={packageKey === p.key}
                  className={cn("rounded-lg border p-3 text-left transition-colors", packageKey === p.key ? "border-primary bg-[hsl(var(--accent))]" : "border-slate-800 hover:border-slate-600")}
                  data-testid={`button-package-${p.key}`}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-200">{p.label}</span>
                    {packageKey === p.key && <Check className="h-4 w-4 text-primary" />}
                  </span>
                  <span className="block text-sm font-semibold text-primary">{rupees(p.price)}</span>
                  {p.description && <span className="mt-1 block text-xs text-slate-500 line-clamp-2">{p.description}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        {catalogAddons.length > 0 && (
          <div className="space-y-2">
            <Label className="text-slate-300">Add-ons</Label>
            <div className="flex flex-wrap gap-2">
              {catalogAddons.map(a => {
                const on = addonKeys.includes(a.key);
                return (
                  <button key={a.key} type="button" onClick={() => toggleAddon(a.key)} aria-pressed={on}
                    className={cn("min-h-touch rounded-full border px-3 text-sm transition-colors", on ? "border-primary bg-[hsl(var(--accent))] text-primary" : "border-slate-800 text-slate-400 hover:text-white")}
                    data-testid={`button-addon-${a.key}`}>
                    {on ? "✓ " : "+ "}{a.label} · {rupees(a.price)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {orderType === "documentation" && (
          <div className="space-y-3" ref={customServicesTopRef}>
            <div className="flex items-center justify-between">
              <Label className="text-slate-300">Services *</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => addService()} className="text-blue-400 hover:text-blue-300" data-testid="button-add-service">
                <Plus className="mr-1 h-4 w-4" /> Add service
              </Button>
            </div>
            {services.length === 0 ? (
              <div className={cn("rounded-lg border border-dashed px-4 py-4 text-sm text-slate-500", err("services") ? "border-rose-500/70" : "border-slate-700")}>
                Add at least one service for this order.
              </div>
            ) : services.map((service, index) => (
              <div key={service.id} className="space-y-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
                <div className="grid grid-cols-[1fr_80px_auto] items-center gap-2">
                  <Select value={service.serviceType} onValueChange={(val) => updateService(service.id, "serviceType", val)}>
                    <SelectTrigger className="border-slate-700 bg-slate-900 text-white" data-testid={`select-service-type-${index}`}>
                      <SelectValue placeholder="Select service type" />
                    </SelectTrigger>
                    <SelectContent className="border-slate-800 bg-slate-900 text-white">
                      {Array.from(new Set([...formServiceTypes, service.serviceType].filter(Boolean))).map(type => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input type="number" min="1" value={service.quantity} onChange={(e) => updateService(service.id, "quantity", parseInt(e.target.value) || 1)} onWheel={(e) => e.currentTarget.blur()} className="border-slate-700 bg-slate-900 text-white" aria-label="Quantity" data-testid={`input-quantity-${index}`} />
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeService(service.id)} className="text-red-400 hover:text-red-300" aria-label="Remove service" data-testid={`button-remove-service-${index}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea value={service.instructions} onChange={(e) => updateService(service.id, "instructions", e.target.value)} className="resize-none border-slate-700 bg-slate-900 text-white" placeholder="Special instructions for this service..." rows={2} data-testid={`input-instructions-${index}`} />
              </div>
            ))}
            <FieldError show={err("services")} testId="error-services">{errors.services}</FieldError>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label className="text-slate-300" htmlFor="co-total">Total bill (₨) *</Label>
            <Input id="co-total" type="number" inputMode="numeric" min="0" step="1" value={totalBill}
              onChange={(e) => { setTotalBill(e.target.value.replace(/[^0-9]/g, "")); setPriceTouched(true); }}
              onWheel={(e) => e.currentTarget.blur()} className={cn(inputCls, err("totalBill") && bad)} placeholder="0" data-testid="input-total-bill" />
            {(selectedPackage || selectedAddons.length > 0) && (
              <p className="text-xs text-slate-500">
                Catalog price {rupees(catalogTotal)}
                {priceTouched && totalRupees * 100 !== catalogTotal && (
                  <> · <button type="button" className="text-primary hover:underline" onClick={() => setPriceTouched(false)} data-testid="button-use-catalog-price">use it</button></>
                )}
              </p>
            )}
            <FieldError show={err("totalBill")} testId="error-total-bill">{errors.totalBill}</FieldError>
          </div>
          {orderType !== "resume_distribution" && (
            <div className="space-y-2">
              <Label className="text-slate-300">Revisions</Label>
              <Select value={numberOfRevisions} onValueChange={setNumberOfRevisions}>
                <SelectTrigger className={inputCls} data-testid="select-revisions"><SelectValue placeholder="Select revisions" /></SelectTrigger>
                <SelectContent className="border-slate-800 bg-slate-900 text-white">
                  {REVISION_COUNT_OPTIONS.map(count => <SelectItem key={count} value={count}>{count} Revision{count === "1" ? "" : "s"}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-slate-300">Support period</Label>
            <Select value={supportPeriod} onValueChange={setSupportPeriod}>
              <SelectTrigger className={inputCls} data-testid="select-support-period"><SelectValue placeholder="Select support period" /></SelectTrigger>
              <SelectContent className="border-slate-800 bg-slate-900 text-white">
                {SUPPORT_PERIOD_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </FormSection>

      {/* 3) Payment */}
      <FormSection n={3} title="Payment" hint={isWebsite ? "Defaults to the website total. Lower it for a partial payment." + (websitePrefill?.totalHint ? ` ${websitePrefill.totalHint}` : "") : isAdmin ? "Admin orders are approved immediately." : "The order stays pending until an admin approves the payment."} testId="section-payment">
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Amount received">
          {([["half", "50%"], ["full", "Full"], ["custom", "Custom"]] as const).map(([mode, label]) => (
            <button key={mode} type="button" role="radio" aria-checked={payMode === mode}
              onClick={() => { setPayMode(mode); if (mode === "custom") requestAnimationFrame(() => advanceInputRef.current?.focus()); }}
              className={cn("min-h-touch rounded-md border text-sm transition-colors", payMode === mode ? "border-primary bg-[hsl(var(--accent))] font-medium text-primary" : "border-slate-800 text-slate-400 hover:text-white")}
              data-testid={`button-pay-${mode}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-slate-300" htmlFor="co-advance">{isWebsite ? "Amount received (₨)" : "Advance received (₨)"}{!isWebsite && isSupport && " *"}</Label>
            <Input id="co-advance" ref={advanceInputRef} type="number" inputMode="numeric" min="0" step="1" value={advanceAmount}
              onChange={(e) => { setPayMode("custom"); setAdvanceAmount(e.target.value.replace(/[^0-9]/g, "")); }}
              onWheel={(e) => e.currentTarget.blur()} className={cn(inputCls, err("advance") && bad)} placeholder="0" data-testid="input-advance-amount" />
            <FieldError show={err("advance") || (!!errors.advance && advanceRupees > totalRupees)} testId="text-advance-warning">{errors.advance}</FieldError>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Remaining</Label>
            <div className="flex h-control items-center rounded-md border border-slate-800 bg-slate-950 px-3 text-white tabular-nums" data-testid="text-remaining">
              ₨{Math.max(0, totalRupees - advanceRupees).toLocaleString()}
            </div>
          </div>
          {isWebsite && (
            <div className="space-y-2">
              <Label className="text-slate-300">Payment method</Label>
              <Input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputCls} placeholder="e.g. JazzCash, Bank transfer" data-testid="input-payment-method" />
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-slate-300" htmlFor="co-txn">Transaction ID <span className="text-slate-500">(optional)</span></Label>
            <Input id="co-txn" value={transactionId} onChange={(e) => setTransactionId(e.target.value)} className={inputCls} placeholder="Transaction / reference ID" data-testid="input-transaction-id" />
          </div>
        </div>

        {isWebsite ? (
          <div className="space-y-2">
            <Label className="text-slate-300">Payment screenshot URL {isSupport && <span className="text-rose-400">(required)</span>}</Label>
            <Input value={screenshotUrl} onChange={(e) => setScreenshotUrl(e.target.value)} className={cn(inputCls, err("screenshotUrl") && bad)} placeholder="https://res.cloudinary.com/..." data-testid="input-screenshot-url" />
            <FieldError show={err("screenshotUrl")}>{errors.screenshotUrl}</FieldError>
            {/^https?:\/\/\S+$/i.test(screenshotUrl.trim()) && (
              <a href={screenshotUrl.trim()} target="_blank" rel="noopener noreferrer" className="inline-block" data-testid="link-screenshot-preview">
                <img src={screenshotUrl.trim()} alt="Payment screenshot" className="h-24 w-auto rounded-md border border-slate-700 object-cover" />
              </a>
            )}
          </div>
        ) : isSupport ? (
          <div className="space-y-2">
            <Label className="text-slate-300">Payment screenshot *</Label>
            <ImageDropzone
              value={paymentScreenshot}
              onFile={setPaymentScreenshot}
              accept="image/png,image/jpeg,image/jpg,image/webp"
              label="Choose payment proof"
              description="Press Ctrl+V to paste, drag an image here, or take a photo"
              className={err("screenshot") ? "border-rose-500/70" : ""}
              listenForPaste
              testId="input-payment-screenshot"
            />
            {paymentScreenshot && <p className="text-xs text-slate-400" data-testid="text-screenshot-filename">Selected: {paymentScreenshot.name}</p>}
            <FieldError show={err("screenshot")} testId="error-screenshot">{errors.screenshot}</FieldError>
          </div>
        ) : null}
      </FormSection>

      {/* 4) Assign */}
      <FormSection n={4} title="Assign" hint="Designers are sorted by current workload (fewest active orders first)." testId="section-assign">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-slate-300">Designer</Label>
            <Select value={assignedToId} onValueChange={setAssignedToId}>
              <SelectTrigger className={inputCls} data-testid="select-designer"><SelectValue placeholder="Select designer" /></SelectTrigger>
              <SelectContent className="border-slate-800 bg-slate-900 text-white">
                {sortedDesigners.map(d => (
                  <SelectItem key={d.id} value={d.id.toString()}>
                    {d.name}{loadById.has(d.id) ? ` · ${loadById.get(d.id)} active` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {suggested && assignedToId !== String(suggested.id) && (
              <button type="button" onClick={() => setAssignedToId(String(suggested.id))} className="text-xs text-primary hover:underline" data-testid="button-use-suggested-designer">
                Suggested: {suggested.name} ({suggested.active} active) — use
              </button>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Due date</Label>
            <div className="flex h-control items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-3 text-white" data-testid="text-due-preview">
              <CalendarIcon className="h-4 w-4 text-slate-500" />
              {format(duePreview, "EEE d MMM")} <span className="text-xs text-slate-500">({deliveryDays} day{deliveryDays === 1 ? "" : "s"})</span>
            </div>
            <p className="text-xs text-slate-500">{isAdmin || isWebsite ? "Set automatically when the order is placed." : "Counted from when the payment is approved."}</p>
          </div>
        </div>

        <details className="group rounded-lg border border-slate-800 p-3" open={!!(platform || notes)}>
          <summary className="cursor-pointer select-none text-sm text-slate-300">Source & notes</summary>
          <div className="mt-3 space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">How did the client find us?</Label>
              <Select value={platform} onValueChange={(val) => {
                setPlatform(val);
                if (!platformsCatalogData.find(p => p.name === val)?.hasCampaignFields) { setCampaign(""); setAdSet(""); setCreative(""); }
              }}>
                <SelectTrigger className={inputCls} data-testid="select-platform"><SelectValue placeholder="Select platform..." /></SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-900">
                  {activePlatforms.length > 0
                    ? activePlatforms.map(p => <SelectItem key={p.id} value={p.name} className="text-white hover:bg-slate-800">{p.name}</SelectItem>)
                    : <SelectItem value="Other" className="text-white hover:bg-slate-800">Other</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            {platformsCatalogData.find(p => p.name === platform)?.hasCampaignFields && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Input value={campaign} onChange={(e) => setCampaign(e.target.value)} className={inputCls} placeholder="Campaign" aria-label="Campaign" data-testid="input-campaign" />
                <Input value={adSet} onChange={(e) => setAdSet(e.target.value)} className={inputCls} placeholder="Ad set" aria-label="Ad set" data-testid="input-ad-set" />
                <Input value={creative} onChange={(e) => setCreative(e.target.value)} className={inputCls} placeholder="Creative" aria-label="Creative" data-testid="input-creative" />
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-slate-300">Internal notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={cn(inputCls, "resize-none")} placeholder="Add any internal notes..." rows={3} data-testid="input-notes" />
            </div>
          </div>
        </details>
      </FormSection>

      {/* Stick to the dialog's outer edge (cancel its p-4/sm:p-5) so fields never show below the bar. */}
      <div className="sticky -bottom-4 -mx-1 -mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-card px-1 pb-4 pt-3 sm:-bottom-5 sm:-mb-5 sm:pb-5">
        <p className="text-sm text-slate-400" data-testid="text-order-summary">
          Total <span className="font-semibold text-slate-200">₨{totalRupees.toLocaleString()}</span> · received <span className="font-semibold text-slate-200">₨{advanceRupees.toLocaleString()}</span>
          {showErrors && errorCount > 0 && <span className="ml-2 text-rose-400">{errorCount} to fix</span>}
        </p>
        <Button type="submit" className="bg-primary" disabled={isUploading} data-testid="button-submit-order">
          {isUploading ? (isWebsite ? "Placing order..." : "Creating Order...") : isWebsite ? "Verify & place order" : "Create Order"}
        </Button>
      </div>
    </form>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ");
}
