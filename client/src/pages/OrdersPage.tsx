import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import { format, isToday, isPast, startOfMonth } from "date-fns";
import { 
  Search, 
  Loader2,
  Eye, 
  UserPlus, 
  CheckCircle2, 
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
  Star,
  Crown,
  Wrench,
  Pencil,
  FileWarning,
  MessageSquareHeart,
  Lightbulb,
  ArrowLeft
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { OrderWithServices, User, SupportDesignerAssignment, ServiceCatalogItem, PackageConfig, PlatformCatalogItem, PaymentVerification, ComplaintResponse, ComplaintHistoryEntry, ActivityLogWithActor, ClientReview, ClientSuggestion } from "@shared/schema";
import { ComplaintDialog } from "@/components/ComplaintDialog";
import { AdvancePaymentStatusBadge, ComplaintStatusBadge, OrderStatusBadge, PaymentLineStatusBadge, SuggestionStatusBadge } from "@/components/StatusBadge";
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

const ORDER_STATUS_FILTERS: Array<{ value: string; label: string; statuses: string[] }> = [
  { value: "pending", label: "Pending", statuses: ["pending_payment", "new"] },
  { value: "in_progress", label: "In Progress", statuses: ["working"] },
  { value: "delivered", label: "Delivered", statuses: ["delivered"] },
  { value: "canceled", label: "Cancelled", statuses: ["canceled"] },
  // The existing "ready" workflow state represents a completed order before delivery.
  { value: "completed", label: "Completed", statuses: ["ready"] },
];

const orderActivityLabel = (entry: ActivityLogWithActor) => {
  const details = (entry.details || {}) as Record<string, unknown>;
  switch (entry.activityType) {
    case "order_created": return "Order created";
    case "assignment": return entry.previousValue ? "Designer reassigned" : "Designer assigned";
    case "status_change": return `Order status updated to ${reportStatus(entry.newValue)}`;
    case "payment_change": return `Payment ${reportStatus(entry.newValue || "updated").toLowerCase()}`;
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
    pending_payment: "Pending Payment",
    new: "New",
    working: "In Progress",
    ready: "Completed",
    delivered: "Delivered",
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

type OrderDrawerTab = "overview" | "activity" | "experience";
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
  const [activeOrdersTab, setActiveOrdersTab] = useState<"today" | "monthly">("today");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState("all");
  const [selectedDesignerFilter, setSelectedDesignerFilter] = useState("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
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
  const requestedOrderNumber = new URLSearchParams(window.location.search).get("order");
  const activeDrawer = drawerStack[drawerStack.length - 1];
  const detailsSheetOpen = drawerStack.length > 0;

  // Debounce the search input (300ms) so typing stays smooth on large order lists.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: orders, isLoading } = useQuery<OrderWithServices[]>({
    queryKey: ["/api/orders"],
    refetchInterval: 30 * 1000,
    staleTime: 15 * 1000,
  });

  useEffect(() => {
    if (!requestedOrderNumber || isLoading) return;
    const order = orders?.find(item => item.orderNumber === requestedOrderNumber || String(item.id) === requestedOrderNumber);
    if (order) {
      setSelectedOrder(order);
      setDetailsTab("overview");
      setDrawerStack([{ kind: "order", tab: "overview" }]);
      setDeepLinkMessage(null);
    } else {
      setDeepLinkMessage(`Order ${requestedOrderNumber} was not found, or you do not have permission to view it.`);
    }
  }, [orders, isLoading, requestedOrderNumber]);

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

  const { data: packageConfigs = [] } = useQuery<PackageConfig[]>({
    queryKey: ["/api/package-configs"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: paymentVerifications = [] } = useQuery<PaymentVerification[]>({
    queryKey: ["/api/payment-verifications"],
    staleTime: 30 * 1000,
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

  const activePackageConfigs = packageConfigs.filter(p => p.isActive);
  const packageLabels: Record<string, string> = {
    ...FALLBACK_PACKAGE_LABELS,
    ...Object.fromEntries(activePackageConfigs.map(p => [p.key, p.label])),
    custom: "Custom Order",
  };

  const updateOrderMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      return apiRequest("PATCH", `/api/orders/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Success", description: "Order updated successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update order", variant: "destructive" });
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
    onError: (error: Error) => toast({ title: "Could not cancel order", description: error.message, variant: "destructive" }),
  });

  const clientCaseReportMutation = useMutation({
    mutationFn: async (orderId: number) => {
      const response = await fetch(`/api/orders/${orderId}/client-case-report`, { credentials: "include" });
      if (!response.ok) throw new Error("The client case report could not be generated.");
      return response.json();
    },
    onSuccess: (report: Record<string, any>) => {
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

  const SEARCH_RESULT_LIMIT = 100;
  const searchQueryNormalized = debouncedSearch.trim().toLowerCase();
  const phoneSearchQuery = debouncedSearch.replace(/\D/g, "");
  const isSearchActive = searchQueryNormalized.length > 0;
  const isSearchSettling = search.trim() !== debouncedSearch.trim();

  // Universal search: debounced + memoized so the UI never freezes while typing.
  // Searches across ALL orders (every month/year). Matches order ID, client name,
  // and client phone (formatting characters stripped on both sides).
  // Designers are additionally limited to their own assigned orders.
  const { results: universalSearchResults, totalMatches: searchTotalMatches } = useMemo(() => {
    if (!isSearchActive) return { results: [] as OrderWithServices[], totalMatches: 0 };
    const matches = (orders || [])
      .filter(order => {
        if (order.advancePaymentStatus !== 'approved') return false;
        if (user?.role === 'designer' && order.assignedToId !== user.id) return false;
        const statusFilter = ORDER_STATUS_FILTERS.find(filter => filter.value === selectedStatusFilter);
        if (statusFilter && !statusFilter.statuses.includes(order.status)) return false;
        if (selectedDesignerFilter !== "all" && String(order.assignedToId ?? "") !== selectedDesignerFilter) return false;
        const orderIdMatch = (order.orderNumber?.toLowerCase() ?? "").includes(searchQueryNormalized);
        const clientNameMatch = (order.clientName?.toLowerCase() ?? "").includes(searchQueryNormalized);
        const clientPhoneNormalized = (order.clientPhone || "").replace(/\D/g, "");
        const phoneMatch = phoneSearchQuery.length > 0 && clientPhoneNormalized.includes(phoneSearchQuery);
        return orderIdMatch || clientNameMatch || phoneMatch;
      })
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
    return { results: matches.slice(0, SEARCH_RESULT_LIMIT), totalMatches: matches.length };
  }, [orders, isSearchActive, searchQueryNormalized, phoneSearchQuery, user?.role, user?.id, selectedStatusFilter, selectedDesignerFilter]);

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

  // All roles only see approved orders in the Orders Page
  // Unapproved orders are reviewed exclusively in the Payments page
  const visibleOrders = orders?.filter(order => {
    if (order.advancePaymentStatus !== 'approved') return false;
    const statusFilter = ORDER_STATUS_FILTERS.find(filter => filter.value === selectedStatusFilter);
    if (statusFilter && !statusFilter.statuses.includes(order.status)) return false;
    if (isDesigner && order.assignedToId !== user?.id) return false;
    if ((isAdmin || isSupport) && selectedDesignerFilter !== "all" && String(order.assignedToId ?? "") !== selectedDesignerFilter) return false;
    return true;
  }) || [];
  const approvedOrders = visibleOrders;
  const hasActiveOrderFilters = selectedStatusFilter !== "all" || selectedDesignerFilter !== "all";

  const todayOrders = visibleOrders.filter(order => {
    const createdDate = new Date(order.createdAt!);
    // Only show orders created today
    if (!isToday(createdDate)) {
      return false;
    }
    return true;
  });

  const monthlyOrders = visibleOrders.filter(order => {
    const createdDate = new Date(order.createdAt!);
    const inMonth = createdDate.getMonth().toString() === selectedMonth;
    const inYear = createdDate.getFullYear().toString() === selectedYear;
    return inMonth && inYear;
  });

  // Approved monthly orders - same logic as dashboard (advancePaymentStatus === 'approved')
  const approvedMonthlyOrders = monthlyOrders.filter(o => o.advancePaymentStatus === 'approved');

  // Monthly Revenue: total order value (full order amount) for all approved orders
  // placed in the selected month/year — distinct from Collected (advance received)
  // and Remaining (unpaid balance).
  const monthlyRevenue = approvedMonthlyOrders.reduce((sum, order) => {
    return sum + getOrderAccounting(order).accountedTotal;
  }, 0);

  // Approved today's orders — for Total Revenue of the day
  const approvedTodayOrders = todayOrders;

  const getStatusBadge = (status: string) => <OrderStatusBadge status={status} />;
  const getAdvancePaymentStatusBadge = (status: string | null | undefined) => <AdvancePaymentStatusBadge status={status} />;

  const getServicesDisplay = (order: OrderWithServices) => {
    const services = order.services;
    const hasPackage = order.packageType && order.packageType !== "custom";
    const packageLabel = hasPackage ? (packageLabels[order.packageType!] || order.packageType) : null;
    if (!services || services.length === 0) {
      return packageLabel ? (
        <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
          {packageLabel}
        </Badge>
      ) : "-";
    }
    const totalServices = services.reduce((acc, s) => acc + (s.quantity || 1), 0);
    const servicesList = services.map(s => `${s.serviceType} (${s.quantity || 1})`);
    
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex flex-wrap items-center gap-1.5 cursor-pointer">
            {packageLabel && (
              <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
                {packageLabel}
              </Badge>
            )}
            <span className="text-slate-300 underline decoration-dotted underline-offset-2 whitespace-nowrap">
              {packageLabel ? `+${totalServices} ${totalServices === 1 ? "Add-on" : "Add-ons"}` : `${totalServices} ${totalServices === 1 ? "Service" : "Services"}`}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent className="bg-slate-800 border-slate-700 text-white">
          {packageLabel && <p className="mb-2 font-medium text-blue-300">{packageLabel}</p>}
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
    const services = order.services || [];
    const totalServices = services.reduce((total, service) => total + (service.quantity || 1), 0);
    if (order.packageType && order.packageType !== "custom") {
      const packageLabel = packageLabels[order.packageType] || order.packageType;
      return totalServices > 0
        ? `${packageLabel} +${totalServices} ${totalServices === 1 ? "Add-on" : "Add-ons"}`
        : packageLabel;
    }
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

  const exportOrdersPDF = () => {
    let exportOrders: OrderWithServices[];
    let reportSubtitle: string;

    if (isSearchActive) {
      exportOrders = universalSearchResults;
      reportSubtitle = "Search Results";
    } else if (activeOrdersTab === "today") {
      exportOrders = todayOrders;
      reportSubtitle = `Today — ${format(new Date(), "MMMM dd, yyyy")}`;
    } else {
      exportOrders = monthlyOrders;
      reportSubtitle = format(new Date(parseInt(selectedYear), parseInt(selectedMonth), 1), "MMMM yyyy");
    }

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
    const tableData = exportOrders.length > 0 ? exportOrders.map(order => [
      order.orderNumber || "Not Specified",
      formatDateSafe(order.createdAt),
      order.clientName || "Not Specified",
      getClientTypeLabel(order),
      order.clientPhone && order.clientPhone.trim() ? order.clientPhone.trim() : "Not Specified",
      getServicesLabel(order),
      order.assignee?.name || "Unassigned",
      formatRs(order.totalPrice),
      formatRs(order.remainingAmount),
    ]) : [["No orders found.", "", "", "", "", "", "", "", ""]];

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
        "Service", "Designer", "Total Bill", "Remaining",
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
        0: { cellWidth: 68 },
        1: { cellWidth: 62 },
        2: { cellWidth: 100 },
        3: { cellWidth: 52 },
        4: { cellWidth: 82 },
        5: { cellWidth: 158 },
        6: { cellWidth: 80 },
        7: { cellWidth: 70, halign: "right" },
        8: { cellWidth: 78, halign: "right" },
      },
      margin: { left: marginX, right: marginX, bottom: 42 },
      showHead: "everyPage",
      didDrawPage: drawReportFooter,
    });

    const fileSuffix = isSearchActive
      ? `search-results-${format(new Date(), "yyyy-MM-dd")}`
      : activeOrdersTab === "today"
      ? `today-${format(new Date(), "yyyy-MM-dd")}`
      : format(new Date(parseInt(selectedYear), parseInt(selectedMonth), 1), "MMMM-yyyy");

    doc.save(`orders-${fileSuffix}.pdf`);
  };

  // ── Shared order table (used by Search, Today, and Monthly so they stay identical) ──
  const getStatusOptionsFor = (order: OrderWithServices) => {
    if (isDesigner) {
      if (order.status === 'delivered') return [{ value: "delivered", label: "Delivered" }];
      const hasNoRemaining = (order.remainingAmount ?? 0) === 0;
      if (order.status === 'ready') {
        if (hasNoRemaining) return [{ value: "ready", label: "Ready" }, { value: "delivered", label: "Delivered" }];
        return [{ value: "ready", label: "Ready" }];
      }
      const opts = [
        { value: "new", label: "New" },
        { value: "working", label: "Working" },
        { value: "ready", label: "Ready" },
      ];
      if (hasNoRemaining) opts.push({ value: "delivered", label: "Delivered" });
      return opts;
    }
    if (isSupport) {
      return [
        { value: "new", label: "New" },
        { value: "working", label: "Working" },
        { value: "ready", label: "Ready" },
        { value: "delivered", label: "Delivered" },
      ];
    }
    return [
      { value: "new", label: "New" },
      { value: "working", label: "Working" },
      { value: "ready", label: "Ready" },
      { value: "delivered", label: "Delivered" },
      { value: "canceled", label: "Canceled" },
    ];
  };

  const orderColSpan = 9 + (!isDesigner ? 2 : 0) + (canSeeAmounts ? 3 : 0) + (isAdmin ? 1 : 0);

  const orderTableHead = (
    <TableHeader className="bg-slate-900/50">
      <TableRow className="border-slate-800 hover:bg-transparent">
        <TableHead className="text-slate-400">Order ID</TableHead>
        {isAdmin && <TableHead className="text-slate-400">Created By</TableHead>}
        <TableHead className="text-slate-400">Date Placed</TableHead>
        <TableHead className="text-slate-400">Client</TableHead>
        <TableHead className="text-slate-400">Client Type</TableHead>
        <TableHead className="text-slate-400">Contact</TableHead>
        <TableHead className="text-slate-400">Services</TableHead>
        {!isDesigner && <TableHead className="text-slate-400">Designer</TableHead>}
        <TableHead className="text-slate-400">Status</TableHead>
        {!isDesigner && <TableHead className="text-slate-400">Adv. Payment</TableHead>}
        <TableHead className="text-slate-400">Payment</TableHead>
        {canSeeAmounts && <TableHead className="text-slate-400 text-right">Total Bill</TableHead>}
        {canSeeAmounts && <TableHead className="text-slate-400 text-right">Advance</TableHead>}
        {canSeeAmounts && <TableHead className="text-slate-400 text-right">Remaining</TableHead>}
        <TableHead className="text-right text-slate-400">Actions</TableHead>
      </TableRow>
    </TableHeader>
  );

  const renderOrderRow = (order: OrderWithServices) => (
    <TableRow key={order.id} className="border-slate-800 hover:bg-slate-900/50" data-testid={`row-order-${order.id}`}>
       <TableCell className="whitespace-nowrap font-mono text-xs text-cyan-300">{order.orderNumber || "—"}</TableCell>
      {isAdmin && (
        <TableCell>
          <div className="min-w-28">
            <p className="text-white text-sm font-medium">{getCreatedByLabel(order).split(" (")[0]}</p>
            <p className="text-xs text-slate-500">
              {getCreatedByLabel(order).match(/\(([^)]+)\)/)?.[1] || ""}
            </p>
          </div>
        </TableCell>
      )}
       <TableCell className="whitespace-nowrap text-xs text-slate-400">{order.createdAt ? format(new Date(order.createdAt), "MMM dd, yyyy") : "Not Specified"}</TableCell>
       <TableCell className="min-w-36 whitespace-nowrap font-medium text-white">{order.clientName || "Not Specified"}</TableCell>
      <TableCell>
         <span className="whitespace-nowrap text-sm text-slate-300">
          {getClientTypeLabel(order)}
        </span>
      </TableCell>
      <TableCell>
        {order.clientPhone ? (
          <div className="flex items-center gap-1">
            <span className="text-slate-300 text-sm">{order.clientPhone}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-slate-400 hover:text-white"
              onClick={() => copyPhone(order.id, order.clientPhone!)}
              data-testid={`button-copy-phone-${order.id}`}
            >
              {copiedPhone === order.id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
            </Button>
          </div>
        ) : (
          <span className="text-slate-500 text-sm">-</span>
        )}
      </TableCell>
       <TableCell className="min-w-40 text-sm text-slate-300">{getServicesDisplay(order)}</TableCell>
      {!isDesigner && (
       <TableCell className="whitespace-nowrap">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] text-slate-400">
              {order.assignee?.name?.charAt(0) || "?"}
            </div>
            <span className="text-sm text-slate-300">{order.assignee?.name || "Unassigned"}</span>
          </div>
        </TableCell>
      )}
       <TableCell className="whitespace-nowrap">
        <Select
          defaultValue={order.status}
          onValueChange={(val) => updateOrderMutation.mutate({ id: order.id, updates: { status: val } })}
        >
          <SelectTrigger className="w-32 bg-transparent border-0 h-auto p-0 focus:ring-0 shadow-none hover:bg-white/5 rounded px-2 py-1" data-testid={`select-status-${order.id}`}>
            <SelectValue>{getStatusBadge(order.status)}</SelectValue>
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-800">
            {getStatusOptionsFor(order).map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      {!isDesigner && (
       <TableCell className="whitespace-nowrap">
         {isAdmin ? (
            <Select
              defaultValue={order.advancePaymentStatus || "pending"}
              onValueChange={(val) => updateOrderMutation.mutate({ id: order.id, updates: { advancePaymentStatus: val } })}
            >
              <SelectTrigger className="w-32 bg-transparent border-0 h-auto p-0 focus:ring-0 shadow-none hover:bg-white/5 rounded px-2 py-1" data-testid={`select-adv-payment-${order.id}`}>
                <SelectValue>{getAdvancePaymentStatusBadge(order.advancePaymentStatus)}</SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800">
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="disapproved">Disapproved</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            getAdvancePaymentStatusBadge(order.advancePaymentStatus)
          )}
        </TableCell>
      )}
      <TableCell>
        {isAdmin ? (
          <Select
            defaultValue={order.paymentStatus || "pending"}
            onValueChange={(val) => updateOrderMutation.mutate({ id: order.id, updates: { paymentStatus: val } })}
          >
           <SelectTrigger className="h-auto w-28 rounded border-0 bg-transparent p-0 px-2 py-1 shadow-none hover:bg-white/5 focus:ring-0" data-testid={`select-payment-${order.id}`}>
             <SelectValue>
               <PaymentLineStatusBadge status={order.paymentStatus} />
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800">
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>
        ) : (
           <PaymentLineStatusBadge status={order.paymentStatus} />
        )}
      </TableCell>
       {canSeeAmounts && (
         <TableCell className="whitespace-nowrap text-right font-medium text-white">{formatRs(order.totalPrice)}</TableCell>
      )}
      {canSeeAmounts && (
         <TableCell className="whitespace-nowrap text-right font-medium">
           <span className={order.status === "canceled" && order.advanceRefunded ? "text-slate-500 line-through" : Number(order.advanceAmount || 0) > 0 ? "text-emerald-300" : "text-slate-500"}>{formatRs(order.advanceAmount)}</span>
           {order.status === "canceled" && <span className={cn("ml-1 text-[10px]", order.advanceRefunded ? "text-rose-300" : "text-slate-400")}>{order.advanceRefunded ? "Refunded" : "Retained"}</span>}
         </TableCell>
      )}
      {canSeeAmounts && (
         <TableCell className="whitespace-nowrap text-right font-medium">
           <span className={order.status === "canceled" ? "text-slate-500 line-through" : getOrderAccounting(order).remainingReceivable > 0 ? "text-rose-300" : "text-emerald-300"}>{formatRs(order.status === "canceled" ? order.remainingAmount : getOrderAccounting(order).remainingReceivable)}</span>
           {order.status === "canceled" && <span className="ml-1 text-[10px] text-rose-300">Canceled</span>}
         </TableCell>
      )}
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
           {(isAdmin || isSupport) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-950/30"
              onClick={() => {
                setSelectedOrder(order);
                setComplaintDialogOpen(true);
              }}
              disabled={!order.assignedToId}
              title={order.assignedToId ? "Raise complaint" : "Assign a designer before raising a complaint"}
              data-testid={`button-complaint-${order.id}`}
            >
              <FileWarning className="w-4 h-4" />
            </Button>
          )}
          {(isAdmin || isSupport) && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white" data-testid={`button-assign-${order.id}`}><UserPlus className="w-4 h-4" /></Button>
              </DialogTrigger>
              <DialogContent className="bg-slate-900 border-slate-800">
                <DialogHeader><DialogTitle className="text-white font-display">Assign Designer</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                  <Select
                    defaultValue={order.assignedToId?.toString()}
                    onValueChange={(val) => updateOrderMutation.mutate({ id: order.id, updates: { assignedToId: parseInt(val) } })}
                  >
                    <SelectTrigger className="bg-slate-950 border-slate-800 text-white">
                      <SelectValue placeholder="Select designer" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-800 text-white">
                      {availableDesigners.map(designer => (
                        <SelectItem key={designer.id} value={designer.id.toString()}>{designer.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </DialogContent>
            </Dialog>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white" data-testid={`button-menu-${order.id}`}>
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-slate-900 border-slate-800">
              <DropdownMenuItem onClick={() => openOrderDetails(order)} className="text-slate-300 hover:text-white" data-testid={`menu-view-details-${order.id}`}>
                <FileText className="w-4 h-4 mr-2" />
                View Details
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem onClick={() => { setOrderToEdit(order); setEditSheetOpen(true); }} className="text-slate-300 hover:text-white" data-testid={`menu-edit-${order.id}`}>
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit Order
                </DropdownMenuItem>
              )}
              {isAdmin && order.status !== 'canceled' && (
                <>
                  <DropdownMenuSeparator className="bg-slate-800" />
                  <DropdownMenuItem
                    onClick={() => { setOrderToCancel(order); setCancellationReason(""); setAdvanceDisposition(""); }}
                    className="text-red-400 hover:text-red-300"
                    data-testid={`menu-cancel-${order.id}`}
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Cancel Order
                  </DropdownMenuItem>
                </>
              )}
              {isAdmin && (
                <>
                  <DropdownMenuSeparator className="bg-slate-800" />
                  <DropdownMenuItem
                    onClick={() => { setOrderToDelete(order); setDeleteConfirmText(""); }}
                    className="text-red-400 hover:text-red-300"
                    data-testid={`menu-delete-${order.id}`}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Order
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="crm-page space-y-5">
      {deepLinkMessage && <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100"><span>{deepLinkMessage}</span><Button variant="ghost" size="sm" onClick={() => { setDeepLinkMessage(null); setLocation("/orders"); }}>Clear link</Button></div>}
      <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-md">
          <PageHeader eyebrow="Client operations" title="Orders Management" description="Manage ATS CV, LinkedIn, and Cover Letter requests." />
        </div>

        <div className="flex w-full flex-col gap-3 xl:w-auto xl:min-w-[680px]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1 sm:min-w-[280px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                placeholder="Search Order ID or Client..."
                className="h-10 pl-10 bg-slate-900 border-slate-800 text-white"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-orders"
              />
              {isSearchSettling && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 animate-spin" data-testid="icon-search-loading" />
              )}
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              {isAdmin && (
                <Button variant="outline" onClick={exportOrdersPDF} data-testid="button-export-orders">
                  <Download className="w-4 h-4 mr-2" />
                  Export PDF
                </Button>
              )}

              {canCreateOrder && (
                <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="bg-primary" data-testid="button-create-order">
                      <Plus className="w-4 h-4 mr-2" />
                      Create Order
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-slate-900 border-slate-800 max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="text-white font-display text-xl">Create New Order</DialogTitle>
                    </DialogHeader>
                    <CreateOrderForm
                      designers={availableDesigners}
                      onSuccess={() => setCreateDialogOpen(false)}
                    />
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2" data-testid="order-filters">
            <Filter className="mr-1 hidden h-4 w-4 text-slate-500 md:block" aria-hidden="true" />
            <Select value={selectedStatusFilter} onValueChange={setSelectedStatusFilter}>
              <SelectTrigger className="w-36 bg-slate-900 border-slate-800 text-white" data-testid="select-order-status-filter">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-white">
                <SelectItem value="all">All statuses</SelectItem>
                {ORDER_STATUS_FILTERS.map(filter => (
                  <SelectItem key={filter.value} value={filter.value}>{filter.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(isAdmin || isSupport) && (
              <Select value={selectedDesignerFilter} onValueChange={setSelectedDesignerFilter}>
                <SelectTrigger className="w-40 bg-slate-900 border-slate-800 text-white" data-testid="select-order-designer-filter">
                  <SelectValue placeholder="All designers" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-white">
                  <SelectItem value="all">All designers</SelectItem>
                  {designerFilterOptions.map(designer => (
                    <SelectItem key={designer.id} value={designer.id.toString()}>{designer.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {hasActiveOrderFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedStatusFilter("all");
                  setSelectedDesignerFilter("all");
                }}
                className="text-slate-400 hover:text-white"
                data-testid="button-clear-order-filters"
              >
                <X className="w-4 h-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <CRMMetricCard label="Total monthly" value={approvedMonthlyOrders.length} icon={Package} />
          <CRMMetricCard label="Delivered" value={approvedMonthlyOrders.filter(o => o.status === 'delivered').length} icon={CheckCircle2} tone="success" />
          <CRMMetricCard label="Monthly revenue" value={`Rs${Math.round(monthlyRevenue / 100).toLocaleString()}`} icon={TrendingUp} testId="text-monthly-revenue" />
          <CRMMetricCard label="Collected" value={`Rs${Math.round(approvedMonthlyOrders.reduce((acc, o) => acc + getOrderAccounting(o).netCollected, 0) / 100).toLocaleString()}`} icon={TrendingUp} tone="success" />
          <CRMMetricCard label="Remaining" value={`Rs${Math.round(approvedMonthlyOrders.reduce((acc, o) => acc + getOrderAccounting(o).remainingReceivable, 0) / 100).toLocaleString()}`} icon={AlertCircle} tone="warning" />
          <CRMMetricCard label="Today's revenue" value={`Rs${Math.round(approvedTodayOrders.reduce((acc, o) => acc + getOrderAccounting(o).accountedTotal, 0) / 100).toLocaleString()}`} icon={CalendarIcon} />
        </div>
      )}

      {isSearchActive ? (
        <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden" data-testid="panel-search-results">
          <div className="p-6 border-b border-slate-800">
            <h3 className="text-lg font-bold text-white">Search Results</h3>
            <p className="text-sm text-slate-500" data-testid="text-search-result-count">
              {searchTotalMatches > universalSearchResults.length
                ? `Showing first ${universalSearchResults.length} of ${searchTotalMatches} matching orders — refine your search to see the rest`
                : `${searchTotalMatches} matching order${searchTotalMatches === 1 ? "" : "s"} — active filters apply while month/year filters are ignored during search`}
            </p>
          </div>
          <div className="table-scroll-wrapper">
            <Table>
              {orderTableHead}
              <TableBody>
                {universalSearchResults.map((order) => renderOrderRow(order))}
                {universalSearchResults.length === 0 && (
                  <TableRow className="border-slate-800">
                    <TableCell colSpan={orderColSpan} className="text-center text-slate-500 py-8" data-testid="text-no-search-results">
                      {hasActiveOrderFilters ? "No orders match the selected filters." : "No matching orders found."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
      <Tabs value={activeOrdersTab} onValueChange={(val) => setActiveOrdersTab(val as "today" | "monthly")} className="w-full">
        <TabsList className="mb-6 w-full justify-start border border-slate-800 bg-slate-900/70 p-1 sm:w-fit">
          <TabsTrigger value="today" className="px-5" data-testid="tab-today-orders">Today's Orders</TabsTrigger>
          <TabsTrigger value="monthly" className="px-5" data-testid="tab-monthly-orders">Monthly Orders</TabsTrigger>
        </TabsList>

        <TabsContent value="today">
          <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
            <div className="p-6 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white">Today's Orders</h3>
              <p className="text-sm text-slate-500">Orders created today</p>
            </div>
            {/* Table view – Today */}
            <div className="table-scroll-wrapper">
            <Table>
              {orderTableHead}
              <TableBody>
                {todayOrders?.map((order) => renderOrderRow(order))}
                {(!todayOrders || todayOrders.length === 0) && (
                  <TableRow className="border-slate-800">
                    <TableCell colSpan={orderColSpan} className="text-center text-slate-500 py-8">
                      {hasActiveOrderFilters ? "No orders match the selected filters today." : "No orders for today"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="monthly">
          <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
            <div className="p-6 border-b border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h3 className="text-lg font-bold text-white">Monthly Orders</h3>
                <p className="text-sm text-slate-500">All orders for the selected month</p>
              </div>
              
              <div className="flex gap-2">
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="w-24 bg-slate-900 border-slate-800 text-white" data-testid="select-year">
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-white">
                    {[2024, 2025, 2026, 2027].map((year) => (
                      <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="w-36 bg-slate-900 border-slate-800 text-white" data-testid="select-month">
                    <CalendarIcon className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-white">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <SelectItem key={i} value={i.toString()}>{format(new Date(2026, i, 1), "MMMM")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {/* Table view – Monthly */}
            <div className="table-scroll-wrapper">
            <Table>
              {orderTableHead}
              <TableBody>
                {monthlyOrders?.map((order) => renderOrderRow(order))}
                {(!monthlyOrders || monthlyOrders.length === 0) && (
                  <TableRow className="border-slate-800">
                    <TableCell colSpan={orderColSpan} className="text-center text-slate-500 py-8">
                      {hasActiveOrderFilters ? "No orders match the selected filters this month." : "No orders for this month"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
      )}

      <Sheet open={detailsSheetOpen} onOpenChange={open => { if (!open) closeDrawer(); }}>
        <SheetContent className="detail-drawer bg-slate-950 border-slate-800 w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="detail-drawer-header border-b border-slate-800 pb-5 pr-8 text-left">
            <SheetTitle className="text-white font-display flex items-center gap-2">
              {activeDrawer?.kind !== "order" && <Button variant="ghost" size="icon" className="h-8 w-8 -ml-2" onClick={goBackInDrawer} aria-label="Back to order details"><ArrowLeft className="h-4 w-4" /></Button>}
              <FileText className="w-5 h-5" />
              {activeDrawer?.kind === "complaint" ? "Complaint Details" : activeDrawer?.kind === "review" ? "Review Details" : activeDrawer?.kind === "suggestion" ? "Suggestion Details" : "Order Details"}
            </SheetTitle>
          </SheetHeader>
          {selectedOrder && activeDrawer?.kind === "order" && (
            <div className="detail-drawer-body mt-6 space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-2xl font-bold text-blue-400 font-mono">{selectedOrder.orderNumber}</span>
                  {getStatusBadge(selectedOrder.status)}
                </div>
                <p className="text-slate-400 text-sm">Created {format(new Date(selectedOrder.createdAt!), "MMMM dd, yyyy 'at' h:mm a")}</p>
                <Button size="sm" variant="outline" disabled={clientCaseReportMutation.isPending} onClick={() => clientCaseReportMutation.mutate(selectedOrder.id)}><Download className="mr-2 h-4 w-4" />{clientCaseReportMutation.isPending ? "Preparing report…" : "Client Case Report"}</Button>
              </div>

              <div className="detail-section detail-section-emphasis">
                <h4 className="detail-section-label">Order Summary</h4>
                <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div><p className="text-xs text-slate-500">Order ID</p><p className="mt-1 font-mono text-sm text-white">{selectedOrder.orderNumber}</p></div>
                  <div><p className="text-xs text-slate-500">Status</p><p className="mt-1 text-sm text-white">{reportStatus(selectedOrder.status)}</p></div>
                  <div><p className="text-xs text-slate-500">Created</p><p className="mt-1 text-sm text-white">{format(selectedOrder.createdAt ? new Date(selectedOrder.createdAt) : new Date(), "MMM dd, yyyy · h:mm a")}</p></div>
                  <div><p className="text-xs text-slate-500">Created By</p><p className="mt-1 text-sm text-white">{getCreatedByLabel(selectedOrder).split(" (")[0]}</p><p className="mt-0.5 text-xs text-slate-500">{getCreatedByLabel(selectedOrder).match(/\(([^)]+)\)/)?.[1] || ""}</p></div>
                </div>
              </div>

              <Tabs value={detailsTab} onValueChange={value => setOrderDrawerTab(value as OrderDrawerTab)}>
                <TabsList className="grid h-auto w-full grid-cols-3 border border-slate-800 bg-slate-900/70 p-1">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                  <TabsTrigger value="experience">Client Experience</TabsTrigger>
                </TabsList>
              </Tabs>

              {detailsTab === "overview" && <>
              <div className="space-y-3 p-4 bg-slate-950 rounded-lg border border-slate-800">
                <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Client Information</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-slate-500">Name</p>
                    <p className="text-white font-medium">{selectedOrder.clientName}</p>
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

              <div className="space-y-3 p-4 bg-slate-950 rounded-lg border border-slate-800">
                <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                  Services & Package
                </h4>
                {selectedOrder.packageType && selectedOrder.packageType !== "custom" ? (
                  <div className="space-y-3">
                    <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-sm px-3 py-1">
                      {packageLabels[selectedOrder.packageType] || selectedOrder.packageType}
                    </Badge>
                    {selectedOrder.services.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Add-ons</p>
                        {selectedOrder.services.map((service, idx) => (
                          <div key={idx} className="flex justify-between items-center py-2 border-b border-slate-800 last:border-0">
                            <div>
                              <p className="text-white">+ {service.serviceType}</p>
                              {service.instructions && <p className="text-xs text-slate-500">{service.instructions}</p>}
                            </div>
                            <Badge variant="outline" className="text-slate-300">x{service.quantity}</Badge>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">No add-ons selected.</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedOrder.services.length > 0 ? selectedOrder.services.map((service, idx) => (
                      <div key={idx} className="flex justify-between items-center py-2 border-b border-slate-800 last:border-0">
                        <div>
                          <p className="text-white">{service.serviceType}</p>
                          {service.instructions && <p className="text-xs text-slate-500">{service.instructions}</p>}
                        </div>
                        <Badge variant="outline" className="text-slate-300">x{service.quantity}</Badge>
                      </div>
                    )) : <p className="text-sm text-slate-500">No services selected.</p>}
                  </div>
                )}
              </div>

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
                  </div>
                  {selectedOrder.status === "canceled" && <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-3 text-sm"><div><p className="text-xs text-slate-500">Net Collected</p><p className="mt-1 font-medium text-white">{formatRs(selectedOrder.advanceRefunded ? 0 : selectedOrder.advanceAmount)}</p></div><div><p className="text-xs text-slate-500">Remaining Receivable</p><p className="mt-1 font-medium text-white">Rs0</p></div><div className="col-span-2"><p className="text-xs text-slate-500">Cancellation Reason</p><p className="mt-1 text-slate-300">{selectedOrder.cancellationReason || "Legacy cancellation — reason not recorded."}</p></div></div>}
                </div>
              )}

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

              {detailsTab === "experience" && (
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
        orders={orders || []}
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
            <SheetHeader>
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
                  className="bg-red-600 hover:bg-red-700 text-white"
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

  const { data: packageConfigsData = [] } = useQuery<PackageConfig[]>({
    queryKey: ["/api/package-configs"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: platformsCatalogData = [] } = useQuery<PlatformCatalogItem[]>({
    queryKey: ["/api/platforms-catalog"],
    staleTime: 5 * 60 * 1000,
  });

  const activeFormServiceTypes = servicesCatalogData.filter(s => s.isActive).map(s => s.name);
  const formServiceTypes = activeFormServiceTypes.length > 0 ? activeFormServiceTypes : FALLBACK_SERVICE_TYPES;
  const activeFormPackages = packageConfigsData.filter(p => p.isActive);
  const activePlatforms = platformsCatalogData.filter(p => p.isActive);

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
  const [packageType, setPackageType] = useState<string>(order.packageType || "custom");
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
    if (!packageType) missingFields.push("Package");
    if (packageType === "custom" && services.every(s => !s.serviceType)) missingFields.push("At least one service");

    if (missingFields.length > 0) {
      toast({ title: "Missing Fields", description: `Please fill: ${missingFields.join(", ")}`, variant: "destructive" });
      return;
    }

    const totalPriceValue = totalBill ? Math.round(parseFloat(totalBill) * 100) : 0;
    const discountValue = order.discountAmount || 0;
    const finalPayableValue = Math.max(0, totalPriceValue - discountValue);
    const advanceValue = advanceAmount ? Math.round(parseFloat(advanceAmount) * 100) : 0;
    const remainingValue = Math.max(0, finalPayableValue - advanceValue);

    const orderServices = services.filter(s => s.serviceType).map(s => ({
      serviceType: s.serviceType,
      quantity: s.quantity || 1,
      instructions: s.instructions || null,
    }));

    setIsSaving(true);
    try {
      await apiRequest("PATCH", `/api/orders/${order.id}`, {
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
        packageType: packageType || null,
        platform: platform.trim() || null,
        campaign: campaign.trim() || null,
        adSet: adSet.trim() || null,
        creative: creative.trim() || null,
        notes: notes.trim() || null,
        services: orderServices,
      });

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

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Package *</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ...activeFormPackages.map((p, i) => {
              const icons = [Package, Star, Crown, Package];
              const Icon = icons[i % icons.length];
              return { value: p.key, label: p.label, Icon };
            }),
            { value: "custom", label: "Custom Order", Icon: Wrench },
          ].map((pkg) => (
            <button
              key={pkg.value}
              type="button"
              onClick={() => {
                setPackageType(pkg.value);
              }}
              className={`p-4 rounded-xl border-2 text-center transition-all ${
                packageType === pkg.value
                  ? "border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/30"
                  : "border-slate-800 bg-slate-950 hover:border-slate-700"
              }`}
              data-testid={`edit-button-package-${pkg.value}`}
            >
              <div className="flex justify-center mb-2">
                <pkg.Icon className={`w-6 h-6 ${packageType === pkg.value ? "text-blue-400" : "text-slate-400"}`} />
              </div>
              <div className={`text-sm font-semibold ${packageType === pkg.value ? "text-blue-400" : "text-white"}`}>
                {pkg.label}
              </div>
            </button>
          ))}
        </div>
      </div>

      {packageType && (
        <div className="space-y-4" ref={customServicesTopRef}>
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                {packageType === "custom" ? "Services *" : "Add-ons"}
              </h4>
              <p className="mt-1 text-xs text-slate-500">
                {packageType === "custom" ? "Add the services included in this custom order." : "Optional — add as many additional services as this order needs."}
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={addService} className="text-blue-400 hover:text-blue-300" data-testid="edit-button-add-service">
              <Plus className="w-4 h-4 mr-1" /> Add {packageType === "custom" ? "Service" : "Add-on"}
            </Button>
          </div>

          {services.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/60 px-4 py-5 text-sm text-slate-500">
              {packageType === "custom" ? "Add at least one service for this custom order." : "No add-ons selected."}
            </div>
          ) : services.map((service, index) => (
            <div key={service.id} className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">{packageType === "custom" ? "Service" : "Add-on"} {service.serviceNumber}</span>
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

function CreateOrderForm({ designers, onSuccess }: { designers: User[]; onSuccess: () => void }) {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  const { data: servicesCatalogData = [] } = useQuery<ServiceCatalogItem[]>({
    queryKey: ["/api/services-catalog"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: packageConfigsData = [] } = useQuery<PackageConfig[]>({
    queryKey: ["/api/package-configs"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: platformsCatalogData = [] } = useQuery<PlatformCatalogItem[]>({
    queryKey: ["/api/platforms-catalog"],
    staleTime: 5 * 60 * 1000,
  });

  const activeFormServiceTypes = servicesCatalogData.filter(s => s.isActive).map(s => s.name);
  const formServiceTypes = activeFormServiceTypes.length > 0 ? activeFormServiceTypes : FALLBACK_SERVICE_TYPES;
  const activeFormPackages = packageConfigsData.filter(p => p.isActive);
  const activePlatforms = platformsCatalogData.filter(p => p.isActive);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientType, setClientType] = useState<"national" | "international">("national");
  const [assignedToId, setAssignedToId] = useState("");
  const [totalBill, setTotalBill] = useState("");
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [platform, setPlatform] = useState("");
  const [campaign, setCampaign] = useState("");
  const [adSet, setAdSet] = useState("");
  const [creative, setCreative] = useState("");
  const [notes, setNotes] = useState("");
  const [packageType, setPackageType] = useState<string>("");
  const serviceIdRef = useRef(1);
  const nextServiceNumberRef = useRef(1);
  const [services, setServices] = useState<OrderFormService[]>([]);
  const customServicesTopRef = useRef<HTMLDivElement | null>(null);
  
  // Payment verification fields
  const [paymentScreenshot, setPaymentScreenshot] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/orders", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Success", description: "Order created successfully" });
      onSuccess();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create order", variant: "destructive" });
    },
  });

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
    
    const totalPriceValue = totalBill ? Math.round(parseFloat(totalBill) * 100) : 0;
    const discountValue = 0;
    const finalPayableValue = totalPriceValue;
    const advanceValue = advanceAmount ? Math.round(parseFloat(advanceAmount) * 100) : 0;
    const remainingValue = Math.max(0, finalPayableValue - advanceValue);
    const isSupport = currentUser?.role !== 'admin';

    const missingFields: string[] = [];
    if (!clientName.trim()) missingFields.push("Client Name");
    if (!clientPhone.trim()) missingFields.push("Phone Number");
    if (!clientType) missingFields.push("Client Type");
    if (!packageType) missingFields.push("Package");
    if (packageType === "custom" && services.every(s => !s.serviceType)) missingFields.push("At least one service");
    if (!totalBill.trim() || totalPriceValue <= 0) missingFields.push("Total Bill");
    if (isSupport && advanceValue <= 0) missingFields.push("Advance Paid (greater than 0)");
    if (isSupport && advanceValue > 0 && !paymentScreenshot) missingFields.push("Payment Screenshot / Proof");

    if (missingFields.length > 0) {
      toast({ 
        title: "Missing Fields", 
        description: `Please fill: ${missingFields.join(", ")}`, 
        variant: "destructive" 
      });
      return;
    }

    if (advanceValue > totalPriceValue) {
      toast({ 
        title: "Invalid amount", 
        description: "Advance paid cannot be greater than total bill.", 
        variant: "destructive" 
      });
      return;
    }

    // The payment verification stores the advance collected. If the advance
    // covers the full bill, record it as a full payment.
    const paymentType: "advance" | "full" = advanceValue >= finalPayableValue && advanceValue > 0 ? "full" : "advance";
    const paymentAmount = advanceValue;

    setIsUploading(true);
    try {
      const orderServices = services.filter(s => s.serviceType).map(s => ({
        serviceType: s.serviceType,
        quantity: s.quantity || 1,
        instructions: s.instructions || null,
      }));

      const isAdmin = currentUser?.role === 'admin';
      const orderRes = await apiRequest("POST", "/api/orders", {
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim(),
        clientType,
        assignedToId: assignedToId ? parseInt(assignedToId) : null,
        paymentStatus: "pending",
        totalPrice: totalPriceValue,
        discountAmount: discountValue,
        paymentMethod: paymentMethod || null,
        // Admin: advance is collected immediately — send real values.
        // Support: advance goes through verification — starts at 0.
        advanceAmount: isAdmin ? advanceValue : 0,
        remainingAmount: isAdmin ? remainingValue : finalPayableValue,
        packageType: packageType || null,
        platform: platform.trim() || null,
        campaign: campaign.trim() || null,
        adSet: adSet.trim() || null,
        creative: creative.trim() || null,
        notes: notes.trim() || null,
        services: orderServices,
      });
      
      const order = await orderRes.json();
      
      // Then create payment verification request with screenshot
      if (paymentScreenshot && paymentAmount > 0) {
        const formData = new FormData();
        formData.append("screenshot", paymentScreenshot);
        formData.append("orderId", order.id.toString());
        formData.append("paymentType", paymentType);
        formData.append("amount", paymentAmount.toString());
        
        const verificationRes = await fetch("/api/payment-verifications", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        
        if (!verificationRes.ok) {
          const errorData = await verificationRes.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to submit payment verification");
        }
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications"] });
      if (currentUser?.role === 'admin') {
        toast({ title: "Order placed", description: "Order created and approved automatically" });
      } else if (paymentScreenshot) {
        toast({ title: "Order placed", description: "Payment screenshot submitted — awaiting admin approval" });
      } else {
        toast({ title: "Order placed", description: "Order created successfully" });
      }
      onSuccess();
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error?.message || "Failed to create order", 
        variant: "destructive" 
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Client Information</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">Client Name *</Label>
            <Input 
              value={clientName} 
              onChange={(e) => setClientName(e.target.value)} 
              className="bg-slate-950 border-slate-800 text-white"
              placeholder="Enter client name"
              data-testid="input-client-name"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Phone Number *</Label>
            <Input 
              value={clientPhone} 
              onChange={(e) => setClientPhone(e.target.value)} 
              className="bg-slate-950 border-slate-800 text-white"
              placeholder="+92 300 1234567"
              data-testid="input-client-phone"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Client Type *</Label>
            <Select value={clientType} onValueChange={(value: "national" | "international") => setClientType(value)}>
              <SelectTrigger className="bg-slate-950 border-slate-800 text-white" data-testid="select-client-type">
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
        <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Order Details</h4>
        <div className="space-y-2">
          <Label className="text-slate-300">Assigned Designer</Label>
          <Select value={assignedToId} onValueChange={setAssignedToId}>
            <SelectTrigger className="bg-slate-950 border-slate-800 text-white" data-testid="select-designer">
              <SelectValue placeholder="Select designer" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800 text-white">
              {designers.map(d => (
                <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Select Package *</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ...activeFormPackages.map((p, i) => {
              const icons = [Package, Star, Crown, Package];
              const Icon = icons[i % icons.length];
              return { value: p.key, label: p.label, Icon };
            }),
            { value: "custom", label: "Custom Order", Icon: Wrench },
          ].map((pkg) => (
            <button
              key={pkg.value}
              type="button"
              onClick={() => {
                setPackageType(pkg.value);
              }}
              className={`p-4 rounded-xl border-2 text-center transition-all ${
                packageType === pkg.value
                  ? "border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/30"
                  : "border-slate-800 bg-slate-950 hover:border-slate-700"
              }`}
              data-testid={`button-package-${pkg.value}`}
            >
              <div className="flex justify-center mb-2">
                <pkg.Icon className={`w-6 h-6 ${packageType === pkg.value ? "text-blue-400" : "text-slate-400"}`} />
              </div>
              <div className={`text-sm font-semibold ${packageType === pkg.value ? "text-blue-400" : "text-white"}`}>
                {pkg.label}
              </div>
            </button>
          ))}
        </div>
      </div>

      {packageType && (
        <div className="space-y-4" ref={customServicesTopRef}>
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                {packageType === "custom" ? "Services *" : "Add-ons"}
              </h4>
              <p className="mt-1 text-xs text-slate-500">
                {packageType === "custom" ? "Add the services included in this custom order." : "Optional — add as many additional services as this order needs."}
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={addService} className="text-blue-400 hover:text-blue-300" data-testid="button-add-service">
              <Plus className="w-4 h-4 mr-1" /> Add {packageType === "custom" ? "Service" : "Add-on"}
            </Button>
          </div>
          
          {services.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/60 px-4 py-5 text-sm text-slate-500">
              {packageType === "custom" ? "Add at least one service for this custom order." : "No add-ons selected."}
            </div>
          ) : services.map((service, index) => (
            <div key={service.id} className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">{packageType === "custom" ? "Service" : "Add-on"} {service.serviceNumber}</span>
                <Button type="button" variant="ghost" size="icon" onClick={() => removeService(service.id)} className="h-6 w-6 text-red-400 hover:text-red-300" data-testid={`button-remove-service-${index}`}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <Select value={service.serviceType} onValueChange={(val) => updateService(service.id, 'serviceType', val)}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white" data-testid={`select-service-type-${index}`}>
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
                  <Input 
                    type="number" 
                    min="1" 
                    value={service.quantity} 
                    onChange={(e) => updateService(service.id, 'quantity', parseInt(e.target.value) || 1)} 
                    onWheel={(e) => e.currentTarget.blur()}
                    className="bg-slate-900 border-slate-700 text-white"
                    placeholder="Qty"
                    data-testid={`input-quantity-${index}`}
                  />
                </div>
              </div>
              <Textarea 
                value={service.instructions} 
                onChange={(e) => updateService(service.id, 'instructions', e.target.value)} 
                className="bg-slate-900 border-slate-700 text-white resize-none"
                placeholder="Special instructions for this service..."
                rows={2}
                data-testid={`input-instructions-${index}`}
              />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Billing (PKR)</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">Total Bill (₨) *</Label>
            <Input 
              type="number"
              min="0"
              step="1"
              value={totalBill} 
              onChange={(e) => setTotalBill(e.target.value.replace(/[^0-9]/g, ''))} 
              onWheel={(e) => e.currentTarget.blur()}
              className="bg-slate-950 border-slate-800 text-white"
              placeholder="0"
              data-testid="input-total-bill"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Advance Paid (₨)</Label>
            <Input 
              type="number"
              min="0"
              step="1"
              value={advanceAmount} 
              onChange={(e) => setAdvanceAmount(e.target.value.replace(/[^0-9]/g, ''))} 
              onWheel={(e) => e.currentTarget.blur()}
              className="bg-slate-950 border-slate-800 text-white"
              placeholder="0"
              data-testid="input-advance-amount"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Remaining</Label>
            <div className="h-9 flex items-center px-3 bg-slate-950 border border-slate-800 rounded-md text-white" data-testid="text-remaining">
              ₨{Math.max(0, (parseInt(totalBill) || 0) - (parseInt(advanceAmount) || 0)).toLocaleString()}
            </div>
          </div>
        </div>
        {(parseInt(advanceAmount) || 0) > (parseInt(totalBill) || 0) && (
          <p className="text-xs text-red-400" data-testid="text-advance-warning">Advance paid cannot be greater than total bill.</p>
        )}
      </div>

      {currentUser?.role !== 'admin' && (
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
            Payment Screenshot / Proof <span className="text-red-400 normal-case font-normal">(Required)</span>
          </h4>
          <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
            <Input 
              type="file" 
              accept="image/png,image/jpeg,image/jpg,image/webp"
              onChange={(e) => setPaymentScreenshot(e.target.files?.[0] || null)}
              className={`bg-slate-900 border-slate-700 text-white file:bg-slate-800 file:text-slate-300 file:border-0 file:mr-3 ${(parseInt(advanceAmount) || 0) > 0 && !paymentScreenshot ? "border-red-500/50" : ""}`}
              data-testid="input-payment-screenshot"
            />
            {paymentScreenshot && (
              <p className="text-xs text-slate-400" data-testid="text-screenshot-filename">Selected: {paymentScreenshot.name}</p>
            )}
            <p className="text-xs text-slate-500">
              Upload proof of the advance payment. Your order stays pending until an admin approves it.
            </p>
          </div>
        </div>
      )}

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
            <SelectTrigger className="bg-slate-950 border-slate-800 text-white" data-testid="select-platform">
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
                <Input 
                  value={campaign} 
                  onChange={(e) => setCampaign(e.target.value)} 
                  className="bg-slate-950 border-slate-800 text-white"
                  placeholder="Campaign name..."
                  data-testid="input-campaign"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Ad Set</Label>
                <Input 
                  value={adSet} 
                  onChange={(e) => setAdSet(e.target.value)} 
                  className="bg-slate-950 border-slate-800 text-white"
                  placeholder="Ad set name..."
                  data-testid="input-ad-set"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Creative</Label>
                <Input 
                  value={creative} 
                  onChange={(e) => setCreative(e.target.value)} 
                  className="bg-slate-950 border-slate-800 text-white"
                  placeholder="Creative name..."
                  data-testid="input-creative"
                />
              </div>
            </div>
          );
        })()}
      </div>

      <div className="space-y-2">
        <Label className="text-slate-300">Internal Notes</Label>
        <Textarea 
          value={notes} 
          onChange={(e) => setNotes(e.target.value)} 
          className="bg-slate-950 border-slate-800 text-white resize-none"
          placeholder="Add any internal notes..."
          rows={3}
          data-testid="input-notes"
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
        <Button type="submit" className="bg-primary" disabled={isUploading} data-testid="button-submit-order">
          {isUploading ? "Creating Order..." : "Create Order"}
        </Button>
      </div>
    </form>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ");
}
