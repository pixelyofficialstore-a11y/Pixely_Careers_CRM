import type React from "react";
import { Activity, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export function PageHeader({ eyebrow, title, description, actions, className, testId }: {
  eyebrow?: string; title: string; description?: string; actions?: React.ReactNode; className?: string; testId?: string;
}) {
  return <header className={cn("crm-page-header", className)} data-testid={testId}>
    <div><p className="crm-eyebrow">{eyebrow}</p><h1 className="crm-title">{title}</h1>{description && <p className="crm-description">{description}</p>}</div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </header>;
}

export function MetricCard({ label, value, note, icon: Icon = Activity, tone = "cyan", onClick, className, testId }: {
  label: string; value: string | number; note?: string; icon?: React.ElementType; tone?: "cyan" | "success" | "warning" | "danger"; onClick?: () => void; className?: string; testId?: string;
}) {
  const toneClass = { cyan: "text-cyan-300", success: "text-emerald-300", warning: "text-amber-300", danger: "text-rose-300" }[tone];
  const content = <><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">{label}</span><Icon className={cn("h-4 w-4", toneClass)} /></div><p className="mt-2 text-[1.45rem] font-semibold tracking-tight text-slate-100">{value}</p>{note && <p className="mt-0.5 text-[11px] text-slate-500">{note}</p>}</>;
  const classes = cn("glass-panel w-full rounded-lg p-3.5 text-left transition-colors hover:border-cyan-400/30", onClick && "cursor-pointer", className);
  return onClick ? <button type="button" onClick={onClick} className={classes} data-testid={testId}>{content}</button> : <div className={classes} data-testid={testId}>{content}</div>;
}

export function SectionCard({ title, eyebrow, description, children, className }: { title?: string; eyebrow?: string; description?: string; children: React.ReactNode; className?: string }) {
  return <section className={cn("crm-section", className)}>{(title || eyebrow || description) && <div className="crm-section-header"><p className="crm-eyebrow">{eyebrow}</p>{title && <h2 className="text-sm font-semibold text-slate-200">{title}</h2>}{description && <p className="mt-1 text-xs text-slate-500">{description}</p>}</div>}{children}</section>;
}

export function SearchInput({ value, onChange, placeholder = "Search records" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div className="relative min-w-[210px]"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" /><Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="crm-control h-9 pl-9 text-sm" /></div>;
}

export function EmptyState({ title, description, icon: Icon = Activity }: { title: string; description?: string; icon?: React.ElementType }) {
  return <div className="flex flex-col items-center justify-center px-5 py-12 text-center"><Icon className="mb-3 h-5 w-5 text-cyan-300/70" /><p className="text-sm font-medium text-slate-300">{title}</p>{description && <p className="mt-1 max-w-sm text-xs text-slate-500">{description}</p>}</div>;
}