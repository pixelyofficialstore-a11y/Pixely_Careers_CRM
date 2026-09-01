import { cn } from "@/lib/utils";

const orderStatusConfig: Record<string, { color: string; label: string }> = {
  pending_payment: { color: "bg-orange-500/10 text-orange-500 border-orange-500/20", label: "Pending Payment" },
  pending: { color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20", label: "Pending" },
  new: { color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20", label: "New" },
  working: { color: "bg-blue-500/10 text-blue-500 border-blue-500/20", label: "Working" },
  ready: { color: "bg-green-500/10 text-green-500 border-green-500/20", label: "Ready" },
  delivered: { color: "bg-slate-500/10 text-slate-400 border-slate-500/20", label: "Delivered" },
};

const chatStatusConfig: Record<string, { color: string; label: string }> = {
  new: { color: "bg-purple-500/10 text-purple-500 border-purple-500/20", label: "New" },
  changes: { color: "bg-orange-500/10 text-orange-500 border-orange-500/20", label: "Changes" },
  satisfied: { color: "bg-green-500/10 text-green-500 border-green-500/20", label: "Satisfied" },
  issues: { color: "bg-red-500/10 text-red-500 border-red-500/20", label: "Issues" },
};

const complaintStatusConfig: Record<string, { color: string; label: string }> = {
  new: { color: "bg-slate-500/10 text-slate-300 border-slate-500/20", label: "New" },
  confirmed: { color: "bg-amber-500/10 text-amber-300 border-amber-500/20", label: "Confirmed" },
  dismissed: { color: "bg-slate-500/10 text-slate-400 border-slate-500/20", label: "Dismissed" },
  resolved: { color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20", label: "Resolved" },
  refunded: { color: "bg-rose-500/10 text-rose-300 border-rose-500/20", label: "Refunded" },
};

export function OrderStatusBadge({ status }: { status: string }) {
  const config = orderStatusConfig[status] || orderStatusConfig.pending;
  return (
    <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium border", config.color)}>
      {config.label}
    </span>
  );
}

export function ChatStatusBadge({ status }: { status: string }) {
  const config = chatStatusConfig[status] || chatStatusConfig.new;
  return (
    <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium border", config.color)}>
      {config.label}
    </span>
  );
}

export function ComplaintStatusBadge({ status }: { status: string }) {
  const config = complaintStatusConfig[status] || complaintStatusConfig.new;
  return (
    <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium border", config.color)}>
      {config.label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const isHigh = priority === 'high';
  const isUrgent = priority === 'urgent';
  
  if (priority === 'normal') return <span className="text-slate-500 text-xs">Normal</span>;
  
  return (
    <span className={cn(
      "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
      isUrgent ? "bg-red-500 text-white" : "bg-orange-500/10 text-orange-500"
    )}>
      {priority}
    </span>
  );
}
