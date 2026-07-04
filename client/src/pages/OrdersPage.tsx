import { useState, useRef } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { format, isToday, isPast, startOfMonth } from "date-fns";
import { 
  Search, 
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
  Star,
  Crown,
  Wrench,
  Pencil
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
import type { OrderWithServices, User, SupportDesignerAssignment, ServiceCatalogItem, PackageConfig, PlatformCatalogItem } from "@shared/schema";

const FALLBACK_SERVICE_TYPES = [
  "ATS CV",
  "Professional CV", 
  "Europass CV",
  "LinkedIn Profile",
  "Cover Letter (Professional)",
  "Cover Letter (Europass)",
];

const FALLBACK_PACKAGE_LABELS: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  executive: "Executive",
  custom: "Custom Order",
};

export default function OrdersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth().toString());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [activeOrdersTab, setActiveOrdersTab] = useState<"today" | "monthly">("today");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OrderWithServices | null>(null);
  const [detailsSheetOpen, setDetailsSheetOpen] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState<number | null>(null);
  const [orderToEdit, setOrderToEdit] = useState<OrderWithServices | null>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<OrderWithServices | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const { data: orders, isLoading } = useQuery<OrderWithServices[]>({
    queryKey: ["/api/orders"],
    refetchInterval: 30 * 1000,
    staleTime: 15 * 1000,
  });

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

  if (isLoading) return <OrdersSkeleton />;

  const isAdmin = user?.role === "admin";
  const isSupport = user?.role === "support";
  const isDesigner = user?.role === "designer";
  const canSeeFinance = isAdmin;
  const canSeeAmounts = isAdmin || isDesigner;
  const canCreateOrder = isAdmin || isSupport;

  const getAvailableDesigners = () => {
    const allDesigners = teamMembers?.filter(u => u.role === 'designer') || [];
    if (isSupport) {
      if (!designerAssignments) return [];
      const assignedIds = designerAssignments.map(a => a.designerUserId);
      return allDesigners.filter(d => assignedIds.includes(d.id));
    }
    return allDesigners;
  };
  const availableDesigners = getAvailableDesigners();
  
  const copyPhone = (orderId: number, phone: string) => {
    navigator.clipboard.writeText(phone);
    setCopiedPhone(orderId);
    toast({ title: "Copied", description: "Phone number copied to clipboard" });
    setTimeout(() => setCopiedPhone(null), 2000);
  };
  
  const openOrderDetails = (order: OrderWithServices) => {
    setSelectedOrder(order);
    setDetailsSheetOpen(true);
  };

  // All roles only see approved orders in the Orders Page
  // Unapproved orders are reviewed exclusively in the Payments page
  const visibleOrders = orders?.filter(order => order.advancePaymentStatus === 'approved') || [];
  const approvedOrders = visibleOrders;

  const normalizePhoneValue = (value?: string | null) => (value || "").replace(/\D/g, "");

  const searchQueryNormalized = search.trim().toLowerCase();
  const phoneSearchQuery = search.replace(/\D/g, "");
  const isSearchActive = searchQueryNormalized.length > 0;

  // Universal search: searches across ALL orders (every month/year), not just the
  // currently selected month. Matches order ID, client name, and client phone
  // (phone numbers are compared with formatting characters stripped out).
  const universalSearchResults = isSearchActive
    ? visibleOrders.filter(order => {
        const orderIdMatch = (order.orderNumber?.toLowerCase() ?? "").includes(searchQueryNormalized);
        const clientNameMatch = (order.clientName?.toLowerCase() ?? "").includes(searchQueryNormalized);
        const clientPhoneNormalized = normalizePhoneValue(order.clientPhone);
        const phoneMatch = phoneSearchQuery.length > 0 && clientPhoneNormalized.includes(phoneSearchQuery);
        return orderIdMatch || clientNameMatch || phoneMatch;
      }).sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
    : [];

  const todayOrders = visibleOrders.filter(order => {
    const createdDate = new Date(order.createdAt!);
    // Only show orders created today
    if (!isToday(createdDate)) {
      return false;
    }
    // Designers only see orders assigned to them (filter out unassigned)
    if (isDesigner && order.assignedToId !== user?.id) {
      return false;
    }
    return true;
  });

  const monthlyOrders = visibleOrders.filter(order => {
    const createdDate = new Date(order.createdAt!);
    const inMonth = createdDate.getMonth().toString() === selectedMonth;
    const inYear = createdDate.getFullYear().toString() === selectedYear;
    if (isDesigner) {
      return inMonth && inYear && order.assignedToId === user?.id;
    }
    return inMonth && inYear;
  });

  // Approved monthly orders - same logic as dashboard (advancePaymentStatus === 'approved')
  const approvedMonthlyOrders = monthlyOrders.filter(o => o.advancePaymentStatus === 'approved');

  // Monthly Revenue: total order value (full order amount) for all approved orders
  // placed in the selected month/year — distinct from Collected (advance received)
  // and Remaining (unpaid balance).
  const monthlyRevenue = approvedMonthlyOrders.reduce((sum, order) => {
    const amount = Number(order.totalPrice ?? 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  // Approved today's orders — for Total Revenue of the day
  const approvedTodayOrders = (orders || []).filter(o =>
    o.advancePaymentStatus === 'approved' && isToday(new Date(o.createdAt!))
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending_payment": return <Badge variant="secondary" className="bg-orange-500/10 text-orange-500 border-orange-500/20">Pending Payment</Badge>;
      case "new": return <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">New</Badge>;
      case "working": return <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 border-blue-500/20">Working</Badge>;
      case "ready": return <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-green-500/20">Ready</Badge>;
      case "delivered": return <Badge variant="secondary" className="bg-slate-500/10 text-slate-400 border-slate-500/20">Delivered</Badge>;
      case "canceled": return <Badge variant="secondary" className="bg-red-500/10 text-red-500 border-red-500/20">Canceled</Badge>;
      default: return null;
    }
  };

  const getAdvancePaymentStatusBadge = (status: string | null | undefined) => {
    switch (status) {
      case "pending": return <Badge variant="secondary" className="bg-orange-500/10 text-orange-500 border-orange-500/20">Pending</Badge>;
      case "approved": return <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-green-500/20">Approved</Badge>;
      case "disapproved": return <Badge variant="secondary" className="bg-red-500/10 text-red-500 border-red-500/20">Disapproved</Badge>;
      default: return <Badge variant="secondary" className="bg-slate-500/10 text-slate-400 border-slate-500/20">-</Badge>;
    }
  };

  const getServicesDisplay = (order: OrderWithServices) => {
    if (order.packageType && order.packageType !== "custom") {
      const label = packageLabels[order.packageType] || order.packageType;
      return (
        <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
          {label}
        </Badge>
      );
    }
    
    const services = order.services;
    if (!services || services.length === 0) return "-";
    const totalServices = services.reduce((acc, s) => acc + (s.quantity || 1), 0);
    const servicesList = services.map(s => `${s.quantity}x ${s.serviceType}`);
    
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-pointer underline decoration-dotted underline-offset-2">
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
  
  const canDelete = isAdmin || isSupport;

  const getMobileStatusOptions = (order: OrderWithServices) => {
    if (isDesigner) {
      if (order.status === 'ready') return [{ value: "ready", label: "Ready" }];
      if (order.status === 'delivered') return [{ value: "delivered", label: "Delivered" }];
      return [
        { value: "new", label: "New" },
        { value: "working", label: "Working" },
        { value: "ready", label: "Ready" },
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
    return (order.packageType && order.packageType !== "custom")
      ? (packageLabels[order.packageType] || order.packageType)
      : (order.services?.map(s => `${s.quantity}x ${s.serviceType}`).join(", ") || "Not Specified");
  };

  const getFullServiceDetails = (order: OrderWithServices) => {
    if (order.packageType && order.packageType !== "custom") {
      return packageLabels[order.packageType] || order.packageType;
    }
    if (order.services && order.services.length > 0) {
      return order.services
        .map(s => `${s.quantity}x ${s.serviceType}${s.instructions ? ` (${s.instructions})` : ""}`)
        .join("; ");
    }
    return "Not Specified";
  };

  const exportOrdersPDF = () => {
    let exportOrders: OrderWithServices[];
    let reportTitle: string;

    if (isSearchActive) {
      exportOrders = universalSearchResults;
      reportTitle = "Search Results Export";
    } else if (activeOrdersTab === "today") {
      exportOrders = todayOrders;
      reportTitle = `Pixely Careers Orders Report - Today (${format(new Date(), "MMM dd, yyyy")})`;
    } else {
      const monthName = format(new Date(parseInt(selectedYear), parseInt(selectedMonth), 1), "MMMM yyyy");
      exportOrders = monthlyOrders;
      reportTitle = `Pixely Careers Orders Report - ${monthName}`;
    }

    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(reportTitle, 28, 30);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated: ${format(new Date(), "MMM dd, yyyy h:mm a")}`, 28, 44);

    const approvedExportOrders = exportOrders.filter(o => o.advancePaymentStatus === 'approved');
    const totalOrders = exportOrders.length;
    const revenue = approvedExportOrders.reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0);
    const collected = approvedExportOrders.reduce((sum, o) => sum + (Number(o.advanceAmount) || 0), 0);
    const remaining = approvedExportOrders.filter(o => o.status !== 'canceled').reduce((sum, o) => sum + (Number(o.remainingAmount) || 0), 0);
    const delivered = exportOrders.filter(o => o.status === 'delivered').length;
    const pending = exportOrders.filter(o => o.status === 'new' || o.status === 'working' || o.status === 'ready').length;

    let summaryY = 60;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Summary", 28, summaryY);
    doc.setFont("helvetica", "normal");
    summaryY += 14;
    const summaryLine1 = `Total Orders: ${totalOrders}     Monthly Revenue: ${formatRs(revenue)}     Collected: ${formatRs(collected)}`;
    const summaryLine2 = `Remaining: ${formatRs(remaining)}     Delivered: ${delivered}     Pending: ${pending}`;
    doc.text(summaryLine1, 28, summaryY);
    summaryY += 14;
    doc.text(summaryLine2, 28, summaryY);
    summaryY += 10;

    const tableData = exportOrders.length > 0 ? exportOrders.map(order => {
      const monthYear = order.createdAt ? format(new Date(order.createdAt), "MMMM yyyy") : "Not Specified";
      const finalPayable = Math.max(0, (Number(order.totalPrice) || 0) - (Number(order.discountAmount) || 0));
      const collectedAmount = Number(order.advanceAmount) || 0;
      const remainingAmount = Number(order.remainingAmount) || 0;

      return [
        order.orderNumber || "Not Specified",
        formatDateSafe(order.createdAt),
        monthYear,
        order.clientName || "Not Specified",
        order.clientPhone || "Not Specified",
        getServicesLabel(order),
        getFullServiceDetails(order),
        order.assignee?.name || "Unassigned",
        order.status ? order.status.charAt(0).toUpperCase() + order.status.slice(1) : "Not Specified",
        order.paymentStatus === "paid" ? "Paid" : (order.paymentStatus ? order.paymentStatus.charAt(0).toUpperCase() + order.paymentStatus.slice(1) : "Pending"),
        formatRs(order.totalPrice),
        formatRs(order.discountAmount),
        formatRs(finalPayable),
        formatRs(order.advanceAmount),
        formatRs(collectedAmount),
        formatRs(remainingAmount),
        order.paymentMethod ? (paymentMethodLabels[order.paymentMethod] || order.paymentMethod) : "Not Specified",
        formatDateSafe(order.paymentDate),
        formatDateSafe(order.deliveredAt),
        order.notes && order.notes.trim() ? order.notes : "Not Specified",
      ];
    }) : [["No orders found.", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]];

    autoTable(doc, {
      startY: summaryY + 6,
      head: [[
        "Order ID", "Date Placed", "Month/Year", "Client Name", "Phone",
        "Package/Services", "Full Service Details", "Designer", "Order Status", "Payment Status",
        "Total Amount", "Discount", "Final Payable", "Advance Paid", "Collected",
        "Remaining", "Payment Method", "Payment Date", "Delivered On", "Notes"
      ]],
      body: tableData,
      styles: { fontSize: 6.5, cellPadding: 3, overflow: "linebreak" },
      headStyles: { fillColor: [37, 99, 235], fontSize: 6.5, halign: "center" },
      columnStyles: {
        10: { halign: "right" },
        11: { halign: "right" },
        12: { halign: "right" },
        13: { halign: "right" },
        14: { halign: "right" },
        15: { halign: "right" },
      },
      margin: { left: 20, right: 20 },
      tableWidth: pageWidth - 40,
      showHead: "everyPage",
      didDrawPage: () => {
        // header repeats via showHead: 'everyPage'
      },
    });

    const fileSuffix = isSearchActive
      ? `search-results-${format(new Date(), "yyyy-MM-dd")}`
      : activeOrdersTab === "today"
      ? `today-${format(new Date(), "yyyy-MM-dd")}`
      : format(new Date(parseInt(selectedYear), parseInt(selectedMonth), 1), "MMMM-yyyy");

    doc.save(`orders-${fileSuffix}.pdf`);
  };

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-white mb-2">Orders Management</h1>
          <p className="text-slate-400">Manage ATS CV, LinkedIn, and Cover Letter requests.</p>
        </div>
        
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input 
              placeholder="Search Order ID or Client..." 
              className="pl-10 bg-slate-900 border-slate-800 text-white"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-orders"
            />
          </div>
          
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

      {isAdmin && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4">
          <div className="glass-panel p-4 rounded-xl border border-slate-800 flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500"><Package className="w-5 h-5" /></div>
            <div><p className="text-xs text-slate-500">Total Monthly</p><p className="font-bold text-white">{approvedMonthlyOrders.length}</p></div>
          </div>
          <div className="glass-panel p-4 rounded-xl border border-slate-800 flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg text-green-500"><CheckCircle2 className="w-5 h-5" /></div>
            <div><p className="text-xs text-slate-500">Delivered</p><p className="font-bold text-white">{approvedMonthlyOrders.filter(o => o.status === 'delivered').length}</p></div>
          </div>
          <div className="glass-panel p-4 rounded-xl border border-slate-800 flex items-center gap-3">
            <div className="p-2 bg-orange-500/10 rounded-lg text-orange-500"><Clock className="w-5 h-5" /></div>
            <div><p className="text-xs text-slate-500">Pending</p><p className="font-bold text-white">{approvedMonthlyOrders.filter(o => o.status === 'new' || o.status === 'working' || o.status === 'ready').length}</p></div>
          </div>
          <div className="glass-panel p-4 rounded-xl border border-slate-800 flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-500"><TrendingUp className="w-5 h-5" /></div>
            <div>
              <p className="text-xs text-slate-500">Monthly Revenue</p>
              <p className="font-bold text-white" data-testid="text-monthly-revenue">₨{Math.round(monthlyRevenue / 100).toLocaleString()}</p>
            </div>
          </div>
          <div className="glass-panel p-4 rounded-xl border border-slate-800 flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg text-green-500"><TrendingUp className="w-5 h-5" /></div>
            <div><p className="text-xs text-slate-500">Collected</p><p className="font-bold text-white">₨{Math.round(approvedMonthlyOrders.reduce((acc, o) => acc + (o.advanceAmount || 0), 0) / 100).toLocaleString()}</p></div>
          </div>
          <div className="glass-panel p-4 rounded-xl border border-slate-800 flex items-center gap-3">
            <div className="p-2 bg-red-500/10 rounded-lg text-red-500"><AlertCircle className="w-5 h-5" /></div>
            <div><p className="text-xs text-slate-500">Remaining</p><p className="font-bold text-white">₨{Math.round(approvedMonthlyOrders.filter(o => o.status !== 'canceled').reduce((acc, o) => acc + (o.remainingAmount || 0), 0) / 100).toLocaleString()}</p></div>
          </div>
          <div className="glass-panel p-4 rounded-xl border border-slate-800 flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg text-purple-500"><CalendarIcon className="w-5 h-5" /></div>
            <div>
              <p className="text-xs text-slate-500">Today's Revenue</p>
              <p className="font-bold text-white">₨{Math.round(approvedTodayOrders.reduce((acc, o) => acc + (o.advanceAmount || 0) + (o.remainingAmount || 0), 0) / 100).toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      {isSearchActive ? (
        <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden" data-testid="panel-search-results">
          <div className="p-6 border-b border-slate-800">
            <h3 className="text-lg font-bold text-white">Search Results</h3>
            <p className="text-sm text-slate-500">Showing results from all orders — month/year filters are ignored while searching</p>
          </div>
          <div className="table-scroll-wrapper">
            <Table>
              <TableHeader className="bg-slate-900/50">
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">Order ID</TableHead>
                  <TableHead className="text-slate-400">Date Placed</TableHead>
                  <TableHead className="text-slate-400">Client</TableHead>
                  <TableHead className="text-slate-400">Contact</TableHead>
                  <TableHead className="text-slate-400">Services</TableHead>
                  {!isDesigner && <TableHead className="text-slate-400">Designer</TableHead>}
                  <TableHead className="text-slate-400">Status</TableHead>
                  <TableHead className="text-slate-400">Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {universalSearchResults.map((order) => (
                  <TableRow
                    key={order.id}
                    className="border-slate-800 hover:bg-slate-900/50 cursor-pointer"
                    onClick={() => openOrderDetails(order)}
                    data-testid={`row-search-order-${order.id}`}
                  >
                    <TableCell className="font-mono text-xs text-blue-400">{order.orderNumber}</TableCell>
                    <TableCell className="text-slate-400 text-xs">
                      {format(new Date(order.createdAt!), "MMM dd, yyyy")}
                      <span className="block text-slate-500">{format(new Date(order.createdAt!), "MMMM yyyy")}</span>
                    </TableCell>
                    <TableCell className="text-white font-medium">{order.clientName}</TableCell>
                    <TableCell className="text-slate-300 text-sm">{order.clientPhone || "-"}</TableCell>
                    <TableCell className="text-slate-300 text-sm">{getServicesDisplay(order)}</TableCell>
                    {!isDesigner && (
                      <TableCell className="text-slate-300 text-sm">{order.assignee?.name || "Unassigned"}</TableCell>
                    )}
                    <TableCell>{getStatusBadge(order.status)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn("border-0", order.paymentStatus === 'paid' ? "text-green-500" : "text-yellow-500")}
                      >
                        {order.paymentStatus === 'paid' ? "Paid" : "Pending"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {universalSearchResults.length === 0 && (
                  <TableRow className="border-slate-800">
                    <TableCell colSpan={8} className="text-center text-slate-500 py-8" data-testid="text-no-search-results">
                      No matching orders found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
      <Tabs value={activeOrdersTab} onValueChange={(val) => setActiveOrdersTab(val as "today" | "monthly")} className="w-full">
        <TabsList className="bg-slate-900 border border-slate-800 p-1 mb-6">
          <TabsTrigger value="today" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white" data-testid="tab-today-orders">Today's Orders</TabsTrigger>
          <TabsTrigger value="monthly" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white" data-testid="tab-monthly-orders">Monthly Orders</TabsTrigger>
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
              <TableHeader className="bg-slate-900/50">
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">Order ID</TableHead>
                  <TableHead className="text-slate-400">Date Placed</TableHead>
                  <TableHead className="text-slate-400">Client</TableHead>
                  <TableHead className="text-slate-400">Contact</TableHead>
                  <TableHead className="text-slate-400">Services</TableHead>
                  {!isDesigner && <TableHead className="text-slate-400">Designer</TableHead>}
                  <TableHead className="text-slate-400">Status</TableHead>
                  {!isDesigner && <TableHead className="text-slate-400">Adv. Payment</TableHead>}
                  <TableHead className="text-slate-400">Payment</TableHead>
                  {canSeeAmounts && <TableHead className="text-slate-400 text-right">Advance</TableHead>}
                  {canSeeAmounts && <TableHead className="text-slate-400 text-right">Remaining</TableHead>}
                  <TableHead className="text-right text-slate-400">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {todayOrders?.map((order) => {
                  const isDesignerUser = user?.role === 'designer';
                  // All roles can see all status options
                  const getStatusOptions = () => {
                    if (isDesignerUser) {
                      // Permanently locked once delivered
                      if (order.status === 'delivered') return [{ value: "delivered", label: "Delivered" }];
                      const hasNoRemaining = (order.remainingAmount ?? 0) === 0;
                      // If ready and no remaining balance, allow marking delivered
                      if (order.status === 'ready') {
                        if (hasNoRemaining) return [{ value: "ready", label: "Ready" }, { value: "delivered", label: "Delivered" }];
                        return [{ value: "ready", label: "Ready" }];
                      }
                      // In-progress: can go up to ready, and to delivered if fully paid
                      const opts = [
                        { value: "new", label: "New" },
                        { value: "working", label: "Working" },
                        { value: "ready", label: "Ready" },
                      ];
                      if (hasNoRemaining) opts.push({ value: "delivered", label: "Delivered" });
                      return opts;
                    }
                    return [
                      { value: "new", label: "New" },
                      { value: "working", label: "Working" },
                      { value: "ready", label: "Ready" },
                      { value: "delivered", label: "Delivered" },
                      { value: "canceled", label: "Canceled" },
                    ];
                  };
                  
                  return (
                    <TableRow key={order.id} className="border-slate-800 hover:bg-slate-900/50" data-testid={`row-order-${order.id}`}>
                      <TableCell className="font-mono text-xs text-blue-400">{order.orderNumber}</TableCell>
                      <TableCell className="text-slate-400 text-xs">{format(new Date(order.createdAt!), "MMM dd, yyyy")}</TableCell>
                      <TableCell className="text-white font-medium">{order.clientName}</TableCell>
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
                      <TableCell className="text-slate-300 text-sm">{getServicesDisplay(order)}</TableCell>
                      {!isDesigner && (
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] text-slate-400">
                              {order.assignee?.name?.charAt(0) || "?"}
                            </div>
                            <span className="text-sm text-slate-300">{order.assignee?.name || "Unassigned"}</span>
                          </div>
                        </TableCell>
                      )}
                      <TableCell>
                        <Select 
                          defaultValue={order.status} 
                          onValueChange={(val) => updateOrderMutation.mutate({ id: order.id, updates: { status: val } })}
                        >
                          <SelectTrigger className="w-32 bg-transparent border-0 h-auto p-0 focus:ring-0 shadow-none hover:bg-white/5 rounded px-2 py-1" data-testid={`select-status-${order.id}`}>
                            <SelectValue>{getStatusBadge(order.status)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent className="bg-slate-900 border-slate-800">
                            {getStatusOptions().map(opt => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      {!isDesigner && (
                        <TableCell>
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
                            <SelectTrigger className="w-28 bg-transparent border-0 h-auto p-0 focus:ring-0 shadow-none hover:bg-white/5 rounded px-2 py-1" data-testid={`select-payment-${order.id}`}>
                              <SelectValue>
                                <Badge 
                                  variant="outline" 
                                  className={cn(
                                    "border-0",
                                    order.paymentStatus === 'paid' ? "text-green-500" : "text-yellow-500"
                                  )}
                                >
                                  {order.paymentStatus === 'paid' ? "Paid" : "Pending"}
                                </Badge>
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent className="bg-slate-900 border-slate-800">
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="paid">Paid</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge 
                            variant="outline" 
                            className={cn(
                              "border-0",
                              order.paymentStatus === 'paid' ? "text-green-500" : "text-yellow-500"
                            )}
                            data-testid={`badge-payment-${order.id}`}
                          >
                            {order.paymentStatus === 'paid' ? "Paid" : "Pending"}
                          </Badge>
                        )}
                      </TableCell>
                      {canSeeAmounts && (
                        <TableCell className="text-green-400 font-medium text-right">
                          ₨{Math.round((order.advanceAmount || 0) / 100).toLocaleString()}
                        </TableCell>
                      )}
                      {canSeeAmounts && (
                        <TableCell className="text-red-400 font-medium text-right">
                          ₨{Math.round((order.remainingAmount || 0) / 100).toLocaleString()}
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
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
                              <DropdownMenuSeparator className="bg-slate-800" />
                              {canDelete && order.status !== 'canceled' && (
                                <DropdownMenuItem 
                                  onClick={() => updateOrderMutation.mutate({ id: order.id, updates: { status: 'canceled' } })}
                                  className="text-red-400 hover:text-red-300"
                                  data-testid={`menu-cancel-${order.id}`}
                                >
                                  <XCircle className="w-4 h-4 mr-2" />
                                  Cancel Order
                                </DropdownMenuItem>
                              )}
                              {isAdmin && (
                                <DropdownMenuItem 
                                  onClick={() => { setOrderToDelete(order); setDeleteConfirmText(""); }}
                                  className="text-red-400 hover:text-red-300"
                                  data-testid={`menu-delete-${order.id}`}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Delete Order
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(!todayOrders || todayOrders.length === 0) && (
                  <TableRow className="border-slate-800">
                    <TableCell colSpan={10} className="text-center text-slate-500 py-8">
                      No orders for today
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
              <TableHeader className="bg-slate-900/50">
                <TableRow className="border-slate-800">
                  <TableHead className="text-slate-400">Date Placed</TableHead>
                  <TableHead className="text-slate-400">Order ID</TableHead>
                  <TableHead className="text-slate-400">Client</TableHead>
                  <TableHead className="text-slate-400">Contact</TableHead>
                  <TableHead className="text-slate-400">Services</TableHead>
                  {!isDesigner && <TableHead className="text-slate-400">Designer</TableHead>}
                  <TableHead className="text-slate-400">Status</TableHead>
                  {!isDesigner && <TableHead className="text-slate-400">Adv. Payment</TableHead>}
                  <TableHead className="text-slate-400">Payment</TableHead>
                  {canSeeAmounts && <TableHead className="text-slate-400 text-right">Advance</TableHead>}
                  {canSeeAmounts && <TableHead className="text-slate-400 text-right">Remaining</TableHead>}
                  <TableHead className="text-right text-slate-400">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthlyOrders?.map((order) => {
                  const isDesignerUser = user?.role === 'designer';
                  // All roles can see all status options
                  const getMonthlyStatusOptions = () => {
                    if (isDesignerUser) {
                      // Permanently locked once delivered
                      if (order.status === 'delivered') return [{ value: "delivered", label: "Delivered" }];
                      const hasNoRemaining = (order.remainingAmount ?? 0) === 0;
                      // If ready and no remaining balance, allow marking delivered
                      if (order.status === 'ready') {
                        if (hasNoRemaining) return [{ value: "ready", label: "Ready" }, { value: "delivered", label: "Delivered" }];
                        return [{ value: "ready", label: "Ready" }];
                      }
                      // In-progress: can go up to ready, and to delivered if fully paid
                      const opts = [
                        { value: "new", label: "New" },
                        { value: "working", label: "Working" },
                        { value: "ready", label: "Ready" },
                      ];
                      if (hasNoRemaining) opts.push({ value: "delivered", label: "Delivered" });
                      return opts;
                    }
                    return [
                      { value: "new", label: "New" },
                      { value: "working", label: "Working" },
                      { value: "ready", label: "Ready" },
                      { value: "delivered", label: "Delivered" },
                      { value: "canceled", label: "Canceled" },
                    ];
                  };
                  
                  return (
                  <TableRow key={order.id} className="border-slate-800" data-testid={`row-monthly-order-${order.id}`}>
                    <TableCell className="text-slate-400 text-xs">{format(new Date(order.createdAt!), "MMM dd")}</TableCell>
                    <TableCell className="font-mono text-xs text-blue-400">{order.orderNumber}</TableCell>
                    <TableCell className="text-white font-medium">{order.clientName}</TableCell>
                    <TableCell>
                      {order.clientPhone ? (
                        <div className="flex items-center gap-1">
                          <span className="text-slate-300 text-sm">{order.clientPhone}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-slate-400 hover:text-white"
                            onClick={() => copyPhone(order.id, order.clientPhone!)}
                          >
                            {copiedPhone === order.id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-300 text-sm">{getServicesDisplay(order)}</TableCell>
                    {!isDesigner && <TableCell className="text-slate-300">{order.assignee?.name || "Unassigned"}</TableCell>}
                    <TableCell>
                      <Select 
                        defaultValue={order.status} 
                        onValueChange={(val) => updateOrderMutation.mutate({ id: order.id, updates: { status: val } })}
                      >
                        <SelectTrigger className="w-32 bg-transparent border-0 h-auto p-0 focus:ring-0 shadow-none hover:bg-white/5 rounded px-2 py-1" data-testid={`select-monthly-status-${order.id}`}>
                          <SelectValue>{getStatusBadge(order.status)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent className="bg-slate-900 border-slate-800">
                          {getMonthlyStatusOptions().map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    {!isDesigner && (
                      <TableCell>
                        {isAdmin ? (
                          <Select 
                            defaultValue={order.advancePaymentStatus || "pending"} 
                            onValueChange={(val) => updateOrderMutation.mutate({ id: order.id, updates: { advancePaymentStatus: val } })}
                          >
                            <SelectTrigger className="w-32 bg-transparent border-0 h-auto p-0 focus:ring-0 shadow-none hover:bg-white/5 rounded px-2 py-1" data-testid={`select-monthly-adv-payment-${order.id}`}>
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
                          <SelectTrigger className="w-28 bg-transparent border-0 h-auto p-0 focus:ring-0 shadow-none hover:bg-white/5 rounded px-2 py-1" data-testid={`select-monthly-payment-${order.id}`}>
                            <SelectValue>
                              <Badge 
                                variant="outline" 
                                className={cn("border-0", order.paymentStatus === 'paid' ? "text-green-500" : "text-yellow-500")}
                              >
                                {order.paymentStatus === 'paid' ? "Paid" : "Pending"}
                              </Badge>
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="bg-slate-900 border-slate-800">
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="paid">Paid</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge 
                          variant="outline" 
                          className={cn("border-0", order.paymentStatus === 'paid' ? "text-green-500" : "text-yellow-500")}
                          data-testid={`badge-monthly-payment-${order.id}`}
                        >
                          {order.paymentStatus === 'paid' ? "Paid" : "Pending"}
                        </Badge>
                      )}
                    </TableCell>
                    {canSeeAmounts && (
                      <TableCell className="text-green-400 font-medium text-right">
                        ₨{Math.round((order.advanceAmount || 0) / 100).toLocaleString()}
                      </TableCell>
                    )}
                    {canSeeAmounts && (
                      <TableCell className="text-red-400 font-medium text-right">
                        ₨{Math.round((order.remainingAmount || 0) / 100).toLocaleString()}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-slate-900 border-slate-800">
                          <DropdownMenuItem onClick={() => openOrderDetails(order)} className="text-slate-300 hover:text-white">
                            <FileText className="w-4 h-4 mr-2" />
                            View Details
                          </DropdownMenuItem>
                          {isAdmin && (
                            <DropdownMenuItem onClick={() => { setOrderToEdit(order); setEditSheetOpen(true); }} className="text-slate-300 hover:text-white" data-testid={`menu-edit-monthly-${order.id}`}>
                              <Pencil className="w-4 h-4 mr-2" />
                              Edit Order
                            </DropdownMenuItem>
                          )}
                          {(isAdmin || isSupport) && order.status !== 'canceled' && (
                            <>
                              <DropdownMenuSeparator className="bg-slate-800" />
                              <DropdownMenuItem 
                                onClick={() => updateOrderMutation.mutate({ id: order.id, updates: { status: 'canceled' } })}
                                className="text-red-400 hover:text-red-300"
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
                                data-testid={`menu-delete-monthly-${order.id}`}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete Order
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  );
                })}
                {(!monthlyOrders || monthlyOrders.length === 0) && (
                  <TableRow className="border-slate-800">
                    <TableCell colSpan={10} className="text-center text-slate-500 py-8">
                      No orders for this month
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

      <Sheet open={detailsSheetOpen} onOpenChange={setDetailsSheetOpen}>
        <SheetContent className="bg-slate-900 border-slate-800 w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-white font-display flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Order Details
            </SheetTitle>
          </SheetHeader>
          {selectedOrder && (
            <div className="mt-6 space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-2xl font-bold text-blue-400 font-mono">{selectedOrder.orderNumber}</span>
                  {getStatusBadge(selectedOrder.status)}
                </div>
                <p className="text-slate-400 text-sm">Created {format(new Date(selectedOrder.createdAt!), "MMMM dd, yyyy 'at' h:mm a")}</p>
              </div>

              <div className="space-y-3 p-4 bg-slate-950 rounded-lg border border-slate-800">
                <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Client Information</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-slate-500">Name</p>
                    <p className="text-white font-medium">{selectedOrder.clientName}</p>
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
                  {selectedOrder.packageType && selectedOrder.packageType !== "custom" ? "Package" : "Services"}
                </h4>
                {selectedOrder.packageType && selectedOrder.packageType !== "custom" ? (
                  <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-sm px-3 py-1">
                    {packageLabels[selectedOrder.packageType] || selectedOrder.packageType}
                  </Badge>
                ) : (
                  <div className="space-y-2">
                    {selectedOrder.services.map((service, idx) => (
                      <div key={idx} className="flex justify-between items-center py-2 border-b border-slate-800 last:border-0">
                        <div>
                          <p className="text-white">{service.serviceType}</p>
                          {service.instructions && <p className="text-xs text-slate-500">{service.instructions}</p>}
                        </div>
                        <Badge variant="outline" className="text-slate-300">x{service.quantity}</Badge>
                      </div>
                    ))}
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
                      <p className="text-green-400 font-medium">₨{Math.round((selectedOrder.advanceAmount || 0) / 100).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Remaining</p>
                      <p className="text-red-400 font-medium">₨{Math.round((selectedOrder.remainingAmount || 0) / 100).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-800">
                    <Badge variant="outline" className={selectedOrder.paymentStatus === 'paid' ? "text-green-500 border-green-500/30" : "text-yellow-500 border-yellow-500/30"}>
                      {selectedOrder.paymentStatus === 'paid' ? "Paid" : "Payment Pending"}
                    </Badge>
                  </div>
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
            </div>
          )}
        </SheetContent>
      </Sheet>

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
  const [assignedToId, setAssignedToId] = useState(order.assignedToId ? String(order.assignedToId) : "");
  const [totalBill, setTotalBill] = useState(toRupees(order.totalPrice));
  const [discountAmount, setDiscountAmount] = useState(toRupees(order.discountAmount));
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
  const [services, setServices] = useState(() => {
    const existing = (order.services || []).map((s) => ({
      id: serviceIdRef.current++,
      serviceType: s.serviceType || "",
      quantity: s.quantity || 1,
      instructions: s.instructions || "",
    }));
    return existing.length > 0 ? existing : [{ id: serviceIdRef.current++, serviceType: "", quantity: 1, instructions: "" }];
  });
  const customServicesTopRef = useRef<HTMLDivElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const addService = () => {
    const newService = { id: serviceIdRef.current++, serviceType: "", quantity: 1, instructions: "" };
    setServices((prev) => [newService, ...prev]);
    requestAnimationFrame(() => {
      customServicesTopRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const trigger = customServicesTopRef.current?.querySelector<HTMLButtonElement>('[data-testid^="select-service-type-"]');
      trigger?.focus();
    });
  };

  const removeService = (id: number) => {
    setServices((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev));
  };

  const updateService = (id: number, field: string, value: any) => {
    setServices((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const missingFields: string[] = [];
    if (!clientName.trim()) missingFields.push("Client Name");
    if (!clientPhone.trim()) missingFields.push("Phone Number");
    if (!packageType) missingFields.push("Package");
    if (packageType === "custom" && services.every(s => !s.serviceType)) missingFields.push("At least one service");

    if (missingFields.length > 0) {
      toast({ title: "Missing Fields", description: `Please fill: ${missingFields.join(", ")}`, variant: "destructive" });
      return;
    }

    const totalPriceValue = totalBill ? Math.round(parseFloat(totalBill) * 100) : 0;
    const discountValue = discountAmount ? Math.round(parseFloat(discountAmount) * 100) : 0;
    const finalPayableValue = Math.max(0, totalPriceValue - discountValue);
    const advanceValue = advanceAmount ? Math.round(parseFloat(advanceAmount) * 100) : 0;
    const remainingValue = Math.max(0, finalPayableValue - advanceValue);

    const orderServices = packageType === "custom"
      ? services.filter(s => s.serviceType).map(s => ({
          serviceType: s.serviceType,
          quantity: s.quantity || 1,
          instructions: s.instructions || null,
        }))
      : [];

    setIsSaving(true);
    try {
      await apiRequest("PATCH", `/api/orders/${order.id}`, {
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim(),
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

  const finalPayable = Math.max(0, (parseInt(totalBill) || 0) - (parseInt(discountAmount) || 0));
  const remainingDisplay = Math.max(0, finalPayable - (parseInt(advanceAmount) || 0));

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-6">
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Client Information</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">Client Name *</Label>
            <Input value={clientName} onChange={(e) => setClientName(e.target.value)} className="bg-slate-950 border-slate-800 text-white" placeholder="Enter client name" data-testid="edit-input-client-name" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Phone Number *</Label>
            <Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} className="bg-slate-950 border-slate-800 text-white" placeholder="+92 300 1234567" data-testid="edit-input-client-phone" />
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
                if (pkg.value !== "custom") {
                  setServices([{ id: serviceIdRef.current++, serviceType: "", quantity: 1, instructions: "" }]);
                }
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

      {packageType === "custom" && (
        <div className="space-y-4" ref={customServicesTopRef}>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Custom Services</h4>
            <Button type="button" variant="ghost" size="sm" onClick={addService} className="text-blue-400 hover:text-blue-300" data-testid="edit-button-add-service">
              <Plus className="w-4 h-4 mr-1" /> Add Service
            </Button>
          </div>

          {services.map((service, index) => (
            <div key={service.id} className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Service {index + 1}</span>
                {services.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeService(service.id)} className="h-6 w-6 text-red-400 hover:text-red-300" data-testid={`edit-button-remove-service-${index}`}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
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
                  <Input type="number" min="1" value={service.quantity} onChange={(e) => updateService(service.id, 'quantity', parseInt(e.target.value) || 1)} className="bg-slate-900 border-slate-700 text-white" placeholder="Qty" data-testid={`edit-input-quantity-${index}`} />
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
            <Input type="number" min="0" step="1" value={totalBill} onChange={(e) => setTotalBill(e.target.value.replace(/[^0-9]/g, ''))} className="bg-slate-950 border-slate-800 text-white" placeholder="0" data-testid="edit-input-total-bill" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Discount (₨)</Label>
            <Input type="number" min="0" step="1" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value.replace(/[^0-9]/g, ''))} className="bg-slate-950 border-slate-800 text-white" placeholder="0" data-testid="edit-input-discount-amount" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Final Payable (₨)</Label>
            <div className="h-9 flex items-center px-3 bg-slate-950 border border-slate-800 rounded-md text-white">
              ₨{finalPayable.toLocaleString()}
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Advance / Collected (₨)</Label>
            <Input type="number" min="0" step="1" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value.replace(/[^0-9]/g, ''))} className="bg-slate-950 border-slate-800 text-white" placeholder="0" data-testid="edit-input-advance-amount" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Remaining</Label>
            <div className="h-9 flex items-center px-3 bg-slate-950 border border-slate-800 rounded-md text-white">
              ₨{remainingDisplay.toLocaleString()}
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Payment Method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger className="bg-slate-950 border-slate-800 text-white" data-testid="edit-select-payment-method">
                <SelectValue placeholder="Select method" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-white">
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="jazzcash">JazzCash</SelectItem>
                <SelectItem value="easypaisa">Easypaisa</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Payment Status</Label>
            <Select value={paymentStatus} onValueChange={setPaymentStatus}>
              <SelectTrigger className="bg-slate-950 border-slate-800 text-white" data-testid="edit-select-payment-status">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-white">
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
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
  const [services, setServices] = useState([{ id: 0, serviceType: "", quantity: 1, instructions: "" }]);
  const customServicesTopRef = useRef<HTMLDivElement | null>(null);
  
  // Payment verification fields
  const [paymentType, setPaymentType] = useState<"advance" | "full">("advance");
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
    const newService = { id: serviceIdRef.current++, serviceType: "", quantity: 1, instructions: "" };
    setServices((prev) => [newService, ...prev]);
    requestAnimationFrame(() => {
      customServicesTopRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const trigger = customServicesTopRef.current?.querySelector<HTMLButtonElement>('[data-testid^="select-service-type-"]');
      trigger?.focus();
    });
  };

  const removeService = (id: number) => {
    setServices((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev));
  };

  const updateService = (id: number, field: string, value: any) => {
    setServices((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const missingFields: string[] = [];
    if (!clientName.trim()) missingFields.push("Client Name");
    if (!clientPhone.trim()) missingFields.push("Phone Number");
    if (!packageType) missingFields.push("Package");
    if (packageType === "custom" && services.every(s => !s.serviceType)) missingFields.push("At least one service");
    if (currentUser?.role !== 'admin' && !paymentScreenshot) missingFields.push("Payment Screenshot");
    
    if (missingFields.length > 0) {
      toast({ 
        title: "Missing Fields", 
        description: `Please fill: ${missingFields.join(", ")}`, 
        variant: "destructive" 
      });
      return;
    }

    const totalPriceValue = totalBill ? Math.round(parseFloat(totalBill) * 100) : 0;
    const discountValue = discountAmount ? Math.round(parseFloat(discountAmount) * 100) : 0;
    const finalPayableValue = Math.max(0, totalPriceValue - discountValue);
    const advanceValue = advanceAmount ? Math.round(parseFloat(advanceAmount) * 100) : 0;
    const remainingValue = finalPayableValue - advanceValue;

    // For payment verification system:
    // - advance payment: advanceAmount is stored but status is pending_confirmation
    // - full payment: total is stored but status is pending_confirmation
    const paymentAmount = paymentType === "full" ? finalPayableValue : advanceValue;

    setIsUploading(true);
    try {
      const orderServices = packageType === "custom" 
        ? services.filter(s => s.serviceType).map(s => ({
            serviceType: s.serviceType,
            quantity: s.quantity || 1,
            instructions: s.instructions || null,
          }))
        : [];

      const isAdmin = currentUser?.role === 'admin';
      const orderRes = await apiRequest("POST", "/api/orders", {
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim(),
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                if (pkg.value !== "custom") {
                  setServices([{ id: serviceIdRef.current++, serviceType: "", quantity: 1, instructions: "" }]);
                }
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

      {packageType === "custom" && (
        <div className="space-y-4" ref={customServicesTopRef}>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Custom Services</h4>
            <Button type="button" variant="ghost" size="sm" onClick={addService} className="text-blue-400 hover:text-blue-300" data-testid="button-add-service">
              <Plus className="w-4 h-4 mr-1" /> Add Service
            </Button>
          </div>
          
          {services.map((service, index) => (
            <div key={service.id} className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Service {index + 1}</span>
                {services.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeService(service.id)} className="h-6 w-6 text-red-400 hover:text-red-300" data-testid={`button-remove-service-${index}`}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
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
            <Label className="text-slate-300">Total Bill (₨)</Label>
            <Input 
              type="number"
              min="0"
              step="1"
              value={totalBill} 
              onChange={(e) => setTotalBill(e.target.value.replace(/[^0-9]/g, ''))} 
              className="bg-slate-950 border-slate-800 text-white"
              placeholder="0"
              data-testid="input-total-bill"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Discount (₨)</Label>
            <Input 
              type="number"
              min="0"
              step="1"
              value={discountAmount} 
              onChange={(e) => setDiscountAmount(e.target.value.replace(/[^0-9]/g, ''))} 
              className="bg-slate-950 border-slate-800 text-white"
              placeholder="0"
              data-testid="input-discount-amount"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Final Payable (₨)</Label>
            <div className="h-9 flex items-center px-3 bg-slate-950 border border-slate-800 rounded-md text-white">
              ₨{Math.max(0, (parseInt(totalBill) || 0) - (parseInt(discountAmount) || 0)).toLocaleString()}
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Advance Paid (₨)</Label>
            <Input 
              type="number"
              min="0"
              step="1"
              value={advanceAmount} 
              onChange={(e) => setAdvanceAmount(e.target.value.replace(/[^0-9]/g, ''))} 
              className="bg-slate-950 border-slate-800 text-white"
              placeholder="0"
              data-testid="input-advance-amount"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Remaining</Label>
            <div className="h-9 flex items-center px-3 bg-slate-950 border border-slate-800 rounded-md text-white">
              ₨{Math.max(0, (parseInt(totalBill) || 0) - (parseInt(discountAmount) || 0) - (parseInt(advanceAmount) || 0)).toLocaleString()}
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Payment Method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger className="bg-slate-950 border-slate-800 text-white" data-testid="select-payment-method">
                <SelectValue placeholder="Select method" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-white">
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="jazzcash">JazzCash</SelectItem>
                <SelectItem value="easypaisa">Easypaisa</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {currentUser?.role !== 'admin' && (
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Payment Request <span className="text-red-400 normal-case font-normal">(Required)</span></h4>
          <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-300">Payment Type *</Label>
                <Select value={paymentType} onValueChange={(val: "advance" | "full") => setPaymentType(val)}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white" data-testid="select-payment-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-white">
                    <SelectItem value="advance">Advance (Partial)</SelectItem>
                    <SelectItem value="full">Full Payment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className={paymentScreenshot ? "text-slate-300" : "text-red-400"}>
                  Payment Screenshot *
                </Label>
                <Input 
                  type="file" 
                  accept="image/*"
                  onChange={(e) => setPaymentScreenshot(e.target.files?.[0] || null)}
                  className={`bg-slate-900 border-slate-700 text-white file:bg-slate-800 file:text-slate-300 file:border-0 file:mr-3 ${!paymentScreenshot ? "border-red-500/50" : ""}`}
                  data-testid="input-payment-screenshot"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              {paymentType === "advance" 
                ? "Upload screenshot of advance payment. Order will be pending until admin approves this request."
                : "Upload screenshot of full payment. Order will be marked as paid after admin approval."}
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
