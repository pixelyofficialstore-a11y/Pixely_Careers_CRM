/**
 * Phase 2 refunds on one order: support/admin request a refund, the admin
 * approves it with an amount (or rejects it) and marks it paid.
 * Amounts in the API are paisa; the form takes rupees.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { apiRequest, getErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type RefundRow = {
  id: number;
  orderId: number;
  status: "requested" | "approved" | "rejected" | "paid";
  requestedAmount: number;
  approvedAmount: number | null;
  reason: string;
  method: string | null;
  adminNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
  paidAt: string | null;
  requestedBy?: { name?: string } | null;
  decidedBy?: { name?: string } | null;
};
type RefundsResponse = { rows: RefundRow[]; netCollected: number; openRequested: number; available: number };

export const rs = (paisa: number | null | undefined) => `Rs ${Math.round(Number(paisa || 0) / 100).toLocaleString()}`;
const toPaisa = (rupees: string) => Math.round(Number(rupees.replace(/,/g, "")) * 100);

const STATUS_STYLE: Record<RefundRow["status"], string> = {
  requested: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  approved: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  rejected: "border-slate-600 bg-slate-800/60 text-slate-400",
  paid: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
};
const STATUS_LABEL: Record<RefundRow["status"], string> = { requested: "Requested", approved: "Approved", rejected: "Rejected", paid: "Paid" };

export function RefundStatusBadge({ status }: { status: RefundRow["status"] }) {
  return <span className={cn("inline-flex rounded border px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>;
}

const invalidateRefunds = (orderId?: number) => {
  queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && ((q.queryKey[0] as string).startsWith("/api/refunds") || (q.queryKey[0] as string).startsWith("/api/orders")) });
  if (orderId) queryClient.invalidateQueries({ queryKey: [`/api/orders/${orderId}/refunds`] });
};

/** Approve / reject / mark paid controls for one refund (admin). */
export function RefundDecision({ refund, compact }: { refund: RefundRow; compact?: boolean }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(String(Math.round(refund.requestedAmount / 100)));
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const decide = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiRequest("POST", `/api/refunds/${refund.id}/decide`, body)).json(),
    onSuccess: (_d, body) => {
      toast({ title: body.decision === "approve" ? "Refund approved" : "Refund rejected" });
      setMode("idle");
      invalidateRefunds(refund.orderId);
    },
    onError: err => toast({ title: "Couldn't save", description: getErrorMessage(err), variant: "destructive" }),
  });
  const paid = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/refunds/${refund.id}/paid`, {})).json(),
    onSuccess: () => { toast({ title: "Marked as paid" }); invalidateRefunds(refund.orderId); },
    onError: err => toast({ title: "Couldn't save", description: getErrorMessage(err), variant: "destructive" }),
  });

  if (refund.status === "approved") {
    return <Button size="sm" variant="outline" disabled={paid.isPending} onClick={() => paid.mutate()} data-testid={`button-refund-paid-${refund.id}`}>Mark paid</Button>;
  }
  if (refund.status !== "requested") return null;
  if (mode === "idle") {
    return (
      <div className={cn("flex gap-2", compact && "justify-end")}>
        <Button size="sm" onClick={() => setMode("approve")} data-testid={`button-refund-approve-${refund.id}`}>Approve</Button>
        <Button size="sm" variant="outline" onClick={() => setMode("reject")} data-testid={`button-refund-reject-${refund.id}`}>Reject</Button>
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-md border border-slate-800 bg-slate-900/60 p-3">
      {mode === "approve" && (
        <label className="block text-xs text-slate-400">Approved amount (Rs)
          <Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="mt-1 h-8 bg-slate-950" data-testid={`input-refund-approve-amount-${refund.id}`} />
        </label>
      )}
      <label className="block text-xs text-slate-400">{mode === "approve" ? "Note (optional)" : "Reason for rejecting"}
        <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="mt-1 bg-slate-950" />
      </label>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>Back</Button>
        <Button
          size="sm"
          disabled={decide.isPending || (mode === "approve" ? !(toPaisa(amount) > 0) : note.trim().length < 3)}
          onClick={() => decide.mutate(mode === "approve"
            ? { decision: "approve", amount: toPaisa(amount), note: note.trim() || null }
            : { decision: "reject", note: note.trim() })}
        >{mode === "approve" ? "Approve refund" : "Reject"}</Button>
      </div>
    </div>
  );
}

export function OrderRefunds({ orderId, isAdmin, canRequest }: { orderId: number; isAdmin: boolean; canRequest: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const { data, isLoading } = useQuery<RefundsResponse>({ queryKey: [`/api/orders/${orderId}/refunds`] });
  const request = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/orders/${orderId}/refunds`, { amount: toPaisa(amount), reason: reason.trim() })).json(),
    onSuccess: () => {
      toast({ title: "Refund requested", description: isAdmin ? "Approve it below." : "An admin will review it." });
      setOpen(false); setAmount(""); setReason("");
      invalidateRefunds(orderId);
    },
    onError: err => toast({ title: "Couldn't request refund", description: getErrorMessage(err), variant: "destructive" }),
  });
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950 p-4" data-testid="order-refunds">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Refunds</h4>
        {canRequest && !open && (data?.available ?? 0) > 0 && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="button-request-refund">Request refund</Button>
        )}
      </div>
      {data && <p className="text-xs text-slate-500">Net collected {rs(data.netCollected)}{data.openRequested > 0 ? ` · ${rs(data.openRequested)} waiting for approval` : ""}</p>}
      {open && (
        <div className="space-y-2 rounded-md border border-slate-800 bg-slate-900/60 p-3">
          <label className="block text-xs text-slate-400">Amount (Rs) · up to {rs(data?.available)}
            <Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="mt-1 h-8 bg-slate-950" data-testid="input-refund-amount" />
          </label>
          <label className="block text-xs text-slate-400">Reason
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className="mt-1 bg-slate-950" data-testid="input-refund-reason" />
          </label>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={request.isPending || !(toPaisa(amount) > 0) || reason.trim().length < 3} onClick={() => request.mutate()} data-testid="button-submit-refund">Send request</Button>
          </div>
        </div>
      )}
      {isLoading ? <p className="text-sm text-slate-500">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No refunds on this order.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(r => (
            <li key={r.id} className="rounded-md border border-slate-800 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-white">{r.approvedAmount != null ? rs(r.approvedAmount) : rs(r.requestedAmount)}{r.approvedAmount != null && r.approvedAmount !== r.requestedAmount && <span className="ml-1 text-xs text-slate-500">(asked {rs(r.requestedAmount)})</span>}</span>
                <RefundStatusBadge status={r.status} />
              </div>
              <p className="mt-1 text-slate-300">{r.reason}</p>
              <p className="mt-1 text-xs text-slate-500">
                Requested by {r.requestedBy?.name || "—"} · {format(new Date(r.requestedAt), "MMM dd, yyyy")}
                {r.decidedAt && ` · ${r.status === "rejected" ? "Rejected" : "Approved"} by ${r.decidedBy?.name || "—"} ${format(new Date(r.decidedAt), "MMM dd")}`}
                {r.paidAt && ` · Paid ${format(new Date(r.paidAt), "MMM dd")}`}
              </p>
              {r.adminNote && <p className="mt-1 text-xs text-slate-400">Note: {r.adminNote}</p>}
              {isAdmin && <div className="mt-2"><RefundDecision refund={r} /></div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type QueueRow = RefundRow & { orderNumber: string | null; clientName: string };
type QueueResponse = { rows: QueueRow[]; total: number; page: number; pageSize: number; counts: Partial<Record<RefundRow["status"], number>> };
const QUEUE_TABS: Array<{ value: RefundRow["status"] | "all"; label: string }> = [
  { value: "requested", label: "Waiting" },
  { value: "approved", label: "Approved (to pay)" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

/** Refund requests across all orders (admin decides; support tracks). */
export function RefundsQueue({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<RefundRow["status"] | "all">("requested");
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), ...(status === "all" ? {} : { status }) }).toString();
  const { data, isLoading } = useQuery<QueueResponse>({ queryKey: [`/api/refunds?${qs}`] });
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50)));
  return (
    <div className="glass-panel overflow-hidden rounded-2xl border border-slate-800" data-testid="panel-refunds">
      <div className="flex flex-col gap-3 border-b border-slate-800 p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-bold text-white">Refunds</h3>
          <p className="text-sm text-slate-500">{isAdmin ? "Approve with an amount or reject, then mark paid once the money is sent." : "Refund requests and their status."}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {QUEUE_TABS.map(t => (
            <Button key={t.value} size="sm" variant={status === t.value ? "default" : "outline"} onClick={() => { setStatus(t.value); setPage(1); }} data-testid={`button-refunds-${t.value}`}>
              {t.label}{t.value !== "all" && data?.counts?.[t.value] ? ` (${data.counts[t.value]})` : ""}
            </Button>
          ))}
        </div>
      </div>
      {isLoading ? <p className="p-6 text-sm text-slate-500">Loading…</p> : rows.length === 0 ? (
        <p className="p-6 text-sm text-slate-500" data-testid="text-no-refunds">No refunds here.</p>
      ) : (
        <ul className="divide-y divide-slate-800">
          {rows.map(r => (
            <li key={r.id} className="flex flex-col gap-2 p-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`/orders?order=${encodeURIComponent(r.orderNumber || String(r.orderId))}`} className="font-mono text-blue-400 hover:underline">{r.orderNumber || `#${r.orderId}`}</a>
                  <span className="text-white">{r.clientName}</span>
                  <RefundStatusBadge status={r.status} />
                </div>
                <p className="mt-1 text-white">{r.approvedAmount != null ? rs(r.approvedAmount) : rs(r.requestedAmount)}{r.approvedAmount != null && r.approvedAmount !== r.requestedAmount && <span className="ml-1 text-xs text-slate-500">(asked {rs(r.requestedAmount)})</span>}</p>
                <p className="mt-1 text-slate-300">{r.reason}</p>
                <p className="mt-1 text-xs text-slate-500">Requested by {r.requestedBy?.name || "—"} · {format(new Date(r.requestedAt), "MMM dd, yyyy")}{r.adminNote ? ` · Note: ${r.adminNote}` : ""}</p>
              </div>
              {isAdmin && <div className="shrink-0 md:w-72"><RefundDecision refund={r} compact /></div>}
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-slate-800 p-3 text-sm text-slate-400">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
