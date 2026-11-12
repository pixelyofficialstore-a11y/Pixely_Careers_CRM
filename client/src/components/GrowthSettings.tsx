/**
 * Phase 5 Settings: the shared price catalog (packages + add-ons) and WhatsApp
 * quick-reply templates. Nothing here deletes rows: items and templates are
 * switched off with "Active" and can be switched back on.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageCircle, Pencil, Plus, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, getErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { rupees } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";
import type { CatalogItem, PackageConfig, WhatsappTemplate } from "@shared/schema";
import { fillTemplate } from "@shared/whatsapp-templates";

type ItemForm = {
  id?: number; kind: "package" | "addon"; key: string; label: string; description: string; price: string; currency: string; market: string;
  services: string; websiteKey: string; crmPackageKey: string; deliveryDays: string; sortOrder: string; isActive: boolean;
};
const emptyItem: ItemForm = { kind: "package", key: "", label: "", description: "", price: "", currency: "PKR", market: "pk", services: "", websiteKey: "", crmPackageKey: "", deliveryDays: "", sortOrder: "0", isActive: true };

export function CatalogItemsSection() {
  const { toast } = useToast();
  const { data: items = [], isLoading } = useQuery<CatalogItem[]>({ queryKey: ["/api/catalog"] });
  const { data: packageConfigs = [] } = useQuery<PackageConfig[]>({ queryKey: ["/api/package-configs"] });
  const [form, setForm] = useState<ItemForm | null>(null);
  const set = (patch: Partial<ItemForm>) => setForm(f => (f ? { ...f, ...patch } : f));

  const save = useMutation({
    mutationFn: async (f: ItemForm) => {
      const body = {
        kind: f.kind, label: f.label.trim(), description: f.description.trim() || null,
        price: Math.round(Number(f.price || 0) * 100), currency: f.currency.trim().toUpperCase() || "PKR", market: f.market.trim().toLowerCase() || "pk",
        services: f.services.split(",").map(s => s.trim()).filter(Boolean),
        websiteKey: f.websiteKey.trim() || null, crmPackageKey: f.crmPackageKey && f.crmPackageKey !== "none" ? f.crmPackageKey : null,
        deliveryDays: f.deliveryDays ? Number(f.deliveryDays) : null, sortOrder: Number(f.sortOrder || 0), isActive: f.isActive,
      };
      const res = f.id ? await apiRequest("PATCH", `/api/catalog/${f.id}`, body) : await apiRequest("POST", "/api/catalog", { ...body, key: f.key.trim().toLowerCase() });
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/catalog"] }); setForm(null); toast({ title: "Catalog saved" }); },
    onError: (e) => toast({ title: "Could not save", description: getErrorMessage(e), variant: "destructive" }),
  });
  const toggle = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => (await apiRequest("PATCH", `/api/catalog/${id}`, { isActive })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/catalog"] }),
    onError: (e) => toast({ title: "Could not update", description: getErrorMessage(e), variant: "destructive" }),
  });

  const edit = (i: CatalogItem) => setForm({
    id: i.id, kind: i.kind as "package" | "addon", key: i.key, label: i.label, description: i.description ?? "", price: String(i.price / 100), currency: i.currency, market: i.market,
    services: i.services.join(", "), websiteKey: i.websiteKey ?? "", crmPackageKey: i.crmPackageKey ?? "", deliveryDays: i.deliveryDays ? String(i.deliveryDays) : "", sortOrder: String(i.sortOrder), isActive: i.isActive,
  });
  const keyOk = !form || !!form.id || /^[a-z0-9][a-z0-9_-]{1,59}$/.test(form.key.trim().toLowerCase());
  const canSave = !!form && form.label.trim() && keyOk && form.price !== "" && Number(form.price) >= 0;

  const groups: Array<["package" | "addon", string]> = [["package", "Packages"], ["addon", "Add-ons"]];
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5" data-testid="section-catalog-items">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100"><Tag className="h-4 w-4 text-primary" />Prices: packages & add-ons</h2>
          <p className="text-sm text-slate-500">One price list for the Create Order form. The website can read it from <code className="text-xs">/api/public/catalog</code>.</p>
        </div>
        <Button size="sm" onClick={() => setForm({ ...emptyItem })} data-testid="button-add-catalog-item"><Plus className="mr-1 h-4 w-4" />Add item</Button>
      </div>
      {isLoading ? <div className="skeleton h-24 rounded-lg" /> : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-slate-500">No prices yet. Add your packages and add-ons so orders price themselves.</p>
      ) : groups.map(([kind, title]) => {
        const list = items.filter(i => i.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind} className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {list.map(i => (
                <li key={i.id} className={cn("flex flex-wrap items-center gap-3 px-3 py-2.5", !i.isActive && "opacity-60")} data-testid={`row-catalog-${i.key}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-200">{i.label} <span className="text-xs font-normal text-slate-500">{i.key} · {i.market.toUpperCase()}</span></p>
                    {(i.services.length > 0 || i.deliveryDays) && <p className="truncate text-xs text-slate-500">{[i.services.join(", "), i.deliveryDays ? `${i.deliveryDays} days` : ""].filter(Boolean).join(" · ")}</p>}
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-slate-200">{i.currency === "PKR" ? rupees(i.price) : `${i.currency} ${(i.price / 100).toLocaleString()}`}</span>
                  <Switch checked={i.isActive} onCheckedChange={v => toggle.mutate({ id: i.id, isActive: v })} aria-label={`Active: ${i.label}`} data-testid={`switch-catalog-${i.key}`} />
                  <Button variant="ghost" size="icon" onClick={() => edit(i)} aria-label={`Edit ${i.label}`} data-testid={`button-edit-catalog-${i.key}`}><Pencil className="h-4 w-4" /></Button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <Dialog open={!!form} onOpenChange={o => !o && setForm(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{form?.id ? "Edit item" : "New catalog item"}</DialogTitle></DialogHeader>
          {form && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.kind} onValueChange={v => set({ kind: v as ItemForm["kind"] })}>
                  <SelectTrigger data-testid="select-catalog-kind"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="package">Package</SelectItem><SelectItem value="addon">Add-on</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Key {form.id && <span className="text-xs text-slate-500">(fixed)</span>}</Label>
                <Input value={form.key} disabled={!!form.id} onChange={e => set({ key: e.target.value })} placeholder="ats_career" className={cn(!keyOk && "border-rose-500/70")} data-testid="input-catalog-key" />
                {!keyOk && <p className="text-xs text-rose-400">Lowercase letters, numbers, - or _</p>}
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Name</Label>
                <Input value={form.label} onChange={e => set({ label: e.target.value })} placeholder="ATS Career Package" data-testid="input-catalog-label" />
              </div>
              <div className="space-y-1.5">
                <Label>Price ({form.currency || "PKR"})</Label>
                <Input inputMode="decimal" value={form.price} onChange={e => set({ price: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0" data-testid="input-catalog-price" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Currency</Label><Input value={form.currency} maxLength={3} onChange={e => set({ currency: e.target.value.toUpperCase() })} /></div>
                <div className="space-y-1.5">
                  <Label>Market</Label>
                  <Select value={form.market} onValueChange={v => set({ market: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="pk">PK</SelectItem><SelectItem value="intl">Intl</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Description</Label>
                <Textarea rows={2} value={form.description} onChange={e => set({ description: e.target.value })} className="resize-none" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Services included <span className="text-xs text-slate-500">(comma separated; added to documentation orders)</span></Label>
                <Input value={form.services} onChange={e => set({ services: e.target.value })} placeholder="ATS CV, Cover Letter, LinkedIn Optimization" />
              </div>
              {form.kind === "package" && (
                <div className="space-y-1.5">
                  <Label>CRM package</Label>
                  <Select value={form.crmPackageKey || "none"} onValueChange={v => set({ crmPackageKey: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Same as key</SelectItem>
                      {packageConfigs.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5"><Label>Delivery days</Label><Input inputMode="numeric" value={form.deliveryDays} onChange={e => set({ deliveryDays: e.target.value.replace(/[^0-9]/g, "") })} placeholder="Package default" /></div>
              <div className="space-y-1.5"><Label>Website key</Label><Input value={form.websiteKey} onChange={e => set({ websiteKey: e.target.value })} placeholder="optional" /></div>
              <div className="space-y-1.5"><Label>Sort order</Label><Input inputMode="numeric" value={form.sortOrder} onChange={e => set({ sortOrder: e.target.value.replace(/[^0-9]/g, "") })} /></div>
              <label className="col-span-2 flex items-center gap-2 text-sm"><Switch checked={form.isActive} onCheckedChange={v => set({ isActive: v })} /> Active</label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button disabled={!canSave || save.isPending} onClick={() => form && save.mutate(form)} data-testid="button-save-catalog-item">{save.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

type TemplateRow = Pick<WhatsappTemplate, "kind" | "label" | "body" | "isActive" | "sortOrder"> & { id: number | null };
const SAMPLE = { name: "Ayesha", order: "PX-1234", amount: "Rs 2,500", balance: "Rs 2,500", link: "https://drive.google.com/…" };

export function WhatsAppTemplatesSection() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ source: "default" | "saved"; templates: TemplateRow[] }>({ queryKey: ["/api/whatsapp-templates"] });
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/whatsapp-templates"] });

  const adopt = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/whatsapp-templates/adopt-defaults")).json(),
    onSuccess: () => { invalidate(); toast({ title: "Templates ready to edit" }); },
    onError: (e) => toast({ title: "Could not save", description: getErrorMessage(e), variant: "destructive" }),
  });
  const save = useMutation({
    mutationFn: async (t: TemplateRow) => {
      const body = { kind: t.kind || "custom", label: t.label.trim(), body: t.body.trim(), isActive: t.isActive, sortOrder: t.sortOrder };
      return (t.id ? await apiRequest("PATCH", `/api/whatsapp-templates/${t.id}`, body) : await apiRequest("POST", "/api/whatsapp-templates", body)).json();
    },
    onSuccess: () => { invalidate(); setEditing(null); toast({ title: "Template saved" }); },
    onError: (e) => toast({ title: "Could not save", description: getErrorMessage(e), variant: "destructive" }),
  });
  const toggle = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => (await apiRequest("PATCH", `/api/whatsapp-templates/${id}`, { isActive })).json(),
    onSuccess: invalidate,
  });

  const saved = data?.source === "saved";
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5" data-testid="section-whatsapp-templates">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100"><MessageCircle className="h-4 w-4 text-emerald-500" />WhatsApp quick replies</h2>
          <p className="text-sm text-slate-500">Used by the WhatsApp button on orders and client profiles. Placeholders: {"{name} {order} {amount} {balance} {link}"}</p>
        </div>
        {saved ? (
          <Button size="sm" onClick={() => setEditing({ id: null, kind: "custom", label: "", body: "", isActive: true, sortOrder: (data?.templates.length ?? 0) })} data-testid="button-add-template"><Plus className="mr-1 h-4 w-4" />Add template</Button>
        ) : (
          <Button size="sm" onClick={() => adopt.mutate()} disabled={adopt.isPending} data-testid="button-adopt-templates">Customize templates</Button>
        )}
      </div>
      {!saved && <p className="rounded-md bg-[hsl(var(--accent))] px-3 py-2 text-xs text-slate-400">These are the built-in defaults. Press “Customize templates” to save a copy you can edit.</p>}
      {isLoading ? <div className="skeleton h-24 rounded-lg" /> : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {data?.templates.map(t => (
            <li key={`${t.id ?? t.kind}`} className={cn("flex items-start gap-3 px-3 py-2.5", !t.isActive && "opacity-60")} data-testid={`row-template-${t.kind}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-200">{t.label}</p>
                <p className="line-clamp-2 text-xs text-slate-500">{t.body}</p>
              </div>
              {saved && t.id && <>
                <Switch checked={t.isActive} onCheckedChange={v => toggle.mutate({ id: t.id!, isActive: v })} aria-label={`Active: ${t.label}`} />
                <Button variant="ghost" size="icon" onClick={() => setEditing(t)} aria-label={`Edit ${t.label}`} data-testid={`button-edit-template-${t.id}`}><Pencil className="h-4 w-4" /></Button>
              </>}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit template" : "New template"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Name</Label><Input value={editing.label} maxLength={60} onChange={e => setEditing({ ...editing, label: e.target.value })} data-testid="input-template-label" /></div>
              <div className="space-y-1.5"><Label>Message</Label><Textarea rows={5} maxLength={1000} value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })} data-testid="input-template-body" /></div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-slate-300">
                <p className="mb-1 text-xs text-slate-500">Preview</p>{fillTemplate(editing.body, SAMPLE) || "—"}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={!editing?.label.trim() || !editing?.body.trim() || save.isPending} onClick={() => editing && save.mutate(editing)} data-testid="button-save-template">{save.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
