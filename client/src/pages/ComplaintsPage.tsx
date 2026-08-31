import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  Loader2,
  Search,
  ShieldAlert,
  UserRound,
  XCircle,
} from "lucide-react";
import {
  complaintCategories,
  complaintStatuses,
  type ComplaintHistoryEntry,
  type ComplaintResponse,
} from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComplaintStatusBadge } from "@/components/StatusBadge";
import { complaintCategoryLabels } from "@/components/ComplaintDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function readableError(error: Error) {
  const match = error.message.match(/"message":"([^"]+)"/);
  return match?.[1] || "The request could not be completed.";
}

function ComplaintDetail({ complaintId }: { complaintId: number }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [adminNotes, setAdminNotes] = useState("");
  const [resolution, setResolution] = useState("");
  const [pendingDecision, setPendingDecision] = useState<"valid" | "invalid" | null>(null);

  const { data: complaint, isLoading, isError } = useQuery<ComplaintResponse>({
    queryKey: [`/api/complaints/${complaintId}`],
  });
  const { data: history = [] } = useQuery<ComplaintHistoryEntry[]>({
    queryKey: [`/api/complaints/${complaintId}/history`],
    enabled: user?.role === "admin",
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const response = await apiRequest("PATCH", `/api/complaints/${complaintId}`, updates);
      return response.json();
    },
    onSuccess: (updated: ComplaintResponse) => {
      queryClient.setQueryData([`/api/complaints/${complaintId}`], updated);
      queryClient.invalidateQueries({ queryKey: ["/api/complaints"] });
      queryClient.invalidateQueries({ queryKey: [`/api/complaints/${complaintId}/history`] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Complaint updated" });
      setPendingDecision(null);
    },
    onError: (error: Error) => {
      toast({ title: "Update failed", description: readableError(error), variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="min-h-[50vh] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  }
  if (isError || !complaint) {
    return (
      <div className="p-8">
        <div className="glass-panel rounded-2xl p-8 text-center">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <h2 className="text-white font-semibold">Complaint unavailable</h2>
          <p className="text-slate-400 mt-2">It may not exist or you may not have access to it.</p>
          <Button variant="outline" className="mt-5" onClick={() => setLocation("/complaints")}>Back to Complaints</Button>
        </div>
      </div>
    );
  }

  const isAdmin = user?.role === "admin";
  const nextAction = complaint.status === "new"
    ? { label: "Start Review", status: "under_review" as const }
    : complaint.status === "valid"
      ? { label: "Resolve Complaint", status: "resolved" as const }
      : null;

  return (
    <div className="p-4 md:p-8 space-y-6">
      <Button variant="ghost" className="text-slate-400" onClick={() => setLocation("/complaints")}>
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Complaints
      </Button>

      <div className="glass-panel rounded-2xl p-5 md:p-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-bold font-display text-white">{complaint.complaintNumber}</h1>
              <ComplaintStatusBadge status={complaint.status} />
            </div>
            <button
              className="text-blue-400 hover:text-blue-300 text-sm mt-2"
              onClick={() => setLocation("/orders")}
            >
              {complaint.orderNumber ? `Order #${complaint.orderNumber}` : `Order #${complaint.orderId}`} · {complaint.clientName}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Raised {complaint.createdAt ? format(new Date(complaint.createdAt), "MMM dd, yyyy 'at' h:mm a") : "—"}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-7">
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">Complaint against</p>
            <div className="flex items-center gap-2 mt-2">
              <UserRound className="w-4 h-4 text-blue-400" />
              <p className="text-white font-medium">{complaint.complaintAgainst.name}</p>
            </div>
          </div>
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">Category</p>
            <p className="text-white font-medium mt-2">{complaintCategoryLabels[complaint.category]}</p>
          </div>
          {isAdmin && complaint.filedBy && (
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">Filed by</p>
              <p className="text-white font-medium mt-2">{complaint.filedBy.name}</p>
              <p className="text-xs text-slate-500 capitalize">{complaint.filedBy.role}</p>
            </div>
          )}
        </div>

        <div className="mt-6 rounded-xl bg-slate-950 border border-slate-800 p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-3">Complaint details</p>
          <p className="text-slate-200 whitespace-pre-wrap leading-relaxed">{complaint.description}</p>
        </div>

        {complaint.resolution && (
          <div className="mt-4 rounded-xl bg-purple-500/10 border border-purple-500/20 p-5">
            <p className="text-xs uppercase tracking-wider text-purple-300 mb-3">Resolution</p>
            <p className="text-slate-200 whitespace-pre-wrap">{complaint.resolution}</p>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-panel rounded-2xl p-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-white">Review controls</h2>
              <p className="text-sm text-slate-500">Status changes follow the required review sequence.</p>
            </div>

            {complaint.status === "under_review" && (
              <div className="grid grid-cols-2 gap-3">
                <Button className="bg-red-600 hover:bg-red-500" onClick={() => setPendingDecision("valid")}>
                  <ShieldAlert className="w-4 h-4 mr-2" /> Mark Valid
                </Button>
                <Button variant="outline" onClick={() => setPendingDecision("invalid")}>
                  <XCircle className="w-4 h-4 mr-2" /> Mark Invalid
                </Button>
              </div>
            )}

            {complaint.status === "valid" && (
              <div className="space-y-2">
                <Label htmlFor="resolution">Resolution <span className="text-red-400">*</span></Label>
                <Textarea
                  id="resolution"
                  value={resolution}
                  onChange={event => setResolution(event.target.value)}
                  placeholder="Describe how the valid complaint was resolved."
                  className="bg-slate-950 border-slate-700"
                  rows={4}
                />
              </div>
            )}

            {nextAction && (
              <Button
                onClick={() => updateMutation.mutate({
                  status: nextAction.status,
                  ...(nextAction.status === "resolved" ? { resolution } : {}),
                })}
                disabled={updateMutation.isPending || (nextAction.status === "resolved" && !resolution.trim())}
                className="w-full"
              >
                {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {nextAction.label}
              </Button>
            )}

            {(complaint.status === "invalid" || complaint.status === "resolved") && (
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-sm text-slate-400">
                This complaint has reached its final workflow state.
              </div>
            )}

            <div className="space-y-2 pt-3 border-t border-slate-800">
              <Label htmlFor="admin-notes">Internal admin notes</Label>
              <Textarea
                id="admin-notes"
                value={adminNotes}
                onChange={event => setAdminNotes(event.target.value)}
                placeholder={complaint.adminNotes || "Notes visible only to admins"}
                className="bg-slate-950 border-slate-700"
                rows={4}
              />
              <Button
                variant="outline"
                onClick={() => updateMutation.mutate({ adminNotes })}
                disabled={updateMutation.isPending || !adminNotes.trim()}
              >
                Save Internal Note
              </Button>
              {complaint.adminNotes && <p className="text-xs text-slate-500 whitespace-pre-wrap">Current: {complaint.adminNotes}</p>}
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white">Complaint history</h2>
            <div className="mt-5 space-y-4">
              {history.length === 0 ? (
                <p className="text-sm text-slate-500">No history entries yet.</p>
              ) : history.map(entry => (
                <div key={entry.id} className="relative pl-6 pb-4 border-l border-slate-700 last:pb-0">
                  <span className="absolute -left-1.5 top-1 w-3 h-3 rounded-full bg-blue-500" />
                  <p className="text-sm text-white">{entry.action.replaceAll("_", " ")}</p>
                  {(entry.previousValue || entry.newValue) && (
                    <p className="text-xs text-slate-400 mt-1">
                      {entry.previousValue ? entry.previousValue.replaceAll("_", " ") : "Created"}
                      {" → "}
                      {entry.newValue?.replaceAll("_", " ") || "Recorded"}
                    </p>
                  )}
                  <p className="text-xs text-slate-600 mt-1">
                    {entry.actor?.name || "System"} · {entry.createdAt ? format(new Date(entry.createdAt), "MMM dd, yyyy h:mm a") : "—"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={pendingDecision !== null} onOpenChange={open => !open && setPendingDecision(null)}>
        <AlertDialogContent className="bg-slate-900 border-slate-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm complaint decision</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Mark {complaint.complaintNumber} as {pendingDecision}. This decision is recorded in complaint history and cannot be reversed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDecision && updateMutation.mutate({ status: pendingDecision, confirmDecision: true })}
              className={pendingDecision === "valid" ? "bg-red-600 hover:bg-red-500" : ""}
            >
              Confirm {pendingDecision}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function ComplaintsPage() {
  const { user } = useAuth();
  const [, params] = useRoute("/complaints/:id");
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");

  const { data: complaints = [], isLoading, isError, refetch } = useQuery<ComplaintResponse[]>({
    queryKey: ["/api/complaints"],
    enabled: !params?.id,
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return complaints.filter(complaint => {
      const matchesSearch = !term || [
        complaint.complaintNumber,
        complaint.orderNumber,
        complaint.clientName,
        complaint.complaintAgainst.name,
        complaint.description,
      ].some(value => value?.toLowerCase().includes(term));
      return matchesSearch
        && (status === "all" || complaint.status === status)
        && (category === "all" || complaint.category === category);
    });
  }, [complaints, search, status, category]);

  if (params?.id) {
    return <ComplaintDetail complaintId={Number(params.id)} />;
  }

  const title = user?.role === "designer"
    ? "Complaints About My Work"
    : user?.role === "support"
      ? "Complaints I Filed"
      : "Complaints Management";

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <FileWarning className="w-7 h-7 text-red-400" />
          <h1 className="text-2xl md:text-3xl font-bold font-display text-white">{title}</h1>
        </div>
        <p className="text-slate-400 mt-2">
          {user?.role === "admin"
            ? "Review and resolve order-linked complaints."
            : "View the complaints available to your role."}
        </p>
      </div>

      <div className="glass-panel rounded-2xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_190px_240px] gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <Input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search complaint, order, client, or designer"
              className="pl-9 bg-slate-950 border-slate-700"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="bg-slate-950 border-slate-700"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {complaintStatuses.map(value => (
                <SelectItem key={value} value={value}>{value.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="bg-slate-950 border-slate-700"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {complaintCategories.map(value => (
                <SelectItem key={value} value={value}>{complaintCategoryLabels[value]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="min-h-[35vh] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
      ) : isError ? (
        <div className="glass-panel rounded-2xl p-10 text-center">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <h2 className="text-white font-semibold">Could not load complaints</h2>
          <Button variant="outline" className="mt-4" onClick={() => refetch()}>Try Again</Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center">
          <ClipboardCheck className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-white">No complaints found</h2>
          <p className="text-sm text-slate-500 mt-2">
            {complaints.length === 0 ? "There are no complaints in your current scope." : "Try changing your search or filters."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(complaint => (
            <button
              key={complaint.id}
              onClick={() => setLocation(`/complaints/${complaint.id}`)}
              className="glass-panel rounded-2xl p-5 text-left hover:border-slate-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-blue-400 font-semibold">{complaint.complaintNumber}</p>
                  <p className="text-sm text-white mt-1">
                    {complaint.orderNumber ? `#${complaint.orderNumber}` : `Order #${complaint.orderId}`} · {complaint.clientName}
                  </p>
                </div>
                <ComplaintStatusBadge status={complaint.status} />
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-300">
                <UserRound className="w-4 h-4 text-slate-500" />
                {complaint.complaintAgainst.name}
              </div>
              <p className="text-xs text-slate-500 mt-2">{complaintCategoryLabels[complaint.category]}</p>
              <p className="text-sm text-slate-400 mt-3 line-clamp-2">{complaint.description}</p>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-800 text-xs text-slate-500">
                <span>{complaint.createdAt ? format(new Date(complaint.createdAt), "MMM dd, yyyy") : "—"}</span>
                {complaint.status === "resolved"
                  ? <span className="flex items-center gap-1 text-purple-400"><CheckCircle2 className="w-3.5 h-3.5" /> Closed</span>
                  : <span>Open details</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}