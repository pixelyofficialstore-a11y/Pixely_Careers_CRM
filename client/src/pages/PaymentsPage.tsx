import { useEffect, useState } from "react";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { toQueryString } from "@/lib/orders";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { PaymentsSkeleton } from "@/components/PageSkeleton";
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
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Eye, 
  Filter,
  CreditCard,
  Upload
} from "lucide-react";
import { cn } from "@/lib/utils";
import { queryClient, apiRequest, getErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/CRMPrimitives";
import { RefundsQueue } from "@/components/OrderRefunds";
import { PaymentStatusBadge } from "@/components/StatusBadge";
import { ImageDropzone } from "@/components/ImageDropzone";
import type { OrderPick } from "@/lib/orders";

interface PaymentVerification {
  id: number;
  orderId: number;
  paymentType: "advance" | "full" | "remaining";
  amount: number;
  screenshotUrl: string | null;
  submittedById: number;
  status: "pending_confirmation" | "approved" | "disapproved";
  reviewedById: number | null;
  reviewedAt: string | null;
  notes: string | null;
  createdAt: string;
  submittedBy?: { id: number; name: string; role: string } | null;
  reviewedBy?: { id: number; name: string } | null;
  order?: { orderNumber: string; clientName: string; totalPrice: number } | null;
}

interface User {
  id: number;
  name: string;
  role: string;
}

export default function PaymentsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  
  // Date filters
  const currentDate = new Date();
  const [filterMonth, setFilterMonth] = useState("all");
  const [filterDay, setFilterDay] = useState("all");
  const [filterYear, setFilterYear] = useState("all");
  
  const [selectedPayment, setSelectedPayment] = useState<PaymentVerification | null>(null);
  const [approveNotes, setApproveNotes] = useState("");
  const [disapproveNotes, setDisapproveNotes] = useState("");
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showDisapproveDialog, setShowDisapproveDialog] = useState(false);
  
  // For designer remaining payment submission
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [remainingAmount, setRemainingAmount] = useState("");
  const [remainingScreenshot, setRemainingScreenshot] = useState<File | null>(null);
  const linkedPaymentId = Number(new URLSearchParams(window.location.search).get("payment")) || null;
  
  // Generate year options (current year and 2 previous years)
  const yearOptions = Array.from({ length: 3 }, (_, i) => (currentDate.getFullYear() - i).toString());
  
  // Month names for dropdown
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  
  // Day options (1-31)
  const dayOptions = Array.from({ length: 31 }, (_, i) => (i + 1).toString());

  const isAdmin = user?.role === "admin";
  const isDesigner = user?.role === "designer";

  // Server-side filters + pagination (50/page). Live updates arrive over SSE.
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const paymentParams = {
    page,
    pageSize: PAGE_SIZE,
    status: statusFilter,
    type: typeFilter,
    role: roleFilter,
    year: filterYear,
    month: filterMonth === "all" ? "all" : String(Number(filterMonth) + 1),
    day: filterDay,
  };
  useEffect(() => { setPage(1); }, [statusFilter, typeFilter, roleFilter, filterYear, filterMonth, filterDay]);
  const { data: paymentPage, isLoading, isFetching } = useQuery<{ rows: PaymentVerification[]; total: number; page: number; pageSize: number }>({
    queryKey: ["/api/payment-verifications", "list", paymentParams],
    queryFn: async () => {
      const res = await fetch(`/api/payment-verifications?${toQueryString(paymentParams)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    placeholderData: keepPreviousData,
  });
  // Verification queue (admin): every payment still waiting, oldest first.
  const queueParams = { page: 1, pageSize: 50, status: "pending_confirmation", type: "all", role: "all", year: "all", month: "all", day: "all" };
  const { data: queuePage, isLoading: queueLoading } = useQuery<{ rows: PaymentVerification[]; total: number }>({
    queryKey: ["/api/payment-verifications", "queue"],
    queryFn: async () => {
      const res = await fetch(`/api/payment-verifications?${toQueryString(queueParams)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    enabled: isAdmin,
  });
  const verifyQueue = [...(queuePage?.rows ?? [])].sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  const totalPayments = paymentPage?.total ?? 0;
  const totalPaymentPages = Math.max(1, Math.ceil(totalPayments / PAGE_SIZE));
  const fetchPayment = async (id: number): Promise<PaymentVerification | null> => {
    const res = await fetch(`/api/payment-verifications/${id}`, { credentials: "include" });
    return res.ok ? res.json() : null;
  };

  // Designer's own open orders that still have a balance (server-filtered, max 50).
  const { data: ordersWithRemaining = [] } = useQuery<OrderPick[]>({
    queryKey: ["/api/orders/lookup?withBalance=1&limit=50"],
    enabled: isDesigner,
  });

  // ?payment=123 deep links load that one payment from the server.
  useEffect(() => {
    if (!linkedPaymentId) return;
    let cancelled = false;
    void fetchPayment(linkedPaymentId).then(payment => { if (!cancelled && payment) setSelectedPayment(payment); });
    return () => { cancelled = true; };
  }, [linkedPaymentId]);

  const approveMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes: string }) => {
      return apiRequest("PATCH", `/api/payment-verifications/${id}/approve`, { notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Success", description: "Payment approved successfully" });
      setShowApproveDialog(false);
      setApproveNotes("");
    },
    onError: async (error: Error, variables) => {
      // Refresh even when a response fails: the server may have committed the
      // approval before a secondary side effect reported an error.
      queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      try {
        const refreshed = await fetchPayment(variables.id);
        if (refreshed?.status === "approved") {
          setSelectedPayment(refreshed);
          setShowApproveDialog(false);
          setApproveNotes("");
          toast({ title: "Payment approved", description: "The payment was approved successfully." });
          return;
        }
      } catch {
        // Keep the original error when the reconciliation request also fails.
      }
      toast({ title: "Approval failed", description: getErrorMessage(error, "Please refresh and check the payment status."), variant: "destructive" });
    },
  });

  const disapproveMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes: string }) => {
      return apiRequest("PATCH", `/api/payment-verifications/${id}/disapprove`, { notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Payment Disapproved", description: "The payment request has been disapproved" });
      setShowDisapproveDialog(false);
      setDisapproveNotes("");
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications"] });
      toast({ title: "Disapproval failed", description: getErrorMessage(error, "Failed to disapprove payment"), variant: "destructive" });
    },
  });

  const submitRemainingMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch("/api/payment-verifications", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || body.message || "Failed to submit payment request");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications"] });
      toast({ title: "Success", description: "Remaining payment request submitted" });
      setShowSubmitDialog(false);
      setSelectedOrderId("");
      setRemainingAmount("");
      setRemainingScreenshot(null);
    },
    onError: async (error: Error, formData) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications"] });
      const orderId = Number(formData.get("orderId"));
      const amount = Number(formData.get("amount"));
      try {
        const recent = await fetch("/api/payment-verifications?type=remaining&status=pending_confirmation&pageSize=20", { credentials: "include" });
        const refreshedPayments: PaymentVerification[] = recent.ok ? (await recent.json()).rows : [];
        const committed = refreshedPayments.some(payment =>
          payment.orderId === orderId &&
          payment.paymentType === "remaining" &&
          payment.amount === amount &&
          payment.status === "pending_confirmation"
        );
        if (committed) {
          setShowSubmitDialog(false);
          setSelectedOrderId("");
          setRemainingAmount("");
          setRemainingScreenshot(null);
          toast({ title: "Success", description: "Remaining payment request submitted" });
          return;
        }
      } catch {
        // Keep the original error when the reconciliation request also fails.
      }
      toast({ title: "Error", description: error.message || "Failed to submit payment request", variant: "destructive" });
    },
  });

  // Filtering (including hiding admin-submitted advance/full records) happens on the server.
  const filteredVerifications = paymentPage?.rows ?? [];

  const getStatusBadge = (status: string) => <PaymentStatusBadge status={status} />;

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "advance":
        return <Badge className="bg-blue-500/10 text-blue-400 border-0">Advance</Badge>;
      case "full":
        return <Badge className="bg-green-500/10 text-green-400 border-0">Full</Badge>;
      case "remaining":
        return <Badge className="bg-purple-500/10 text-purple-400 border-0">Remaining</Badge>;
      default:
        return <Badge>{type}</Badge>;
    }
  };

  const handleApprove = (payment: PaymentVerification) => {
    setSelectedPayment(payment);
    setShowApproveDialog(true);
  };

  const handleDisapprove = (payment: PaymentVerification) => {
    setSelectedPayment(payment);
    setShowDisapproveDialog(true);
  };

  const handleSubmitRemaining = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderId || !remainingAmount || !remainingScreenshot) {
      toast({ title: "Error", description: "Please fill all fields", variant: "destructive" });
      return;
    }

    const formData = new FormData();
    formData.append("screenshot", remainingScreenshot);
    formData.append("orderId", selectedOrderId);
    formData.append("paymentType", "remaining");
    formData.append("amount", Math.round(parseFloat(remainingAmount) * 100).toString());

    submitRemainingMutation.mutate(formData);
  };

  if (isLoading) return <PaymentsSkeleton />;

  return (
    <div className="crm-page space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <PageHeader title="Payments" testId="text-payments-title" />

        {isDesigner && ordersWithRemaining.length > 0 && (
          <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
            <DialogTrigger asChild>
              <Button className="bg-primary" data-testid="button-submit-remaining">
                <Upload className="w-4 h-4 mr-2" />
                Submit Remaining Payment
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-900 border-slate-800">
              <DialogHeader>
                <DialogTitle className="text-white">Submit Remaining Payment</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmitRemaining} className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">Select Order</Label>
                  <Select value={selectedOrderId} onValueChange={setSelectedOrderId}>
                    <SelectTrigger className="bg-slate-950 border-slate-800 text-white">
                      <SelectValue placeholder="Select order" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-800 text-white">
                      {ordersWithRemaining.map(o => (
                        <SelectItem key={o.id} value={o.id.toString()}>
                          {o.orderNumber} - {o.clientName} (Rs {Math.round((o.remainingAmount || 0) / 100).toLocaleString()} remaining)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">Amount (Rs )</Label>
                  <Input 
                    type="number" 
                    value={remainingAmount} 
                    onChange={(e) => setRemainingAmount(e.target.value)}
                    className="bg-slate-950 border-slate-800 text-white"
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">Payment Screenshot</Label>
                  <ImageDropzone
                    value={remainingScreenshot}
                    onFile={setRemainingScreenshot}
                    accept="image/*"
                    label="Choose payment screenshot"
                    description="Paste from clipboard or drag an image here"
                    className="bg-slate-950"
                  />
                </div>
                <Button type="submit" className="w-full bg-primary" disabled={submitRemainingMutation.isPending}>
                  {submitRemainingMutation.isPending ? "Submitting..." : "Submit Request"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isAdmin && <WebsiteApprovals />}

      {isAdmin && (
        <section aria-labelledby="verify-heading" className="space-y-3">
          <h2 id="verify-heading" className="flex items-center gap-2 text-base font-semibold text-slate-200">
            To verify
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", verifyQueue.length ? "bg-amber-500/15 text-amber-400" : "bg-[hsl(var(--surface-3))] text-slate-400")}>{queuePage?.total ?? 0}</span>
          </h2>
          {queueLoading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className="skeleton h-80 rounded-xl" />)}</div>
          ) : verifyQueue.length === 0 ? (
            <p className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-6 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-400" />No payments waiting for verification.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {verifyQueue.map(payment => (
                <article key={payment.id} className="flex flex-col overflow-hidden rounded-xl border border-border bg-card animate-fade-in" data-testid={`verify-card-${payment.id}`}>
                  {payment.screenshotUrl ? (
                    <a href={payment.screenshotUrl} target="_blank" rel="noopener noreferrer" className="block bg-[hsl(var(--surface-2))]" aria-label="Open screenshot full size">
                      <img src={payment.screenshotUrl} alt={`Payment screenshot for ${payment.order?.orderNumber || "request"}`} loading="lazy" className="h-64 w-full object-contain" />
                    </a>
                  ) : (
                    <div className="flex h-64 items-center justify-center bg-[hsl(var(--surface-2))] text-sm text-slate-500">No screenshot</div>
                  )}
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {payment.order?.orderNumber
                          ? <button className="font-mono text-sm font-semibold text-primary hover:underline" onClick={() => setLocation(`/orders?order=${encodeURIComponent(payment.order!.orderNumber)}`)}>{payment.order.orderNumber}</button>
                          : <p className="font-mono text-sm font-semibold text-amber-400">Request #{payment.id}</p>}
                        <p className="truncate text-sm font-medium text-slate-200">{payment.order?.clientName || "—"}</p>
                      </div>
                      <p className="shrink-0 text-lg font-semibold tabular-nums text-slate-100">Rs {Math.round((payment.amount || 0) / 100).toLocaleString("en-PK")}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {getTypeBadge(payment.paymentType)}
                      <span>{payment.submittedBy?.name || "Unknown"}</span>
                      <span>·</span>
                      <span>{payment.createdAt ? format(new Date(payment.createdAt), "MMM d, h:mm a") : "—"}</span>
                    </div>
                    <div className="mt-auto grid grid-cols-2 gap-2">
                      <Button onClick={() => handleApprove(payment)} className="bg-success text-on-color hover:bg-success/90" data-testid={`button-approve-${payment.id}`}><CheckCircle2 className="h-4 w-4" />Approve</Button>
                      <Button variant="outline" onClick={() => handleDisapprove(payment)} className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-400" data-testid={`button-disapprove-${payment.id}`}><XCircle className="h-4 w-4" />Disapprove</Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          <h2 className="pt-2 text-base font-semibold text-slate-200">History</h2>
        </section>
      )}

      {/* Filters - Admin only */}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <span className="text-sm text-slate-400">Filters:</span>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 bg-slate-950 border-slate-800 text-white">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800 text-white">
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending_confirmation">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="disapproved">Disapproved</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40 bg-slate-950 border-slate-800 text-white">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800 text-white">
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="advance">Advance</SelectItem>
              <SelectItem value="full">Full</SelectItem>
              <SelectItem value="remaining">Remaining</SelectItem>
            </SelectContent>
          </Select>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-40 bg-slate-950 border-slate-800 text-white">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800 text-white">
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="support">Support</SelectItem>
              <SelectItem value="designer">Designer</SelectItem>
            </SelectContent>
          </Select>
          
          {/* Date Filters */}
          <div className="flex flex-wrap items-center gap-2 sm:ml-2 sm:border-l sm:border-border sm:pl-4">
            <span className="text-sm text-slate-400">Date:</span>
            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger className="w-32 bg-slate-950 border-slate-800 text-white" data-testid="select-filter-month">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-white">
                <SelectItem value="all">All Months</SelectItem>
                {monthNames.map((name, i) => (
                  <SelectItem key={i} value={i.toString()}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterDay} onValueChange={setFilterDay}>
              <SelectTrigger className="w-28" data-testid="select-filter-day">
                <SelectValue placeholder="Day" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-white">
                <SelectItem value="all">All Days</SelectItem>
                {dayOptions.map(day => (
                  <SelectItem key={day} value={day}>{day}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterYear} onValueChange={setFilterYear}>
              <SelectTrigger className="w-28 bg-slate-950 border-slate-800 text-white" data-testid="select-filter-year">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-white">
                <SelectItem value="all">All Years</SelectItem>
                {yearOptions.map(year => (
                  <SelectItem key={year} value={year}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Payment Requests Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* Phones: cards */}
        <ul className="divide-y divide-[hsl(var(--border))] md:hidden" data-testid="payments-cards">
          {filteredVerifications.map(payment => (
            <li key={payment.id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {payment.order?.orderNumber
                    ? <button className="font-mono text-xs font-semibold text-primary" onClick={() => setLocation(`/orders?order=${encodeURIComponent(payment.order!.orderNumber)}`)}>{payment.order.orderNumber}</button>
                    : <p className="font-mono text-xs font-semibold text-amber-400">#{payment.id}</p>}
                  <p className="truncate text-sm font-semibold text-slate-100">{payment.order?.clientName || "—"}</p>
                </div>
                <p className="shrink-0 font-semibold tabular-nums text-slate-100">Rs {Math.round((payment.amount || 0) / 100).toLocaleString("en-PK")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                {getTypeBadge(payment.paymentType)}
                {getStatusBadge(payment.status)}
                <span>{payment.submittedBy?.name || "Unknown"}</span>
                <span>· {payment.createdAt ? format(new Date(payment.createdAt), "MMM d, h:mm a") : "—"}</span>
                {payment.screenshotUrl && <a href={payment.screenshotUrl} target="_blank" rel="noopener noreferrer" className="ml-auto flex min-h-touch items-center gap-1 text-primary"><Eye className="h-4 w-4" />Screenshot</a>}
              </div>
            </li>
          ))}
          {filteredVerifications.length === 0 && <li className="p-8 text-center text-sm text-slate-500">No payment requests found</li>}
        </ul>
        <div className="table-scroll-wrapper hidden md:block">
        <Table className="min-w-[1040px]">
          <TableHeader className="bg-slate-900/50">
            <TableRow className="border-slate-800">
              <TableHead className="min-w-[190px] whitespace-nowrap text-slate-400">Order</TableHead>
              <TableHead className="min-w-[165px] whitespace-nowrap text-slate-400">Requester</TableHead>
              <TableHead className="min-w-[120px] whitespace-nowrap text-slate-400">Type</TableHead>
              <TableHead className="min-w-[110px] whitespace-nowrap text-slate-400">Amount</TableHead>
              <TableHead className="min-w-[125px] whitespace-nowrap text-slate-400">Screenshot</TableHead>
              <TableHead className="min-w-[145px] whitespace-nowrap text-slate-400">Date</TableHead>
              <TableHead className="min-w-[125px] whitespace-nowrap text-slate-400">Status</TableHead>
              {isAdmin && <TableHead className="min-w-[190px] whitespace-nowrap text-right text-slate-400">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredVerifications.map((payment) => (
              <TableRow key={payment.id} className="border-slate-800">
                <TableCell className="min-w-[190px]">
                  <div>
                    {payment.order?.orderNumber ? <button className="block whitespace-nowrap font-mono font-semibold text-blue-400 hover:underline" onClick={() => setLocation(`/orders?order=${encodeURIComponent(payment.order!.orderNumber)}`)}>{payment.order.orderNumber}</button> : <p className="whitespace-nowrap font-mono font-semibold text-yellow-400">#{payment.id}</p>}
                    <p className="whitespace-nowrap text-sm font-semibold text-slate-100">{payment.order?.clientName || "—"}</p>
                  </div>
                </TableCell>
                <TableCell className="min-w-[165px]">
                  <div>
                    <p className="whitespace-nowrap font-medium text-white">{payment.submittedBy?.name || "Unknown"}</p>
                    <p className="whitespace-nowrap text-xs text-slate-500 capitalize">{payment.submittedBy?.role}</p>
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">{getTypeBadge(payment.paymentType)}</TableCell>
                <TableCell className="whitespace-nowrap text-white font-medium">
                  Rs {Math.round((payment.amount || 0) / 100).toLocaleString()}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {payment.screenshotUrl ? (
                    <a 
                      href={payment.screenshotUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
                    >
                      <Eye className="w-4 h-4" />
                      View
                    </a>
                  ) : (
                    <span className="text-slate-500">-</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-slate-400">
                  {payment.createdAt ? format(new Date(payment.createdAt), "MMM dd, h:mm a") : "-"}
                </TableCell>
                <TableCell className="whitespace-nowrap">{getStatusBadge(payment.status)}</TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    {payment.status === "pending_confirmation" && (
                      <div className="flex justify-end gap-2">
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="text-green-500 hover:text-green-400 hover:bg-green-500/10"
                          onClick={() => handleApprove(payment)}
                          data-testid={`button-approve-row-${payment.id}`}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1" />
                          Approve
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                          onClick={() => handleDisapprove(payment)}
                          data-testid={`button-disapprove-row-${payment.id}`}
                        >
                          <XCircle className="w-4 h-4 mr-1" />
                          Disapprove
                        </Button>
                      </div>
                    )}
                    {payment.status !== "pending_confirmation" && payment.notes && (
                      <span className="text-xs text-slate-500 italic">"{payment.notes}"</span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {filteredVerifications.length === 0 && (
              <TableRow className="border-slate-800">
                <TableCell colSpan={isAdmin ? 8 : 7} className="text-center text-slate-500 py-8">
                  <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  No payment requests found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>
        {totalPayments > 0 && (
          <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-800 p-4 text-sm text-slate-400 sm:flex-row" data-testid="payments-pagination">
            <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalPayments)} of {totalPayments}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</Button>
              <span className="tabular-nums">Page {page} of {totalPaymentPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPaymentPages || isFetching} onClick={() => setPage(p => Math.min(totalPaymentPages, p + 1))}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Approve Dialog */}
      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent className="bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">Approve Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {selectedPayment && (
              <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
                <p className="text-sm text-slate-400">Request: <span className="text-white font-mono">{selectedPayment.order?.orderNumber || `#${selectedPayment.id}`}</span></p>
                <p className="text-sm text-slate-400">Client: <span className="text-white">{selectedPayment.order?.clientName || "—"}</span></p>
                <p className="text-sm text-slate-400">Amount: <span className="text-green-400 font-bold">Rs {Math.round((selectedPayment.amount || 0) / 100).toLocaleString()}</span></p>
                <p className="text-sm text-slate-400">Type: <span className="text-white capitalize">{selectedPayment.paymentType}</span></p>
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-slate-300">Notes (optional)</Label>
              <Textarea 
                value={approveNotes} 
                onChange={(e) => setApproveNotes(e.target.value)}
                className="bg-slate-950 border-slate-800 text-white resize-none"
                placeholder="Add any notes..."
                rows={2}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowApproveDialog(false)}>Cancel</Button>
              <Button 
                className="bg-green-600 hover:bg-green-500"
                onClick={() => selectedPayment && approveMutation.mutate({ id: selectedPayment.id, notes: approveNotes })}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? "Approving..." : "Confirm Approval"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Disapprove Dialog */}
      <Dialog open={showDisapproveDialog} onOpenChange={setShowDisapproveDialog}>
        <DialogContent className="bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">Disapprove Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {selectedPayment && (
              <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
                <p className="text-sm text-slate-400">Request: <span className="text-white font-mono">{selectedPayment.order?.orderNumber || `#${selectedPayment.id}`}</span></p>
                <p className="text-sm text-slate-400">Client: <span className="text-white">{selectedPayment.order?.clientName || "—"}</span></p>
                <p className="text-sm text-slate-400">Amount: <span className="text-red-400 font-bold">Rs {Math.round((selectedPayment.amount || 0) / 100).toLocaleString()}</span></p>
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-slate-300">Reason for disapproval *</Label>
              <Textarea 
                value={disapproveNotes} 
                onChange={(e) => setDisapproveNotes(e.target.value)}
                className="bg-slate-950 border-slate-800 text-white resize-none"
                placeholder="Please provide a reason..."
                rows={2}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowDisapproveDialog(false)}>Cancel</Button>
              <Button 
                variant="destructive"
                onClick={() => selectedPayment && disapproveMutation.mutate({ id: selectedPayment.id, notes: disapproveNotes })}
                disabled={disapproveMutation.isPending || !disapproveNotes.trim()}
              >
                {disapproveMutation.isPending ? "Processing..." : "Confirm Disapproval"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {(isAdmin || user?.role === "support") && <RefundsQueue isAdmin={isAdmin} />}
    </div>
  );
}

/** Website requests that support sent for approval. Admin places them on Website Requests. */
function WebsiteApprovals() {
  const { data } = useQuery<{ rows: Array<{ id: string; name: string | null; package: string; total: number; currency: string; submitted_at: string | null; created_at: string; last_change?: { by: string | null } | null }> }>({
    queryKey: ["/api/website-requests/orders?status=awaiting_approval&page=1"],
  });
  const rows = data?.rows ?? [];
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3" data-testid="section-website-approvals">
      <h2 className="text-base font-semibold text-slate-200">Website requests waiting for approval · {rows.length}</h2>
      <div className="divide-y divide-slate-800 rounded-xl border border-border bg-card">
        {rows.map(r => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-white">{r.name || "—"} <span className="text-slate-400">· {r.package.replace(/_/g, " ")} · {(r.currency || "PKR").toUpperCase() === "PKR" ? "Rs" : r.currency} {Math.round(Number(r.total || 0)).toLocaleString("en-US")}</span></p>
              <p className="text-xs text-slate-500">Sent by {(r.last_change?.by || "support").split(" ")[0]} · {format(new Date(r.submitted_at || r.created_at), "d MMM, HH:mm")}</p>
            </div>
            <Button size="sm" asChild data-testid={`button-review-website-${r.id}`}><a href={`/website-requests?tab=orders&q=${encodeURIComponent(r.name || "")}`}>Review &amp; place</a></Button>
          </div>
        ))}
      </div>
    </section>
  );
}
