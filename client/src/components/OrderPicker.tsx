import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toQueryString, type OrderPick } from "@/lib/orders";
import { cn } from "@/lib/utils";

type Props = {
  value: OrderPick | null;
  onChange: (order: OrderPick | null) => void;
  disabled?: boolean;
  /** Only orders with an assigned designer. */
  assignedOnly?: boolean;
  /** Only open orders with a remaining balance. */
  withBalance?: boolean;
  placeholder?: string;
  id?: string;
};

/**
 * Searchable order picker. Asks the server for up to 10 matches
 * (/api/orders/lookup) instead of loading every order into a dropdown.
 */
export function OrderPicker({ value, onChange, disabled, assignedOnly, withBalance, placeholder = "Search order ID, client or phone…", id }: Props) {
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const qs = toQueryString({ q: debounced, limit: 10, assigned: assignedOnly ? "1" : undefined, withBalance: withBalance ? "1" : undefined });
  const { data = [], isFetching } = useQuery<OrderPick[]>({
    queryKey: [`/api/orders/lookup?${qs}`],
    enabled: open && !disabled && (debounced.length > 0 || Boolean(withBalance)),
    staleTime: 15_000,
  });

  if (value) {
    return (
      <div className="flex min-h-10 items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" data-testid="order-picker-selected">
        <span className="min-w-0 truncate">
          <span className="font-mono text-blue-300">{value.orderNumber || `#${value.id}`}</span>
          <span className="text-slate-300"> · {value.clientName}</span>
          {value.assigneeName && <span className="text-slate-500"> · {value.assigneeName}</span>}
        </span>
        {!disabled && (
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onChange(null)} aria-label="Clear selected order">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      <Input
        id={id}
        value={text}
        disabled={disabled}
        onChange={e => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="h-10 bg-slate-950 border-slate-700 pl-9"
        autoComplete="off"
        data-testid="order-picker-input"
      />
      {isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-500" />}
      {open && (debounced || withBalance) && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-900 shadow-xl" role="listbox">
          {data.length === 0 && !isFetching && <p className="px-3 py-3 text-sm text-slate-500">No matching orders.</p>}
          {data.map(order => (
            <button
              key={order.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => { onChange(order); setOpen(false); setText(""); }}
              className={cn("flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-800")}
            >
              <span className="min-w-0 truncate"><span className="font-mono text-blue-300">{order.orderNumber || `#${order.id}`}</span><span className="text-slate-200"> · {order.clientName}</span></span>
              <span className="shrink-0 text-xs text-slate-500">{order.assigneeName || "Unassigned"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Turn a full order into a picker value. */
export function toOrderPick(order: { id: number; orderNumber: string | null; clientName: string; status: string; assignedToId: number | null; assignee?: { name?: string | null } | null; remainingAmount?: number | null }): OrderPick {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    clientName: order.clientName,
    status: order.status,
    assignedToId: order.assignedToId,
    assigneeName: order.assignee?.name ?? null,
    remainingAmount: order.remainingAmount ?? null,
  };
}
