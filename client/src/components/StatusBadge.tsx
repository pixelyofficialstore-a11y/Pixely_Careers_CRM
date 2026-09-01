import { cn } from "@/lib/utils";

type StatusKind = "order" | "complaint" | "suggestion" | "payment" | "advance-payment" | "payment-line";
type StatusConfig = { color: string; label: string };

const orderStatusConfig: Record<string, StatusConfig> = {
  pending_payment: { color: "bg-amber-500/10 text-amber-300 border-amber-500/20", label: "Pending Payment" },
  pending: { color: "bg-amber-500/10 text-amber-300 border-amber-500/20", label: "Pending" },
  new: { color: "bg-amber-500/10 text-amber-300 border-amber-500/20", label: "New" },
  working: { color: "bg-cyan-500/10 text-cyan-200 border-cyan-500/20", label: "Working" },
  ready: { color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20", label: "Ready" },
  delivered: { color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20", label: "Delivered" },
  canceled: { color: "bg-rose-500/10 text-rose-300 border-rose-500/20", label: "Canceled" },
};

const chatStatusConfig: Record<string, { color: string; label: string }> = {
  new: { color: "bg-slate-500/10 text-slate-300 border-slate-500/20", label: "New" },
  changes: { color: "bg-amber-500/10 text-amber-300 border-amber-500/20", label: "Changes" },
  satisfied: { color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20", label: "Satisfied" },
  issues: { color: "bg-rose-500/10 text-rose-300 border-rose-500/20", label: "Issues" },
};

const complaintStatusConfig: Record<string, { color: string; label: string }> = {
  new: { color: "bg-amber-500/10 text-amber-300 border-amber-500/20", label: "New" },
  confirmed: { color: "bg-amber-500/10 text-amber-300 border-amber-500/20", label: "Confirmed" },
  dismissed: { color: "bg-slate-500/10 text-slate-400 border-slate-500/20", label: "Dismissed" },
  resolved: { color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20", label: "Resolved" },
  refunded: { color: "bg-rose-500/10 text-rose-300 border-rose-500/20", label: "Refunded" },
};

const suggestionStatusConfig: Record<string, StatusConfig> = {
  new: { color: "bg-amber-500/10 text-amber-300 border-amber-500/20", label: "New" },
  implemented: { color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20", label: "Implemented" },
  rejected: { color: "bg-rose-500/10 text-rose-300 border-rose-500/20", label: "Rejected" },
};

const paymentStatusConfig: Record<string, StatusConfig> = {
  pending_confirmation: { color: "bg-amber-500/10 text-amber-300 border-amber-500/20", label: "Pending" },
  approved: { color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20", label: "Approved" },
  disapproved: { color: "bg-rose-500/10 text-rose-300 border-rose-500/20", label: "Disapproved" },
};

const advancePaymentStatusConfig: Record<string, StatusConfig> = {
  pending: { color: "bg-amber-500/10 text-amber-300 border-amber-500/20", label: "Pending" },
  approved: { color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20", label: "Approved" },
  disapproved: { color: "bg-rose-500/10 text-rose-300 border-rose-500/20", label: "Disapproved" },
};

const paymentLineStatusConfig: Record<string, StatusConfig> = {
  paid: { color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20", label: "Paid" },
  pending: { color: "bg-rose-500/10 text-rose-300 border-rose-500/20", label: "Pending" },
};

const statusConfigs: Record<StatusKind, Record<string, StatusConfig>> = {
  order: orderStatusConfig,
  complaint: complaintStatusConfig,
  suggestion: suggestionStatusConfig,
  payment: paymentStatusConfig,
  "advance-payment": advancePaymentStatusConfig,
  "payment-line": paymentLineStatusConfig,
};

export function StatusBadge({ kind, status, className }: { kind: StatusKind; status: string | null | undefined; className?: string }) {
  const config = statusConfigs[kind][status || ""] || {
    color: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    label: status ? status.replaceAll("_", " ") : "Not set",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border", config.color, className)}>
      {config.label}
    </span>
  );
}

export function OrderStatusBadge({ status }: { status: string }) {
  return <StatusBadge kind="order" status={status} />;
}

export function ChatStatusBadge({ status }: { status: string }) {
  const config = chatStatusConfig[status] || chatStatusConfig.new;
  return (
    <span className={cn("px-2 py-0.5 rounded text-[11px] font-medium border", config.color)}>
      {config.label}
    </span>
  );
}

export function ComplaintStatusBadge({ status }: { status: string }) {
  return <StatusBadge kind="complaint" status={status} />;
}

export function SuggestionStatusBadge({ status }: { status: string }) {
  return <StatusBadge kind="suggestion" status={status} />;
}

export function PaymentStatusBadge({ status }: { status: string }) {
  return <StatusBadge kind="payment" status={status} />;
}

export function AdvancePaymentStatusBadge({ status }: { status: string | null | undefined }) {
  return <StatusBadge kind="advance-payment" status={status} />;
}

export function PaymentLineStatusBadge({ status }: { status: string | null | undefined }) {
  return <StatusBadge kind="payment-line" status={status} />;
}

export function PriorityBadge({ priority }: { priority: string }) {
  const isHigh = priority === 'high';
  const isUrgent = priority === 'urgent';
  
  if (priority === 'normal') return <span className="text-slate-500 text-xs">Normal</span>;
  
  return (
    <span className={cn(
      "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border",
      isUrgent ? "border-rose-500/25 bg-rose-500/10 text-rose-300" : "border-amber-500/20 bg-amber-500/10 text-amber-300"
    )}>
      {priority}
    </span>
  );
}
