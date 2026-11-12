import type React from "react";
import { Activity, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export function PageHeader({ eyebrow, title, description, actions, className, testId }: {
  eyebrow?: string; title: string; description?: string; actions?: React.ReactNode; className?: string; testId?: string;
}) {
  return <header className={cn("crm-page-header", className)} data-testid={testId}>
    <div className="min-w-0"><>{eyebrow && <p className="crm-eyebrow">{eyebrow}</p>}</><h1 className="crm-title">{title}</h1>{description && <p className="crm-description">{description}</p>}</div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </header>;
}

export function MetricCard({ label, value, note, icon: Icon = Activity, tone = "cyan", onClick, className, testId }: {
  label: string; value: string | number; note?: string; icon?: React.ElementType; tone?: "cyan" | "success" | "warning" | "danger"; onClick?: () => void; className?: string; testId?: string;
}) {
  const toneClass = { cyan: "bg-[hsl(var(--accent))] text-primary", success: "bg-emerald-500/10 text-emerald-400", warning: "bg-amber-500/10 text-amber-400", danger: "bg-rose-500/10 text-rose-400" }[tone];
  const content = <><div className="flex items-center justify-between gap-2"><span className="text-sm text-slate-400">{label}</span><span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", toneClass)}><Icon aria-hidden="true" className="h-4 w-4" /></span></div><p className="mt-2 font-display text-[1.6rem] font-semibold leading-tight tracking-tight text-slate-100">{value}</p>{note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}</>;
  const classes = cn("crm-metric-card w-full rounded-xl border border-border bg-card p-4 text-left transition-colors duration-150", onClick && "cursor-pointer hover:border-[hsl(var(--border-hover))] focus-visible:ring-2 focus-visible:ring-ring", className);
  return onClick ? <button type="button" onClick={onClick} className={classes} data-testid={testId}>{content}</button> : <div className={classes} data-testid={testId}>{content}</div>;
}

export function CompactMetric({ label, value, tone = "cyan" }: {
  label: string;
  value: string | number;
  tone?: "cyan" | "success" | "warning" | "danger";
}) {
  const valueClass = { cyan: "text-cyan-200", success: "text-emerald-300", warning: "text-amber-300", danger: "text-rose-300" }[tone];
  return <div className="crm-compact-metric">
    <span className="crm-compact-metric-label">{label}</span>
    <span className={cn("crm-compact-metric-value", valueClass)}>{value}</span>
  </div>;
}

export function SectionCard({ title, eyebrow, description, children, className }: { title?: string; eyebrow?: string; description?: string; children: React.ReactNode; className?: string }) {
  return <section className={cn("crm-section", className)}>{(title || eyebrow || description) && <div className="crm-section-header"><p className="crm-eyebrow">{eyebrow}</p>{title && <h2 className="text-sm font-semibold text-slate-200">{title}</h2>}{description && <p className="mt-1 text-xs text-slate-500">{description}</p>}</div>}{children}</section>;
}

export function SearchInput({ value, onChange, placeholder = "Search records" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div className="relative min-w-[210px]"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" /><Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="crm-control h-9 pl-9 text-sm" /></div>;
}

export function EmptyState({ title, description, icon: Icon = Activity }: { title: string; description?: string; icon?: React.ElementType }) {
  return <div className="flex flex-col items-center justify-center px-5 py-12 text-center"><Icon className="mb-3 h-5 w-5 stroke-[1.5] text-slate-500" /><p className="text-sm font-medium text-slate-300">{title}</p>{description && <p className="mt-1 max-w-sm text-xs text-slate-500">{description}</p>}</div>;
}