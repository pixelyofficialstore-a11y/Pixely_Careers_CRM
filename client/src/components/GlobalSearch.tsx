import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fetchOrderPage } from "@/lib/orders";
import { cn } from "@/lib/utils";
import { processOf, WORK_STATUS_LABELS } from "@shared/order-process";

/** Ctrl+K / ⌘K: find an order by ID, client name or phone. */
export function GlobalSearch({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const [, setLocation] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(o => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (!open) { setQ(""); setDebounced(""); } }, [open]);
  useEffect(() => setActive(0), [debounced]);

  const { data, isFetching } = useQuery({
    queryKey: ["/api/orders", "search", debounced],
    queryFn: () => fetchOrderPage({ page: 1, pageSize: 8, search: debounced, period: "all" }),
    enabled: open && debounced.length >= 2,
    staleTime: 15_000,
  });
  const rows = debounced.length >= 2 ? data?.rows ?? [] : [];

  const go = (ref: string) => { setOpen(false); setLocation(`/orders?order=${encodeURIComponent(ref)}`); };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-10 items-center gap-2 rounded-lg border border-border bg-[hsl(var(--surface-2))] text-sm text-muted-foreground hover:border-[hsl(var(--border-hover))]",
          compact ? "w-10 justify-center" : "w-full max-w-md px-3",
        )}
        aria-label="Search orders (Ctrl+K)"
        data-testid="button-global-search"
      >
        <Search className="h-4 w-4 shrink-0" />
        {!compact && <>
          <span className="flex-1 truncate text-left">Search order ID, client, phone</span>
          <kbd className="hidden rounded border border-border bg-card px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground sm:inline">Ctrl K</kbd>
        </>}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[12%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0 sm:top-[15%]" onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}>
          <DialogTitle className="sr-only">Search orders</DialogTitle>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, rows.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
                if (e.key === "Enter" && rows[active]) go(rows[active].orderNumber || String(rows[active].id));
              }}
              placeholder="Order ID, client name or phone"
              className="h-12 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
              aria-label="Search orders"
              data-testid="input-global-search"
            />
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <ul className="max-h-[50vh] overflow-y-auto p-1.5" role="listbox">
            {debounced.length < 2 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Type at least 2 characters</li>}
            {debounced.length >= 2 && !isFetching && rows.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No orders found</li>}
            {rows.map((o, i) => (
              <li key={o.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(o.orderNumber || String(o.id))}
                  className={cn("flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left", i === active && "bg-[hsl(var(--accent))]")}
                >
                  <span className="w-24 shrink-0 font-mono text-xs font-medium text-primary">{o.orderNumber || "Request"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{o.clientName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{o.clientPhone || ""}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{WORK_STATUS_LABELS[processOf(o as any).workStatus]}</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
