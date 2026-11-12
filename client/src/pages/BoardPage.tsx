import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/CRMPrimitives";
import { PaymentStateBadge } from "@/components/StatusBadge";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getErrorMessage, queryClient } from "@/lib/queryClient";
import { fetchOrderPage, type OrderListParams } from "@/lib/orders";
import { cn } from "@/lib/utils";
import { allowedWorkTargets, processOf, WORK_STATUS_LABELS, type DisplayWorkStatus, type OrderProcess } from "@shared/order-process";
import type { OrderWithServices } from "@shared/schema";

type Row = OrderWithServices & { process?: OrderProcess };

const COLUMNS: Array<{ key: DisplayWorkStatus; also?: DisplayWorkStatus[] }> = [
  { key: "confirmed" },
  { key: "in_progress" },
  { key: "draft_sent" },
  { key: "revisions" },
  { key: "delivered", also: ["closed"] },
];

const PARAMS: OrderListParams = { page: 1, pageSize: 300, view: "board", period: "all" };
const KEY = ["/api/orders", "board"] as const;
const rs = (paisa?: number | null) => `Rs ${Math.round((paisa || 0) / 100).toLocaleString("en-PK")}`;

export default function BoardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [dragId, setDragId] = useState<number | null>(null);
  const [overCol, setOverCol] = useState<DisplayWorkStatus | null>(null);
  const role = user?.role ?? "designer";

  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: () => fetchOrderPage(PARAMS) });
  const rows = (data?.rows ?? []) as Row[];

  const columns = useMemo(() => {
    const byCol = new Map<DisplayWorkStatus, Row[]>(COLUMNS.map(c => [c.key, []]));
    for (const o of rows) {
      const ws = processOf(o).workStatus;
      const col = COLUMNS.find(c => c.key === ws || c.also?.includes(ws));
      if (col) byCol.get(col.key)!.push(o);
    }
    // Earliest due first; no due date last.
    byCol.forEach(list => list.sort((a, b) => {
      const da = processOf(a).dueAt, db = processOf(b).dueAt;
      return (da ? Date.parse(da) : Infinity) - (db ? Date.parse(db) : Infinity);
    }));
    return byCol;
  }, [rows]);

  const move = useMutation({
    mutationFn: async ({ id, to }: { id: number; to: DisplayWorkStatus }) =>
      (await apiRequest("PATCH", `/api/orders/${id}`, { workStatus: to })).json(),
    // Optimistic: the card jumps columns at once, rolls back on error.
    onMutate: async ({ id, to }) => {
      await queryClient.cancelQueries({ queryKey: KEY });
      const prev = queryClient.getQueryData(KEY);
      queryClient.setQueryData(KEY, (cur: any) => cur && ({
        ...cur,
        rows: cur.rows.map((o: Row) => o.id === id ? { ...o, process: { ...processOf(o), workStatus: to } } : o),
      }));
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(KEY, ctx.prev);
      toast({ title: "Couldn't move order", description: getErrorMessage(err), variant: "destructive" });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/orders"] }),
  });

  const targetsFor = (o: Row) => allowedWorkTargets(role, processOf(o).workStatus, (o.remainingAmount ?? 0) === 0);
  const dragged = dragId != null ? rows.find(r => r.id === dragId) : undefined;
  const canDropOn = (col: DisplayWorkStatus) => Boolean(dragged && processOf(dragged).workStatus !== col && targetsFor(dragged).includes(col));

  return (
    <div className="crm-page space-y-4">
      <PageHeader title="Board" />
      {isLoading ? (
        <div className="flex gap-3 overflow-hidden">{COLUMNS.map(c => <div key={c.key} className="skeleton h-96 w-72 shrink-0 rounded-xl" />)}</div>
      ) : (
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 lg:mx-0 lg:px-0" data-testid="board">
          {COLUMNS.map(col => {
            const list = columns.get(col.key) ?? [];
            const droppable = canDropOn(col.key);
            return (
              <section
                key={col.key}
                aria-label={WORK_STATUS_LABELS[col.key]}
                onDragOver={(e) => { if (droppable) { e.preventDefault(); setOverCol(col.key); } }}
                onDragLeave={() => setOverCol(c => (c === col.key ? null : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverCol(null);
                  if (dragged && droppable) move.mutate({ id: dragged.id, to: col.key });
                  setDragId(null);
                }}
                className={cn(
                  "flex w-[280px] shrink-0 snap-start flex-col rounded-xl border border-border bg-[hsl(var(--surface-2))] transition-colors duration-150",
                  dragged && !droppable && "opacity-60",
                  overCol === col.key && "border-primary bg-[hsl(var(--accent))]",
                )}
                data-testid={`board-col-${col.key}`}
              >
                <header className="flex items-center justify-between px-3 py-2.5">
                  <h2 className="text-sm font-semibold text-slate-200">{WORK_STATUS_LABELS[col.key]}</h2>
                  <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-slate-500">{list.length}</span>
                </header>
                <div className="flex max-h-[calc(100dvh-14rem)] flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {list.map(o => {
                    const p = processOf(o);
                    const movable = targetsFor(o).some(t => t !== p.workStatus);
                    return (
                      <article
                        key={o.id}
                        draggable={movable}
                        onDragStart={(e) => { setDragId(o.id); e.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => { setDragId(null); setOverCol(null); }}
                        onClick={() => setLocation(`/orders?order=${encodeURIComponent(o.orderNumber || String(o.id))}`)}
                        className={cn(
                          "cursor-pointer rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow duration-150 hover:shadow-md",
                          movable && "active:cursor-grabbing",
                          dragId === o.id && "opacity-50",
                        )}
                        data-testid={`board-card-${o.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-medium text-primary">{o.orderNumber}</span>
                          {p.dueAt && col.key !== "delivered" && (
                            <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                              p.overdue ? "bg-rose-500/10 text-rose-400" : "bg-slate-900 text-slate-400")}>
                              <CalendarClock className="h-3 w-3" />{p.overdue ? "Overdue · " : ""}{format(new Date(p.dueAt), "MMM d")}
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 truncate text-sm font-medium text-slate-100">{o.clientName}</p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          {role !== "designer" ? <PaymentStateBadge state={p.paymentState} /> : <span />}
                          <span className="truncate text-xs text-slate-500">{role === "designer" ? rs(o.totalPrice) : o.assignee?.name || "Unassigned"}</span>
                        </div>
                      </article>
                    );
                  })}
                  {list.length === 0 && <p className="py-6 text-center text-xs text-slate-500">Nothing here</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
