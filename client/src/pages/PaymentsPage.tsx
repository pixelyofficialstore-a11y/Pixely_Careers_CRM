import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

  const { data: verifications, isLoading } = useQuery<PaymentVerification[]>({
    queryKey: ["/api/payment-verifications"],
    refetchInterval: 10000, // Refresh every 10 seconds to ensure fresh data
    staleTime: 0, // Always consider data stale to ensure strict server-side filtering
  });

  const { data: orders } = useQuery<any[]>({
    queryKey: ["/api/orders"],
  });

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
    onError: () => {
      toast({ title: "Error", description: "Failed to approve payment", variant: "destructive" });
    },
  });

  const disapproveMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes: string }) => {
      return apiRequest("PATCH", `/api/payment-verifications/${id}/disapprove`, { notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications"] });
      toast({ title: "Payment Disapproved", description: "The payment request has been disapproved" });
      setShowDisapproveDialog(false);
      setDisapproveNotes("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to disapprove payment", variant: "destructive" });
    },
  });

  const submitRemainingMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch("/api/payment-verifications", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to submit");
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
    onError: () => {
      toast({ title: "Error", description: "Failed to submit payment request", variant: "destructive" });
    },
  });

  // Filter verifications
  const filteredVerifications = verifications?.filter(v => {
    if (statusFilter !== "all" && v.status !== statusFilter) return false;
    if (typeFilter !== "all" && v.paymentType !== typeFilter) return false;
    if (roleFilter !== "all" && v.submittedBy?.role !== roleFilter) return false;
    
    // Date filters
    if (filterYear !== "all" || filterMonth !== "all" || filterDay !== "all") {
      const vDate = new Date(v.createdAt);
      if (filterYear !== "all" && vDate.getFullYear().toString() !== filterYear) return false;
      if (filterMonth !== "all" && vDate.getMonth().toString() !== filterMonth) return false;
      if (filterDay !== "all" && vDate.getDate().toString() !== filterDay) return false;
    }
    
    return true;
  }) || [];

  // Get orders with remaining balance for designer to submit
  const ordersWithRemaining = orders?.filter(o => {
    if (isDesigner && o.assignedToId !== user?.id) return false;
    return (o.remainingAmount || 0) > 0 && o.paymentStatus !== "paid";
  }) || [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending_confirmation":
        return <Badge variant="outline" className="border-0 text-yellow-500"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case "approved":
        return <Badge variant="outline" className="border-0 text-green-500"><CheckCircle2 className="w-3 h-3 mr-1" /> Approved</Badge>;
      case "disapproved":
        return <Badge variant="outline" className="border-0 text-red-500"><XCircle className="w-3 h-3 mr-1" /> Disapproved</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

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

  if (isLoading) return null;

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-white mb-2" data-testid="text-payments-title">
            Payment Verification
          </h1>
          <p className="text-slate-400">
            {isAdmin 
              ? "Review and approve payment requests from the team." 
              : "View status of your submitted payment requests."}
          </p>
        </div>

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
                          {o.orderNumber} - {o.clientName} (₨{((o.remainingAmount || 0) / 100).toLocaleString()} remaining)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">Amount (₨)</Label>
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
                  <Input 
                    type="file" 
                    accept="image/*"
                    onChange={(e) => setRemainingScreenshot(e.target.files?.[0] || null)}
                    className="bg-slate-950 border-slate-800 text-white file:bg-slate-800 file:text-slate-300 file:border-0"
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

      {/* Filters - Admin only */}
      {isAdmin && (
        <div className="flex flex-wrap gap-4 p-4 bg-slate-900/50 rounded-xl border border-slate-800">
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
          <div className="flex items-center gap-2 border-l border-slate-700 pl-4 ml-2">
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
              <SelectTrigger className="w-24 bg-slate-950 border-slate-800 text-white" data-testid="select-filter-day">
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
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
        <div className="table-scroll-wrapper">
        <Table>
          <TableHeader className="bg-slate-900/50">
            <TableRow className="border-slate-800">
              <TableHead className="text-slate-400">Order</TableHead>
              <TableHead className="text-slate-400">Requester</TableHead>
              <TableHead className="text-slate-400">Type</TableHead>
              <TableHead className="text-slate-400">Amount</TableHead>
              <TableHead className="text-slate-400">Screenshot</TableHead>
              <TableHead className="text-slate-400">Date</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
              {isAdmin && <TableHead className="text-slate-400 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredVerifications.map((payment) => (
              <TableRow key={payment.id} className="border-slate-800">
                <TableCell>
                  <div>
                    <p className="text-white font-medium">{payment.order?.orderNumber || `#${payment.orderId}`}</p>
                    <p className="text-xs text-slate-500">{payment.order?.clientName}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    <p className="text-white">{payment.submittedBy?.name || "Unknown"}</p>
                    <p className="text-xs text-slate-500 capitalize">{payment.submittedBy?.role}</p>
                  </div>
                </TableCell>
                <TableCell>{getTypeBadge(payment.paymentType)}</TableCell>
                <TableCell className="text-white font-medium">
                  ₨{((payment.amount || 0) / 100).toLocaleString()}
                </TableCell>
                <TableCell>
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
                <TableCell className="text-slate-400">
                  {payment.createdAt ? format(new Date(payment.createdAt), "MMM dd, h:mm a") : "-"}
                </TableCell>
                <TableCell>{getStatusBadge(payment.status)}</TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    {payment.status === "pending_confirmation" && (
                      <div className="flex justify-end gap-2">
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="text-green-500 hover:text-green-400 hover:bg-green-500/10"
                          onClick={() => handleApprove(payment)}
                          data-testid={`button-approve-${payment.id}`}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1" />
                          Approve
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                          onClick={() => handleDisapprove(payment)}
                          data-testid={`button-disapprove-${payment.id}`}
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
                <p className="text-sm text-slate-400">Order: <span className="text-white">{selectedPayment.order?.orderNumber}</span></p>
                <p className="text-sm text-slate-400">Amount: <span className="text-green-400 font-bold">₨{((selectedPayment.amount || 0) / 100).toLocaleString()}</span></p>
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
                <p className="text-sm text-slate-400">Order: <span className="text-white">{selectedPayment.order?.orderNumber}</span></p>
                <p className="text-sm text-slate-400">Amount: <span className="text-red-400 font-bold">₨{((selectedPayment.amount || 0) / 100).toLocaleString()}</span></p>
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
    </div>
  );
}
