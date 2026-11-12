import { useState } from "react";
import { useMutation, useQuery, keepPreviousData } from "@tanstack/react-query";
import { format, startOfMonth, subDays } from "date-fns";
import { Clock, Coins, Plus, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard } from "@/components/CRMPrimitives";
import { apiRequest, getErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { rupees } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";

type RoiRow = { campaign: string; spend: number; webOrders: number; webRevenue: number; crmOrders: number; crmRevenue: number; roas: number | null; profit: number };
type Roi = { from: string; to: string; rows: RoiRow[]; totals: { spend: number; webRevenue: number; crmRevenue: number; webOrders: number; roas: number | null; profit: number } };
type SpendRow = { id: number; spendDate: string; platform: string; campaign: string; amount: number; notes: string | null };

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const PRESETS = [
  { key: "month", label: "This month", range: () => [ymd(startOfMonth(new Date())), ymd(new Date())] },
  { key: "30", label: "Last 30 days", range: () => [ymd(subDays(new Date(), 29)), ymd(new Date())] },
  { key: "90", label: "Last 90 days", range: () => [ymd(subDays(new Date(), 89)), ymd(new Date())] },
] as const;
const roasText = (r: number | null) => (r == null ? "—" : `${r.toFixed(2)}×`);

/** Analytics → Marketing ROI: admin enters daily ad spend; ROAS = website revenue ÷ spend per utm_campaign. */
export function MarketingRoi() {
  const { toast } = useToast();
  const [[from, to], setRange] = useState<[string, string]>(() => PRESETS[0].range() as [string, string]);
  const [preset, setPreset] = useState<string>("month");
  const { data: roi, isLoading } = useQuery<Roi>({ queryKey: [`/api/analytics/roi?from=${from}&to=${to}`], placeholderData: keepPreviousData });
  const { data: spendRows = [] } = useQuery<SpendRow[]>({ queryKey: [`/api/ad-spend?from=${from}&to=${to}`], placeholderData: keepPreviousData });
  const knownCampaigns = Array.from(new Set((roi?.rows ?? []).map(r => r.campaign).filter(c => c !== "(no campaign)")));

  const [entry, setEntry] = useState({ spendDate: ymd(new Date()), platform: "meta", campaign: "", amount: "", notes: "" });
  const add = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/ad-spend", {
      spendDate: entry.spendDate, platform: entry.platform.trim() || "meta", campaign: entry.campaign.trim(),
      amount: Math.round(Number(entry.amount) * 100), notes: entry.notes.trim() || null,
    })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && (q.queryKey[0].startsWith("/api/ad-spend") || q.queryKey[0].startsWith("/api/analytics/roi")) });
      setEntry(e => ({ ...e, amount: "", notes: "" }));
      toast({ title: "Ad spend saved", description: "Entering the same day + campaign again replaces the amount." });
    },
    onError: (e) => toast({ title: "Could not save", description: getErrorMessage(e), variant: "destructive" }),
  });
  const amountOk = entry.amount !== "" && Number(entry.amount) >= 0 && /^\d+(\.\d{0,2})?$/.test(entry.amount);
  const t = roi?.totals;

  return (
    <div className="space-y-4" data-testid="marketing-roi">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border bg-card p-1" role="group" aria-label="Range">
          {PRESETS.map(p => (
            <button key={p.key} type="button" onClick={() => { setPreset(p.key); setRange(p.range() as [string, string]); }}
              className={cn("min-h-8 rounded-md px-3 text-sm transition-colors", preset === p.key ? "bg-[hsl(var(--accent))] font-medium text-primary" : "text-slate-500 hover:text-foreground")}>{p.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <Input type="date" value={from} max={to} onChange={e => { setPreset("custom"); setRange([e.target.value, to]); }} className="h-9 w-[150px]" aria-label="From" data-testid="input-roi-from" />
          <span className="text-slate-500">to</span>
          <Input type="date" value={to} min={from} onChange={e => { setPreset("custom"); setRange([from, e.target.value]); }} className="h-9 w-[150px]" aria-label="To" data-testid="input-roi-to" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Ad spend" value={rupees(t?.spend)} icon={Coins} tone="warning" testId="metric-roi-spend" />
        <MetricCard label="Website revenue" value={rupees(t?.webRevenue)} note={`${t?.webOrders ?? 0} paid checkouts`} icon={Wallet} testId="metric-roi-revenue" />
        <MetricCard label="ROAS" value={roasText(t?.roas ?? null)} note="Revenue ÷ spend" icon={TrendingUp} tone={(t?.roas ?? 0) >= 1 ? "success" : "danger"} testId="metric-roi-roas" />
        <MetricCard label="Profit after ads" value={rupees(t?.profit)} note={`CRM orders ${rupees(t?.crmRevenue)}`} tone={(t?.profit ?? 0) >= 0 ? "success" : "danger"} testId="metric-roi-profit" />
      </div>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="form-ad-spend">
        <h2 className="text-sm font-semibold text-slate-200">Add ad spend</h2>
        <form className="grid grid-cols-2 gap-3 md:grid-cols-[150px_120px_1fr_140px_auto]" onSubmit={e => { e.preventDefault(); if (amountOk) add.mutate(); }}>
          <div className="space-y-1"><Label className="text-xs">Date</Label><Input type="date" value={entry.spendDate} max={ymd(new Date())} onChange={e => setEntry({ ...entry, spendDate: e.target.value })} data-testid="input-spend-date" /></div>
          <div className="space-y-1"><Label className="text-xs">Platform</Label><Input value={entry.platform} onChange={e => setEntry({ ...entry, platform: e.target.value })} placeholder="meta" data-testid="input-spend-platform" /></div>
          <div className="col-span-2 space-y-1 md:col-span-1">
            <Label className="text-xs">Campaign (same as utm_campaign)</Label>
            <Input list="roi-campaigns" value={entry.campaign} onChange={e => setEntry({ ...entry, campaign: e.target.value })} placeholder="e.g. ats_nov" data-testid="input-spend-campaign" />
            <datalist id="roi-campaigns">{knownCampaigns.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="space-y-1"><Label className="text-xs">Amount (Rs)</Label><Input inputMode="decimal" value={entry.amount} onChange={e => setEntry({ ...entry, amount: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0" data-testid="input-spend-amount" /></div>
          <div className="flex items-end"><Button type="submit" disabled={!amountOk || add.isPending} className="w-full" data-testid="button-save-spend"><Plus className="mr-1 h-4 w-4" />{add.isPending ? "Saving" : "Save"}</Button></div>
        </form>
        {spendRows.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-400">{spendRows.length} spend entr{spendRows.length === 1 ? "y" : "ies"} in this range</summary>
            <ul className="mt-2 max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {spendRows.map(s => (
                <li key={s.id} className="flex justify-between gap-2 px-3 py-1.5">
                  <span className="text-slate-400">{format(new Date(`${s.spendDate}T12:00:00`), "d MMM")} · {s.platform} · {s.campaign || "(no campaign)"}</span>
                  <button type="button" className="tabular-nums text-slate-200 hover:text-primary" title="Edit: load into the form" onClick={() => setEntry({ spendDate: s.spendDate, platform: s.platform, campaign: s.campaign, amount: String(s.amount / 100), notes: s.notes ?? "" })}>{rupees(s.amount)}</button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-200">ROI by campaign</h2>
          <p className="text-xs text-slate-500">Website revenue = paid/converted checkouts (PKR) by utm_campaign. CRM revenue = approved orders with that campaign, for reference.</p>
        </div>
        {isLoading ? <div className="skeleton m-4 h-40" /> : (
          <div className="overflow-x-auto">
            <Table className="crm-table min-w-[760px]">
              <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Web orders</TableHead><TableHead className="text-right">Web revenue</TableHead><TableHead className="text-right">ROAS</TableHead><TableHead className="text-right">Profit</TableHead><TableHead className="text-right">CRM orders</TableHead><TableHead className="text-right">CRM revenue</TableHead></TableRow></TableHeader>
              <TableBody>
                {(roi?.rows ?? []).map(r => (
                  <TableRow key={r.campaign} data-testid={`row-roi-${r.campaign}`}>
                    <TableCell className="font-medium">{r.campaign}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.spend ? rupees(r.spend) : <span className="text-slate-500">—</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.webOrders}</TableCell>
                    <TableCell className="text-right tabular-nums">{rupees(r.webRevenue)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums font-semibold", r.roas == null ? "text-slate-500" : r.roas >= 1 ? "text-emerald-400" : "text-rose-400")}>{roasText(r.roas)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", r.profit < 0 ? "text-rose-400" : "text-emerald-400")}>{rupees(r.profit)}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-400">{r.crmOrders}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-400">{rupees(r.crmRevenue)}</TableCell>
                  </TableRow>
                ))}
                {roi && roi.rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-slate-500">No spend or revenue in this range.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

type Sla = { total: number; onTime: number; rate: number | null; byMonth: Array<{ month: string; delivered: number; onTime: number; rate: number; avgLateHours: number }>; byDesigner: Array<{ designer: string; delivered: number; onTime: number; rate: number }> };
const pct = (r: number | null | undefined) => (r == null ? "—" : `${Math.round(r * 100)}%`);

/** Analytics → Team: on-time delivery (SLA) for the last 6 months. */
export function SlaSection() {
  const { data, isLoading } = useQuery<Sla>({ queryKey: ["/api/analytics/sla?months=6"] });
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="section-sla">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200"><Clock className="h-4 w-4 text-primary" />On-time delivery (last 6 months)</h2>
          <p className="text-xs text-slate-500">Delivered on or before the due date. Old orders use created date + package days.</p>
        </div>
        <p className="text-2xl font-semibold tabular-nums text-slate-100" data-testid="text-sla-rate">{pct(data?.rate)} <span className="text-xs font-normal text-slate-500">{data ? `${data.onTime}/${data.total}` : ""}</span></p>
      </div>
      {isLoading ? <div className="skeleton m-4 h-32" /> : (
        <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-border">
          <ul className="divide-y divide-border">
            {(data?.byMonth ?? []).map(m => (
              <li key={m.month} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-20 text-slate-400">{format(new Date(`${m.month}-01T12:00:00`), "MMM yyyy")}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-[hsl(var(--accent))]"><span className={cn("block h-full rounded-full", m.rate >= 0.9 ? "bg-emerald-500" : m.rate >= 0.7 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${Math.round(m.rate * 100)}%` }} /></span>
                <span className="w-12 text-right tabular-nums text-slate-200">{pct(m.rate)}</span>
                <span className="w-16 text-right text-xs text-slate-500">{m.delivered} done</span>
              </li>
            ))}
            {data && data.byMonth.length === 0 && <li className="px-4 py-6 text-sm text-slate-500">No deliveries yet.</li>}
          </ul>
          <ul className="divide-y divide-border">
            {(data?.byDesigner ?? []).map(d => (
              <li key={d.designer} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <span className="truncate text-slate-300">{d.designer}</span>
                <span className="tabular-nums"><span className={cn("font-semibold", d.rate >= 0.9 ? "text-emerald-400" : d.rate >= 0.7 ? "text-amber-400" : "text-rose-400")}>{pct(d.rate)}</span> <span className="text-xs text-slate-500">{d.onTime}/{d.delivered}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
