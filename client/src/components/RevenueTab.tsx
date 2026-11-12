import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { compactRupees, rupees, useChartColors } from "@/lib/chart-colors";

type Point = { month: string; orders: number; canceled: number; sales: number; collected: number; refunded: number };
const RANGES = [6, 12, 24] as const;

/** Analytics → Revenue. Every number is a SQL aggregate from /api/metrics/monthly (paisa). */
export function RevenueTab() {
  const [months, setMonths] = useState<(typeof RANGES)[number]>(12);
  const c = useChartColors();
  const { data, isLoading } = useQuery<Point[]>({ queryKey: [`/api/metrics/monthly?months=${months}`] });
  const rows = (data ?? []).map(d => ({ ...d, label: format(new Date(`${d.month}-01T12:00:00`), months > 12 ? "MMM yy" : "MMM") }));
  const totals = rows.reduce((a, r) => ({ sales: a.sales + r.sales, collected: a.collected + r.collected, refunded: a.refunded + r.refunded, orders: a.orders + r.orders }), { sales: 0, collected: 0, refunded: 0, orders: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-border bg-card p-1" role="group" aria-label="Range">
          {RANGES.map(r => (
            <button key={r} onClick={() => setMonths(r)} className={cn("min-h-8 rounded-md px-3 text-sm transition-colors duration-150", months === r ? "bg-[hsl(var(--accent))] font-medium text-primary" : "text-slate-500 hover:text-foreground")}>
              {r} months
            </button>
          ))}
        </div>
        <p className="text-sm text-slate-500">
          Sales <span className="font-semibold text-slate-200">{rupees(totals.sales)}</span> · Collected <span className="font-semibold text-slate-200">{rupees(totals.collected)}</span> · {totals.orders.toLocaleString("en-PK")} orders
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Sales vs collected</h2>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.primary }} />Sales</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.accent }} />Collected</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-3" style={{ background: c.danger }} />Refunded</span>
          </div>
        </div>
        {isLoading ? <div className="skeleton h-72" /> : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} barGap={3} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
                <CartesianGrid vertical={false} stroke={c.grid} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: c.text, fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: c.text, fontSize: 12 }} tickFormatter={compactRupees} width={48} />
                <Tooltip
                  cursor={{ fill: c.grid, opacity: 0.35 }}
                  contentStyle={{ background: c.card, border: `1px solid ${c.grid}`, borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number, name: string) => [rupees(v), name.charAt(0).toUpperCase() + name.slice(1)]}
                />
                <Bar dataKey="sales" fill={c.primary} radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="collected" fill={c.accent} radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Line dataKey="refunded" stroke={c.danger} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <Table className="crm-table">
            <TableHeader>
              <TableRow><TableHead>Month</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Canceled</TableHead><TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Collected</TableHead><TableHead className="text-right">Refunded</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {[...rows].reverse().map(r => (
                <TableRow key={r.month}>
                  <TableCell className="font-medium">{format(new Date(`${r.month}-01T12:00:00`), "MMMM yyyy")}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.orders}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", r.canceled ? "text-rose-400" : "text-slate-500")}>{r.canceled}</TableCell>
                  <TableCell className="text-right tabular-nums">{rupees(r.sales)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-400">{rupees(r.collected)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", r.refunded ? "text-rose-400" : "text-slate-500")}>{rupees(r.refunded)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
