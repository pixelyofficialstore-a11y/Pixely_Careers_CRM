import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { Link, Redirect, useLocation, useSearch } from "wouter";
import { format } from "date-fns";
import {
  AlertTriangle, ArrowRight, Building2, CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight, Clock, Copy, Download,
  ExternalLink, FileText, Filter, Globe, Handshake, Inbox, Loader2, MessageCircle, MoreHorizontal, RefreshCw, Search,
  Send, ShieldCheck, Sparkles, Tag, TrendingUp, Users, X, XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getErrorMessage } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard, PageHeader } from "@/components/CRMPrimitives";
import {
  CreateOrderForm, ServiceTypeSelector, ORDER_SERVICE_TYPE_TITLES,
  type OrderServiceType, type WebsiteOrderPrefill, type ContactPrefill,
} from "@/pages/OrdersPage";
import { DEFAULT_PACKAGE_DELIVERY_DAYS } from "@shared/order-process";
import type { User, SupportDesignerAssignment, PlatformCatalogItem } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

type TabKey = "orders" | "reviews" | "partners";
type Addon = { id?: string; name?: string; qty?: number; price?: number };
type Activity = { id: number; action: string; details: Record<string, any> | null; created_at: string; actor_name: string | null; actor_role: string | null };

type WebsiteOrder = {
  id: string; created_at: string; updated_at: string; market: string | null; country: string | null;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
  utm_content?: string | null; landing_page?: string | null; referrer?: string | null;
  last_change?: LastChange | null;
  status: string; package: string; package_price: number; addons: Addon[] | null; same_day: boolean; offer: string | null;
  is_bundle: boolean; pay_choice: string | null; discount: number; subtotal: number; total: number; currency: string;
  name: string | null; whatsapp: string | null; email: string | null; target_country: string | null; target_role: string | null;
  notes: string | null; cv_url: string | null; payment_method: string | null; payment_screenshot_url: string | null;
  transaction_id: string | null; paid_at: string | null; crm_order_id: number | null; paid_amount: string | null;
  verified_by: number | null; verified_at: string | null; reject_reason: string | null; crm_notes: string | null;
  submitted_by: number | null; submitted_at: string | null; approval_note: string | null;
  meta_status: MetaStatus | null; meta_event_id: string | null; meta_purchase_sent_at: string | null;
};
type MetaStatus = "pending" | "sent" | "test" | "failed";
type WebsiteOrderDetail = WebsiteOrder & {
  flags: { code: string; message: string }[]; activity: Activity[];
  crmOrder: { id: number; orderNumber: string | null } | null; verifiedByName: string | null; submittedByName: string | null;
  meta: { response: Record<string, any> | null; hasFbp: boolean; hasFbc: boolean; hasIp: boolean } | null;
};

type CvReview = {
  id: string; created_at: string; market: string | null; country: string | null; utm_source: string | null; utm_campaign: string | null;
  status: string; name: string; whatsapp: string; email: string | null; target_role: string | null; target_country: string | null;
  target_countries: string[] | null; cv_url: string | null; cv_filename: string | null; notes: string | null; internal_notes: string | null;
  crm_order_id: number | null; review_started_at: string | null; sent_at: string | null; converted_at: string | null; reject_reason: string | null;
};
type CvReviewDetail = CvReview & { activity: Activity[]; crmOrder: { id: number; orderNumber: string | null } | null };

type Partner = {
  id: string; created_at: string; market: string | null; utm_source: string | null; utm_campaign: string | null;
  last_change?: LastChange | null;
  status: string; org_name: string; org_type: string | null; contact_name: string; designation: string | null; whatsapp: string;
  email: string | null; country_hq: string | null; destinations: string | null; monthly_volume: string | null; model: string | null;
  notes: string | null; internal_notes: string | null; contacted_at: string | null;
};
type PartnerDetail = Partner & { activity: Activity[] };

type ListPage<T> = { rows: T[]; total: number; page: number; pageSize: number; status: string };
type Counts = {
  orders_new: number; paid_new?: number; talk_new?: number; reviews_new: number; partners_new: number; awaiting_approval: number;
  latest: Record<TabKey, number>; version: Record<TabKey, string>;
};
type OrderStats = { newToday: number; awaitingVerification: number; awaitingApproval: number; convertedThisMonth: number; markets: string[]; packages: string[]; statusCounts: Record<string, number> };
type ReviewStats = { newToday: number; inReview: number; sentThisMonth: number; convertedThisMonth: number; statusCounts: Record<string, number> };
type PartnerStats = { newThisWeek: number; inTrial: number; active: number; total: number; countries: string[]; statusCounts: Record<string, number> };

// ── Constants & formatting ────────────────────────────────────────────────────

const BASE = "/api/website-requests";
const TAB_LABELS: Record<TabKey, string> = { orders: "Orders", reviews: "Free CV Reviews", partners: "Partners" };

const STATUS_FILTERS: Record<TabKey, Array<{ value: string; label: string }>> = {
  orders: [
    { value: "paid", label: "Paid" },
    { value: "paid_placed", label: "Placed" },
    { value: "paid_rejected", label: "Rejected" },
    { value: "talk_contacted", label: "Contacted" },
    { value: "talk_placed", label: "Placed" },
    { value: "talk_rejected", label: "Not interested" },
    { value: "paid_all", label: "Paid (all)" },
    { value: "talk", label: "Talk first" },
    { value: "talk_all", label: "Talk first (all)" },
    { value: "pending", label: "All pending" },
    { value: "paid_full", label: "Paid 100%" },
    { value: "paid_half", label: "Paid 50%" },
    { value: "talk_first", label: "Talk first" },
    { value: "awaiting_approval", label: "Awaiting approval" },
    { value: "placed", label: "Placed" },
    { value: "rejected", label: "Rejected" },
    { value: "all", label: "All" },
  ],
  reviews: [
    { value: "new", label: "New" },
    { value: "in_review", label: "In review" },
    { value: "sent", label: "Sent" },
    { value: "converted", label: "Converted" },
    { value: "rejected", label: "Rejected" },
    { value: "all", label: "All" },
  ],
  partners: [
    { value: "open", label: "Open" },
    { value: "call", label: "Call scheduled" },
    { value: "closed", label: "Closed" },
    { value: "new", label: "New" },
    { value: "contacted", label: "Contacted" },
    { value: "trial", label: "Trial" },
    { value: "active", label: "Active" },
    { value: "lost", label: "Lost" },
    { value: "all", label: "All" },
  ],
};
const DEFAULT_STATUS: Record<TabKey, string> = { orders: "paid", reviews: "new", partners: "new" };
type View = "paid" | "talk" | "partners";
type LastChange = { action: string; to: string | null; by: string | null; at: string };
// Row statuses per view. Old DB values are mapped here; nothing is rewritten.
const ROW_STATUSES: Record<View, Array<{ key: string; label: string; filter: string }>> = {
  paid: [{ key: "new", label: "New", filter: "paid" }, { key: "placed", label: "Placed", filter: "paid_placed" }, { key: "rejected", label: "Rejected", filter: "paid_rejected" }],
  talk: [{ key: "new", label: "New", filter: "talk" }, { key: "contacted", label: "Contacted", filter: "talk_contacted" }, { key: "placed", label: "Placed", filter: "talk_placed" }, { key: "rejected", label: "Not interested", filter: "talk_rejected" }],
  partners: [{ key: "new", label: "New", filter: "new" }, { key: "call", label: "Call scheduled", filter: "call" }, { key: "closed", label: "Closed", filter: "closed" }, { key: "lost", label: "Not interested", filter: "lost" }],
};
const ALL_FILTER: Record<View, string> = { paid: "paid_all", talk: "talk_all", partners: "all" };
const PARTNER_DB: Record<string, string> = { new: "new", call: "contacted", closed: "active", lost: "lost" };
const orderRowStatus = (r: { status: string; crm_order_id: number | string | null }) =>
  r.crm_order_id || r.status === "converted" || r.status === "paid" ? "placed" : r.status === "rejected" ? "rejected" : r.status === "contacted" ? "contacted" : "new";
const partnerRowStatus = (st: string) => (st === "contacted" || st === "trial" ? "call" : st === "active" ? "closed" : st === "lost" ? "lost" : "new");
const ACTION_VERB: Record<string, string> = { placed: "Placed", approved_and_placed: "Placed", converted: "Placed", rejected: "Rejected", declined: "Declined", contacted: "Contacted", reopened: "Reopened", sent_for_approval: "Sent for approval" };
function whoLine(lc: LastChange | null | undefined, statusLabel: string) {
  if (!lc) return null;
  const verb = lc.action === "status_changed" ? statusLabel : ACTION_VERB[lc.action] ?? statusLabel;
  return `${verb} by ${(lc.by || "someone").split(" ")[0]} · ${format(new Date(lc.at), "d MMM, HH:mm")}`;
}
const VIEW_LABELS: Record<View, string> = { paid: "Paid", talk: "Talk first", partners: "Partners" };
const balanceOf = (r: WebsiteOrder) => Math.max(0, (r.total || 0) - paidToday(r));
const TABLE_TEXT: Record<TabKey, { title: string; subtitle: string; search: string }> = {
  orders: { title: "Website Orders", subtitle: "Checkout submissions from pixelycareers.com", search: "Search name, WhatsApp, email or transaction ID..." },
  reviews: { title: "Free CV Reviews", subtitle: "Free CV review requests from the website", search: "Search name, WhatsApp, email or role..." },
  partners: { title: "Agency Partners", subtitle: "Submissions from the For Agencies page", search: "Search organization, contact, WhatsApp..." },
};

const REJECT_REASONS = [
  { value: "fake_screenshot", label: "Fake screenshot" },
  { value: "duplicate", label: "Duplicate" },
  { value: "test", label: "Test" },
  { value: "not_interested", label: "Not interested" },
  { value: "no_response", label: "No response" },
  { value: "other", label: "Other" },
];
const REJECT_LABEL: Record<string, string> = Object.fromEntries(REJECT_REASONS.map(r => [r.value, r.label]));

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  cart: { label: "Cart", className: "border-slate-700 bg-slate-800/60 text-slate-400" },
  abandoned: { label: "Abandoned", className: "border-slate-700 bg-slate-800/60 text-slate-400" },
  new: { label: "New", className: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200" },
  payment_submitted: { label: "Needs verification", className: "border-amber-400/30 bg-amber-400/10 text-amber-200" },
  pending_approval: { label: "Awaiting approval", className: "border-orange-400/30 bg-orange-400/10 text-orange-200" },
  contacted: { label: "Contacted", className: "border-violet-400/30 bg-violet-400/10 text-violet-200" },
  converted: { label: "Converted", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" },
  paid: { label: "Paid", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" },
  rejected: { label: "Rejected", className: "border-rose-400/30 bg-rose-400/10 text-rose-200" },
  in_review: { label: "In review", className: "border-blue-400/30 bg-blue-400/10 text-blue-200" },
  sent: { label: "Sent", className: "border-violet-400/30 bg-violet-400/10 text-violet-200" },
  trial: { label: "Trial", className: "border-amber-400/30 bg-amber-400/10 text-amber-200" },
  active: { label: "Active", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" },
  lost: { label: "Lost", className: "border-slate-700 bg-slate-800/60 text-slate-400" },
  in_progress: { label: "In progress", className: "border-blue-400/30 bg-blue-400/10 text-blue-200" },
  delivered: { label: "Delivered", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" },
  refunded: { label: "Refunded", className: "border-rose-400/30 bg-rose-400/10 text-rose-200" },
  cancelled: { label: "Cancelled", className: "border-rose-400/30 bg-rose-400/10 text-rose-200" },
};

const ATS_SERVICES = ["ATS CV", "Cover Letter (Professional)", "LinkedIn Profile"];
const ICP_SERVICES = [...ATS_SERVICES, "Indeed Profile", "Naukri Gulf Profile", "Bio Statement", "Contact Card"];
const EXEC_SERVICES = [...ICP_SERVICES, "Infographics Resume", "Interview Prep Guide"];

type PackageDef = { label: string; orderType: OrderServiceType; services: string[]; revisions: string; support: string };
const ATS_DEF: PackageDef = { label: "ATS Career", orderType: "documentation", services: ATS_SERVICES, revisions: "3", support: "1_month" };
const ICP_DEF: PackageDef = { label: "International Career Pro", orderType: "documentation", services: ICP_SERVICES, revisions: "3", support: "3_months" };
const EXEC_DEF: PackageDef = { label: "Executive Career Branding", orderType: "documentation", services: EXEC_SERVICES, revisions: "4", support: "6_months" };
/** ONE map: website package key → label + CRM order defaults. */
const PACKAGE_MAP: Record<string, PackageDef> = {
  executive_bundle: { ...EXEC_DEF, label: "11.11 Bundle" },
  executive: EXEC_DEF, executive_career: EXEC_DEF, executive_career_branding: EXEC_DEF,
  pro: ICP_DEF, "international-pro": ICP_DEF, international_pro: ICP_DEF, international: ICP_DEF, international_career_pro: ICP_DEF, professional: ICP_DEF,
  ats: ATS_DEF, ats_career: ATS_DEF, starter: ATS_DEF,
  portfolio: { label: "Portfolio Website", orderType: "portfolio_website", services: [], revisions: "3", support: "1_month" },
  portfolio_website: { label: "Portfolio Website", orderType: "portfolio_website", services: [], revisions: "3", support: "1_month" },
  resume_distribution: { label: "Resume Distribution", orderType: "resume_distribution", services: [], revisions: "", support: "1_month" },
  distribution: { label: "Resume Distribution", orderType: "resume_distribution", services: [], revisions: "", support: "1_month" },
};

/** Website add-on id/name keywords → CRM service names. Unknown add-ons keep their website name. */
const ADDON_RULES: Array<[RegExp, string]> = [
  [/linkedin.*(content|post)/i, "LinkedIn Content Pack (10 Posts)"],
  [/linkedin/i, "LinkedIn Profile"],
  [/europass.*cover|cover.*europass/i, "Cover Letter (Europass)"],
  [/cover/i, "Cover Letter (Professional)"],
  [/europass/i, "Europass CV"],
  [/premium.*ats/i, "Premium ATS CV"],
  [/infographic/i, "Infographics Resume"],
  [/interview/i, "Interview Prep Guide"],
  [/sop|statement of purpose/i, "SOP Writing"],
  [/recommend/i, "Recommendation Letter"],
  [/motivation/i, "Motivation Letter"],
  [/indeed/i, "Indeed Profile"],
  [/naukri/i, "Naukri Gulf Profile"],
  [/bio/i, "Bio Statement"],
  [/contact.?card/i, "Contact Card"],
  [/portfolio|website/i, "Portfolio Website"],
];

const numberFmt = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });
const packageLabel = (key: string) => PACKAGE_MAP[key?.toLowerCase()]?.label ?? key?.replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
/** "Rs 19,000" for PKR; "USD 120" otherwise. */
const money = (amount: number | string | null | undefined, currency = "PKR") => {
  const n = numberFmt.format(Math.round(Number(amount || 0)));
  return (currency || "PKR").toUpperCase() === "PKR" ? `Rs ${n}` : `${currency.toUpperCase()} ${n}`;
};
const waLink = (phone: string | null) => `https://wa.me/${(phone || "").replace(/[^0-9]/g, "")}`;
const safeUrl = (url: string | null | undefined) => (url && (/^https?:\/\//i.test(url) || /^\/api\/files\/\d+$/.test(url)) ? url : null);
const isPkr = (r: WebsiteOrder) => (r.currency || "").toUpperCase() === "PKR";
const ageDays = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000;

function timeAgo(iso: string) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return format(new Date(iso), "MMM d, yyyy");
}

// ── Orders tab helpers (payment choice + market are mapped in code) ──
type PayKind = "full" | "half" | "talk";
function payKind(r: Pick<WebsiteOrder, "pay_choice">): PayKind {
  const v = (r.pay_choice || "").toLowerCase();
  if (["now", "full", "paid_full", "100"].includes(v)) return "full";
  if (["half", "advance", "partial", "50", "paid_half"].includes(v)) return "half";
  return "talk";
}
/** Rupees the client paid today: recorded amount, else 100% / 50% of the total, else 0. */
function paidToday(r: Pick<WebsiteOrder, "pay_choice" | "paid_amount" | "total">): number {
  if (r.paid_amount != null && Number(r.paid_amount) > 0) return Number(r.paid_amount);
  const k = payKind(r);
  return k === "full" ? Number(r.total || 0) : k === "half" ? Math.round(Number(r.total || 0) / 2) : 0;
}
const MARKETS: Record<string, { flag: string; name: string }> = {
  pk: { flag: "🇵🇰", name: "Pakistan" }, us: { flag: "🇺🇸", name: "USA" }, uk: { flag: "🇬🇧", name: "UK" }, gb: { flag: "🇬🇧", name: "UK" },
  ae: { flag: "🇦🇪", name: "UAE" }, sa: { flag: "🇸🇦", name: "KSA" },
};
function landingPath(r: Pick<WebsiteOrder, "landing_page">): string {
  try { return r.landing_page ? new URL(r.landing_page, "https://pixelycareers.com").pathname : "—"; } catch { return r.landing_page || "—"; }
}
/** /pk → Pakistan, /uk → UK, /ae → UAE, /sa → KSA, "/" → USA; falls back to the stored market. */
function marketOf(r: Pick<WebsiteOrder, "landing_page" | "market">) {
  const path = landingPath(r);
  const seg = path.split("/").filter(Boolean)[0]?.toLowerCase();
  if (seg && MARKETS[seg]) return MARKETS[seg];
  if (path !== "—" && !(seg && seg.length === 2)) return MARKETS.us;
  return MARKETS[(r.market || "").toLowerCase()] ?? { flag: "🌐", name: (r.market || "—").toUpperCase() };
}
function sourceText(r: Pick<WebsiteOrder, "utm_campaign" | "utm_medium" | "utm_content" | "utm_source" | "referrer">) {
  const parts = [r.utm_campaign, r.utm_medium, r.utm_content].filter(Boolean);
  if (parts.length) return parts.join(" › ");
  const src = (r.utm_source || "").toLowerCase();
  if (src) return /organic|seo|google/.test(src) ? "Organic" : r.utm_source!;
  if (r.referrer && !/pixelycareers\.com/i.test(r.referrer)) return "Referral";
  return "Direct";
}
function PayBadge({ r }: { r: WebsiteOrder }) {
  const k = payKind(r);
  const cls = k === "full" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : k === "half" ? "border-blue-500/30 bg-blue-500/10 text-blue-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", cls)}>{k === "full" ? "Paid 100%" : k === "half" ? "Paid 50%" : "Talk first"}</span>;
}
function requestStatus(r: WebsiteOrder): { label: string; cls: string } {
  if (r.crm_order_id || r.status === "converted" || r.status === "paid") return { label: "Placed", cls: "text-emerald-300" };
  if (r.status === "rejected") return { label: "Rejected", cls: "text-rose-300" };
  if (r.status === "pending_approval") return { label: "Awaiting approval", cls: "text-orange-300" };
  if (r.status === "contacted") return { label: "Contacted", cls: "text-cyan-300" };
  return { label: "New", cls: "text-slate-200" };
}
const isUnhandled = (r: WebsiteOrder) =>
  !r.crm_order_id && ["new", "payment_submitted"].includes(r.status) && Date.now() - new Date(r.created_at).getTime() > 15 * 60_000;

function buildPrefill(r: WebsiteOrder, platformNames: string[]): { orderType: OrderServiceType; prefill: WebsiteOrderPrefill } {
  const pkg = PACKAGE_MAP[r.package?.toLowerCase()];
  const orderType: OrderServiceType = pkg?.orderType ?? "documentation";
  const merged = new Map<string, number>();
  for (const name of pkg?.services ?? []) merged.set(name, 1);
  const addons = r.addons ?? [];
  for (const addon of addons) {
    const haystack = `${addon.id ?? ""} ${addon.name ?? ""}`;
    const mapped = ADDON_RULES.find(([re]) => re.test(haystack))?.[1] ?? addon.name ?? addon.id ?? "Add-on";
    merged.set(mapped, (merged.get(mapped) ?? 0) + Math.max(1, addon.qty ?? 1));
  }
  const services = Array.from(merged.entries()).map(([serviceType, quantity]) => ({ serviceType, quantity, instructions: "" }));

  const pkr = isPkr(r);
  const total = pkr ? String(Math.round(r.total || 0)) : "";
  const noteLines = [
    `Website request — ${packageLabel(r.package)}`,
    addons.length ? `Add-ons: ${addons.map(a => `${a.name ?? a.id} ×${a.qty ?? 1} (${money(a.price, r.currency)})`).join(", ")}` : null,
    r.same_day ? "Same-day delivery requested" : null,
    r.target_country || r.target_role ? `Target: ${[r.target_role, r.target_country].filter(Boolean).join(" · ")}` : null,
    r.cv_url ? `Current CV: ${r.cv_url}` : null,
    r.notes ? `Customer notes: ${r.notes}` : null,
    r.approval_note ? `Support note: ${r.approval_note}` : null,
  ].filter(Boolean);

  const src = `${r.utm_source ?? ""}`.toLowerCase();
  const metaPlatform = platformNames.find(n => /meta/i.test(n));
  const platform = /fb|facebook|ig|instagram|meta/.test(src) && metaPlatform ? metaPlatform : "";
  // Pay-later requests start with nothing received; the admin can edit before placing.
  const received = pkr ? String(paidToday(r)) : "";

  return {
    orderType,
    prefill: {
      requestId: r.id,
      approve: r.status === "pending_approval",
      clientName: r.name ?? "",
      clientPhone: r.whatsapp ?? "",
      clientEmail: r.email ?? "",
      clientType: (r.market ?? "").toLowerCase() === "pk" || pkr ? "national" : "international",
      services,
      totalBill: total,
      amountReceived: received,
      paymentMethod: r.payment_method ?? "",
      transactionId: r.transaction_id ?? "",
      screenshotUrl: r.payment_screenshot_url ?? "",
      notes: noteLines.join("\n"),
      numberOfRevisions: pkg?.revisions ?? "",
      supportPeriod: pkg?.support ?? "",
      platform,
      campaign: platform ? r.utm_campaign ?? "" : "",
      adSet: platform ? r.utm_medium ?? "" : "",
      creative: "",
      totalHint: pkr ? undefined : `Website total was ${money(r.total, r.currency)} — enter the PKR amount.`,
    },
  };
}

/** Same payload the prefilled Create Order form would submit, for one-click placing. */
function buildPlaceBody(r: WebsiteOrder, platformNames: string[]) {
  const { orderType, prefill } = buildPrefill(r, platformNames);
  const totalPrice = Math.round(parseFloat(prefill.totalBill || "0") * 100);
  const amountReceived = Math.round(parseFloat(prefill.amountReceived || "0") * 100);
  return {
    totalPrice,
    amountReceived,
    body: {
      clientName: prefill.clientName.trim() || "Website customer",
      clientPhone: prefill.clientPhone.trim(),
      clientEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prefill.clientEmail.trim()) ? prefill.clientEmail.trim() : null,
      clientType: prefill.clientType,
      orderType,
      assignedToId: null,
      totalPrice,
      amountReceived,
      paymentMethod: prefill.paymentMethod || null,
      transactionId: prefill.transactionId || null,
      screenshotUrl: safeUrl(prefill.screenshotUrl),
      numberOfRevisions: prefill.numberOfRevisions ? parseInt(prefill.numberOfRevisions) : null,
      supportPeriod: prefill.supportPeriod || null,
      platform: prefill.platform || null,
      campaign: prefill.campaign || null,
      adSet: prefill.adSet || null,
      creative: null,
      notes: prefill.notes || null,
      services: orderType === "documentation" ? prefill.services.map(s => ({ serviceType: s.serviceType, quantity: s.quantity, instructions: null })) : [],
    },
  };
}

function reviewContactPrefill(r: CvReview): ContactPrefill {
  const countries = r.target_countries?.length ? r.target_countries.join(", ") : r.target_country;
  return {
    clientName: r.name ?? "",
    clientPhone: r.whatsapp ?? "",
    clientType: (r.market ?? "").toLowerCase() === "pk" || !r.market ? "national" : "international",
    notes: [
      "From free CV review (website)",
      r.target_role ? `Target role: ${r.target_role}` : null,
      countries ? `Target countries: ${countries}` : null,
      r.cv_url ? `CV: ${r.cv_url}` : null,
      r.notes ? `Customer notes: ${r.notes}` : null,
    ].filter(Boolean).join("\n"),
  };
}

// ── Small components ──────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { label: status.replace(/_/g, " "), className: "border-slate-700 bg-slate-800/60 text-slate-300" };
  return <Badge variant="outline" className={`whitespace-nowrap font-medium ${style.className}`} data-testid={`status-${status}`}>{style.label}</Badge>;
}



function MetaBadge({ status, error, busy, onRetry }: { status: MetaStatus | null; error?: string | null; busy?: boolean; onRetry?: () => void }) {
  if (!status) return <span className="text-slate-600">—</span>;
  if (status === "sent") return <Badge variant="outline" className="whitespace-nowrap border-emerald-400/30 bg-emerald-400/10 text-emerald-200" data-testid="meta-sent">Sent ✓</Badge>;
  if (status === "test") return <Badge variant="outline" className="whitespace-nowrap border-slate-600 bg-slate-800/70 text-slate-300" data-testid="meta-test">Test ✓</Badge>;
  if (status === "pending" || busy) return <span className="inline-flex items-center gap-1 text-xs text-slate-400" data-testid="meta-pending"><Loader2 className="h-3 w-3 animate-spin" />Sending</span>;
  return (
    <button
      type="button"
      title={error ? `Meta error: ${error}` : "Meta rejected the event"}
      onClick={e => { e.stopPropagation(); onRetry?.(); }}
      disabled={!onRetry}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-xs font-medium text-rose-200 enabled:hover:bg-rose-400/20"
      data-testid="meta-failed"
    >
      Failed<RefreshCw className="h-3 w-3" />Retry
    </button>
  );
}

function CustomerCell({ id, name, whatsapp, createdAt, sub }: { id: string; name: string | null; whatsapp: string | null; createdAt: string; sub?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-white">{name || <span className="font-normal text-slate-500">No name</span>}</p>
      {sub && <p className="truncate text-xs text-slate-400">{sub}</p>}
      {whatsapp ? (
        <a href={waLink(whatsapp)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex max-w-full items-center gap-1 truncate text-xs text-emerald-300 hover:underline" data-testid={`link-whatsapp-${id}`}>
          <MessageCircle className="h-3 w-3 shrink-0" />{whatsapp}
        </a>
      ) : <p className="text-xs text-slate-600">No WhatsApp</p>}
      <p className="text-xs text-slate-500" title={format(new Date(createdAt), "MMM dd, yyyy · h:mm a")}>{timeAgo(createdAt)}</p>
    </div>
  );
}

function RowMenu({ children, disabled, testId }: { children: React.ReactNode; disabled?: boolean; testId?: string }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-slate-400 hover:text-white" disabled={disabled} onClick={e => e.stopPropagation()} aria-label="More actions" data-testid={testId}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 border-slate-800 bg-slate-900 text-slate-200" onClick={e => e.stopPropagation()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type DesignerLoad = { id: number; name: string; active: number };
function PlacePopover({ r, busy, label, platformNames, onConfirm, onEdit }: { r: WebsiteOrder; busy: boolean; label: string; platformNames: string[]; onConfirm: (designerId: number | null) => void; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"choose" | "now">("choose");
  const { amountReceived, totalPrice } = buildPlaceBody(r, platformNames);
  const { data: designers = [] } = useQuery<DesignerLoad[]>({ queryKey: ["/api/designers/workload"], enabled: open, staleTime: 60_000 });
  const lowest = useMemo(() => [...designers].sort((a, b) => a.active - b.active)[0]?.id ?? null, [designers]);
  const [designerId, setDesignerId] = useState<number | null>(null);
  useEffect(() => { if (open && designerId === null && lowest !== null) setDesignerId(lowest); }, [open, lowest, designerId]);
  const days = (DEFAULT_PACKAGE_DELIVERY_DAYS as Record<string, number>)[(r.package || "").toLowerCase().replace(/-/g, "_")] ?? null;
  const canOneClick = isPkr(r) && totalPrice > 0;
  const old = ageDays(r.created_at) > 6 && amountReceived > 0;
  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setMode("choose"); }}>
      <PopoverTrigger asChild>
        <Button size="sm" className="h-8 min-w-0 bg-primary px-2.5" disabled={busy} onClick={e => e.stopPropagation()} data-testid={`button-place-${r.id}`}>
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 shrink-0 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{busy ? "Placing..." : label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 border-slate-800 bg-slate-900 text-left" onClick={e => e.stopPropagation()} data-testid="place-modal">
        {mode === "choose" ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-white">{label}</p>
            <button type="button" disabled={!canOneClick} onClick={() => setMode("now")} className="w-full rounded-lg border border-slate-700 p-3 text-left hover:border-primary disabled:opacity-50" data-testid={`button-place-now-${r.id}`}>
              <p className="text-sm font-medium text-white">Place order now</p><p className="text-xs text-slate-400">Pick the designer and confirm.</p>
            </button>
            <button type="button" onClick={() => { setOpen(false); onEdit(); }} className="w-full rounded-lg border border-slate-700 p-3 text-left hover:border-primary" data-testid={`button-edit-before-placing-${r.id}`}>
              <p className="text-sm font-medium text-white">Edit before placing</p><p className="text-xs text-slate-400">Open the full order form, prefilled.</p>
            </button>
            {!canOneClick && <p className="text-xs text-amber-300">Non-PKR total — use “Edit before placing” to enter the PKR amount.</p>}
          </div>
        ) : (
          <div>
            <p className="text-sm font-semibold text-white">Place order now</p>
            <div className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-3 text-slate-400"><span>Package</span><span className="text-right text-white">{packageLabel(r.package)}</span></div>
              <div className="flex justify-between text-slate-400"><span>Total</span><span className="text-white">{money(totalPrice / 100)}</span></div>
              <div className="flex justify-between text-slate-400"><span>Received</span><span className="text-white">{money(amountReceived / 100)}</span></div>
              <div className="flex justify-between text-slate-400"><span>Balance</span><span className="text-white">{money(Math.max(0, totalPrice - amountReceived) / 100)}</span></div>
              <div className="flex justify-between text-slate-400"><span>Due</span><span className="text-white">{days ? format(new Date(Date.now() + days * 86_400_000), "MMM d") + ` (${days} days)` : "Auto from package"}</span></div>
            </div>
            <Label className="mt-3 block text-xs text-slate-400">Designer</Label>
            <Select value={designerId ? String(designerId) : ""} onValueChange={v => setDesignerId(Number(v))}>
              <SelectTrigger className="mt-1 h-9" data-testid="select-place-designer"><SelectValue placeholder="Choose designer" /></SelectTrigger>
              <SelectContent>{designers.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name} · {d.active} active{d.id === lowest ? " (lowest)" : ""}</SelectItem>)}</SelectContent>
            </Select>
            {amountReceived === 0 && <p className="mt-2 text-xs text-slate-400">No payment recorded — no Meta Purchase.</p>}
            {old && <p className="mt-2 flex gap-1.5 text-xs text-amber-300" data-testid="warning-meta-age"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Submitted {Math.floor(ageDays(r.created_at))} days ago — Meta may not attribute this Purchase to the ad (7-day window).</p>}
            <div className="mt-3 flex items-center justify-between gap-2">
              <button type="button" className="text-xs text-slate-400 hover:underline" onClick={() => setMode("choose")}>Back</button>
              <Button size="sm" className="h-8 bg-primary" disabled={busy || !designerId} onClick={() => { setOpen(false); setMode("choose"); onConfirm(designerId); }} data-testid={`button-confirm-place-${r.id}`}>Confirm</Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SendForApprovalPopover({ busy, onSend }: { busy: boolean; onSend: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" className="h-8 min-w-0 bg-primary px-2.5" disabled={busy} onClick={e => e.stopPropagation()} data-testid="button-send-for-approval">
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 shrink-0 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{busy ? "Sending..." : "Send for approval"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 border-slate-800 bg-slate-900" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-semibold text-white">Send to admin for approval</p>
        <Textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000} className="mt-2 resize-none border-slate-800 bg-slate-950 text-sm text-white" placeholder="Optional note for the admin" data-testid="input-approval-note" />
        <div className="mt-3 flex justify-end">
          <Button size="sm" className="h-8 bg-primary" disabled={busy} onClick={() => { setOpen(false); onSend(note.trim()); setNote(""); }} data-testid="button-confirm-send-for-approval">Send</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PrimaryButton({ busy, icon: Icon, children, onClick, testId }: { busy: boolean; icon: React.ElementType; children: React.ReactNode; onClick: () => void; testId?: string }) {
  return (
    <Button size="sm" className="h-8 min-w-0 bg-primary px-2.5" disabled={busy} onClick={e => { e.stopPropagation(); onClick(); }} data-testid={testId}>
      {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 shrink-0 animate-spin" /> : <Icon className="mr-1.5 h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{children}</span>
    </Button>
  );
}

function ViewOrderLink({ orderId, testId }: { orderId: number; testId?: string }) {
  return (
    <Button asChild size="sm" variant="ghost" className="h-8 px-2 text-cyan-300 hover:text-cyan-200" onClick={e => e.stopPropagation()} data-testid={testId}>
      <Link href={`/orders?order=${orderId}`}>View order <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
    </Button>
  );
}

function SkeletonRows({ cols }: { cols: number }) {
  return <>{Array.from({ length: 6 }).map((_, i) => (
    <TableRow key={i} className="border-slate-800">
      {Array.from({ length: cols }).map((__, j) => (
        <TableCell key={j}><div className={cn("h-4 animate-pulse rounded bg-slate-800/70", j === 0 ? "w-3/4" : "w-1/2")} /></TableCell>
      ))}
    </TableRow>
  ))}</>;
}

const activityLabel = (a: Activity) => {
  const d = a.details ?? {};
  const reason = `${REJECT_LABEL[d.reason] ?? d.reason ?? ""}${d.note ? ` · ${d.note}` : ""}`;
  switch (a.action) {
    case "contacted": return "Marked as contacted";
    case "rejected": return `Rejected — ${reason}`;
    case "declined": return `Declined — ${reason}`;
    case "sent_for_approval": return `Sent for approval${d.note ? ` — "${d.note}"` : ""}`;
    case "placed":
    case "converted":
    case "approved_and_placed":
      return `${a.action === "approved_and_placed" ? "Approved & placed" : a.action === "converted" ? "Converted to" : "Placed"} CRM order${d.orderNumber ? ` ${d.orderNumber}` : ""}${d.amountReceived ? ` · received Rs ${numberFmt.format(Number(d.amountReceived))}` : ""}`;
    case "notes_updated": return "Updated internal notes";
    case "meta_retry": return "Retried Meta Purchase";
    case "review_started": return "Started review";
    case "review_sent": return "Marked review as sent";
    case "reopened": return "Reopened";
    case "status_changed": return `Status: ${STATUS_STYLES[d.from]?.label ?? d.from} → ${STATUS_STYLES[d.to]?.label ?? d.to}`;
    default: return a.action.replace(/_/g, " ");
  }
};

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-950 p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h4>
      {children}
    </section>
  );
}
function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <div className={wide ? "col-span-2" : undefined}><p className="text-xs text-slate-500">{label}</p><div className="mt-1 break-words text-sm text-white">{children || "—"}</div></div>;
}
function ActivityList({ items }: { items: Activity[] }) {
  if (items.length === 0) return <p className="text-sm text-slate-500">No CRM activity yet.</p>;
  return (
    <ol className="space-y-3">
      {items.map(a => (
        <li key={a.id} className="flex gap-3 text-sm" data-testid={`activity-${a.action}`}>
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <div><p className="text-slate-200">{activityLabel(a)}</p><p className="text-xs text-slate-500">{a.actor_name ?? "System"}{a.actor_role ? ` (${a.actor_role})` : ""} · {format(new Date(a.created_at), "MMM dd, yyyy · h:mm a")}</p></div>
        </li>
      ))}
    </ol>
  );
}
function NotesEditor({ value, busy, onSave, testId }: { value: string | null; busy: boolean; onSave: (v: string) => void; testId: string }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  return (
    <>
      <Textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} className="resize-none " placeholder="Visible to the CRM team only..." data-testid={`input-${testId}`} />
      <div className="flex justify-end">
        <Button size="sm" variant="outline" disabled={busy || draft === (value ?? "")} onClick={() => onSave(draft)} data-testid={`button-save-${testId}`}>Save notes</Button>
      </div>
    </>
  );
}

// ── URL state ─────────────────────────────────────────────────────────────────

const FILTER_KEYS = ["status", "q", "from", "to", "market", "package", "country", "page"] as const;
type Filters = { tab: TabKey; status: string; q: string; from: string; to: string; market: string; package: string; country: string; page: number };

function readFilters(search: string): Filters {
  const p = new URLSearchParams(search);
  const tab = (["orders", "reviews", "partners"].includes(p.get("tab") || "") ? p.get("tab") : "orders") as TabKey;
  const status = p.get("status") || "";
  return {
    tab,
    status: STATUS_FILTERS[tab].some(s => s.value === status) ? status : "",
    q: p.get("q") || "",
    from: p.get("from") || "",
    to: p.get("to") || "",
    market: p.get("market") || "all",
    package: p.get("package") || "all",
    country: p.get("country") || "all",
    page: Math.max(1, parseInt(p.get("page") || "1") || 1),
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WebsiteRequestsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = user?.role === "admin" || user?.role === "support";
  const isAdmin = user?.role === "admin";
  const [, navigate] = useLocation();
  const search = useSearch();
  const filters = useMemo(() => readFilters(search), [search]);
  const { tab } = filters;
  const status = filters.status || DEFAULT_STATUS[tab];

  const setFilters = (patch: Partial<Filters>, opts: { resetPage?: boolean } = { resetPage: true }) => {
    const next: Filters = { ...filters, ...patch };
    if (opts.resetPage && patch.page === undefined) next.page = 1;
    const p = new URLSearchParams();
    p.set("tab", next.tab);
    for (const key of FILTER_KEYS) {
      const v = String(next[key] ?? "");
      if (!v || v === "all" || (key === "page" && v === "1")) continue;
      p.set(key, v);
    }
    navigate(`/website-requests?${p.toString()}`, { replace: true });
  };
  const view: View = tab === "partners" ? "partners" : status.startsWith("talk") ? "talk" : "paid";
  const switchView = (v: View) => {
    if (v === view) return;
    setSearchInput("");
    navigate(`/website-requests?tab=${v === "partners" ? "partners" : "orders"}${v === "talk" ? "&status=talk" : ""}`, { replace: false });
  };

  // Debounced search (300ms) → URL.
  const [searchInput, setSearchInput] = useState(filters.q);
  useEffect(() => { setSearchInput(filters.q); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (searchInput.trim() === filters.q) return;
    const t = setTimeout(() => setFilters({ q: searchInput.trim() }), 300);
    return () => clearTimeout(t);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const queryString = useMemo(() => {
    // Search covers every status of the tab.
    const p = new URLSearchParams({ status: filters.q ? ALL_FILTER[view] : status, page: String(filters.page) });
    if (filters.q) p.set("q", filters.q);
    if (filters.from) p.set("from", new Date(`${filters.from}T00:00:00`).toISOString());
    if (filters.to) p.set("to", new Date(`${filters.to}T23:59:59.999`).toISOString());
    if (tab === "orders" && filters.market !== "all") p.set("market", filters.market);
    if (tab === "orders" && filters.package !== "all") p.set("package", filters.package);
    if (tab === "partners" && filters.country !== "all") p.set("country", filters.country);
    return p.toString();
  }, [tab, view, status, filters]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [advanceTarget, setAdvanceTarget] = useState<WebsiteOrder | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ kind: "order" | "review" | "partner"; id: string; name: string | null; awaiting: boolean; amount?: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [editTarget, setEditTarget] = useState<WebsiteOrder | null>(null);
  const [editType, setEditType] = useState<OrderServiceType | null>(null);
  const [convertTarget, setConvertTarget] = useState<CvReview | null>(null);
  const [convertType, setConvertType] = useState<OrderServiceType | null>(null);
  const [noteTarget, setNoteTarget] = useState<Partner | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  useEffect(() => { setSelectedId(null); }, [tab]);

  // ── Data ──
  const { data: counts } = useQuery<Counts>({
    queryKey: [`${BASE}/counts`],
    enabled: allowed,
  });


  const listKey = [`${BASE}/${tab}`, "list", queryString] as const;
  const list = useQuery<ListPage<any>>({
    queryKey: listKey,
    queryFn: async () => {
      const res = await fetch(`${BASE}/${tab}?${queryString}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    enabled: allowed,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    // While a Meta Purchase is sending, check back every 3s for the result.
    refetchInterval: q => (tab === "orders" && (q.state.data?.rows ?? []).some((r: WebsiteOrder) => r.meta_status === "pending") ? 3_000 : false),
  });
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / (list.data?.pageSize || 50)));

  const detailKind = tab;
  const { data: detail, isLoading: detailLoading } = useQuery<any>({
    queryKey: [`${BASE}/${detailKind}`, selectedId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/${detailKind}/${selectedId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    enabled: allowed && !!selectedId,
    staleTime: 15_000,
    refetchInterval: q => (q.state.data?.meta_status === "pending" ? 3_000 : false),
  });

  const { data: teamMembers } = useQuery<User[]>({ queryKey: ["/api/users"], enabled: allowed, staleTime: 5 * 60 * 1000 });
  const { data: designerAssignments } = useQuery<SupportDesignerAssignment[]>({ queryKey: ["/api/designer-assignments"], enabled: allowed, staleTime: 5 * 60 * 1000 });
  const { data: platforms = [] } = useQuery<PlatformCatalogItem[]>({ queryKey: ["/api/platforms-catalog"], enabled: allowed, staleTime: 5 * 60 * 1000 });
  const platformNames = useMemo(() => platforms.filter(p => p.isActive).map(p => p.name), [platforms]);
  const availableDesigners = useMemo(() => {
    const all = teamMembers?.filter(u => u.role === "designer" && u.isActive) || [];
    if (user?.role === "support") {
      const ids = (designerAssignments || []).map(a => a.designerUserId);
      return all.filter(d => ids.includes(d.id));
    }
    return all;
  }, [teamMembers, designerAssignments, user?.role]);

  const refreshTab = (t: TabKey) => queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith(`${BASE}/${t}`) });
  const refreshCounts = () => queryClient.invalidateQueries({ queryKey: [`${BASE}/counts`] });


  // Someone else changed data → refetch that tab; new submissions → toast.
  const lastCounts = useRef<Counts | null>(null);
  useEffect(() => {
    if (!counts) return;
    const prev = lastCounts.current;
    lastCounts.current = counts;
    if (!prev) return;
    (["orders", "reviews", "partners"] as TabKey[]).forEach(t => {
      if (prev.version[t] !== counts.version[t]) refreshTab(t);
      if (counts.latest[t] > prev.latest[t]) {
        toast({
          title: t === "orders" ? "New website order" : t === "reviews" ? "New free CV review" : "New agency partner",
          description: "Just arrived from pixelycareers.com.",
        });
      }
    });
  }, [counts]); // eslint-disable-line react-hooks/exhaustive-deps

  const setBusy = (id: string, busy: boolean) => setBusyIds(prev => {
    const next = new Set(prev);
    if (busy) next.add(id); else next.delete(id);
    return next;
  });

  /** Patch one row in every cached list page + its detail (optimistic / server result). */
  const patchRow = (t: TabKey, id: string, patch: Record<string, unknown>) => {
    queryClient.setQueriesData<ListPage<any>>(
      { predicate: q => q.queryKey[0] === `${BASE}/${t}` && q.queryKey[1] === "list" },
      old => (old ? { ...old, rows: old.rows.map(r => (r.id === id ? { ...r, ...patch } : r)) } : old),
    );
    queryClient.setQueryData<any>([`${BASE}/${t}`, id], (old: any) => (old ? { ...old, ...patch } : old));
  };

  type ActionVars = {
    tab: TabKey; id: string; method: "POST" | "PATCH"; path: string; body?: unknown;
    optimistic?: Record<string, unknown>; success: string; onDone?: (data: any) => void;
  };
  const action = useMutation({
    mutationFn: async (v: ActionVars) => (await apiRequest(v.method, `${BASE}/${v.tab}/${v.id}${v.path}`, v.body)).json(),
    onMutate: v => {
      setBusy(v.id, true);
      if (v.optimistic) patchRow(v.tab, v.id, v.optimistic);
    },
    onSuccess: (data, v) => {
      const updated = data?.request ?? data;
      if (updated?.id) patchRow(v.tab, updated.id, updated);
      toast({ title: v.success, description: data?.order?.orderNumber ? `CRM order ${data.order.orderNumber} created.` : undefined });
      v.onDone?.(data);
    },
    onError: (err: Error, v) => {
      // Undo the optimistic change by reloading the real data.
      if (v.optimistic) refreshTab(v.tab);
      toast({ title: "Action failed", description: getErrorMessage(err), variant: "destructive" });
    },
    onSettled: (_d, _e, v) => {
      setBusy(v.id, false);
      queryClient.invalidateQueries({ queryKey: [`${BASE}/${v.tab}/stats`] });
      queryClient.invalidateQueries({ queryKey: [`${BASE}/${v.tab}`, v.id] });
      refreshTab(v.tab);
      refreshCounts();
    },
  });
  const run = (v: ActionVars) => action.mutate(v);

  if (user && !allowed) return <Redirect to="/" />;

  // ── Orders tab actions ──
  const copyText = (text: string) => { navigator.clipboard.writeText(text); toast({ title: "WhatsApp number copied" }); };
  const placeOrder = (r: WebsiteOrder, designerId?: number | null) => {
    const awaiting = r.status === "pending_approval";
    run({
      tab: "orders", id: r.id, method: "POST", path: awaiting ? "/approve" : "/place", body: { ...buildPlaceBody(r, platformNames).body, assignedToId: designerId ?? null },
      success: awaiting ? "Approved & order placed" : "Order placed",
      onDone: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/payment-verifications"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      },
    });
  };
  const retryMeta = (id: string) => run({ tab: "orders", id, method: "POST", path: "/meta-retry", optimistic: { meta_status: "pending" }, success: "Retrying Meta Purchase" });
  const openEdit = (r: WebsiteOrder) => { setEditTarget(r); setEditType(buildPrefill(r, platformNames).orderType); };

  const renderOrderActions = (r: WebsiteOrder) => {
    const busy = busyIds.has(r.id);
    if (r.crm_order_id) return <ViewOrderLink orderId={r.crm_order_id} testId={`link-view-order-${r.id}`} />;
    if (r.status === "rejected") return <span className="truncate text-xs text-slate-500">{REJECT_LABEL[r.reject_reason ?? ""] ?? "Rejected"}</span>;
    const awaiting = r.status === "pending_approval";
    if (awaiting && !isAdmin) return <span className="inline-flex items-center gap-1 text-xs text-orange-200"><Clock className="h-3.5 w-3.5" />Waiting for admin</span>;
    const reject = () => setRejectTarget({ kind: "order", id: r.id, name: r.name, awaiting, amount: money(r.total, r.currency) });
    const talk = payKind(r) === "talk" && paidToday(r) === 0;
    return (
      <div className="flex min-w-0 items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
        {talk && r.whatsapp && <Button asChild size="sm" variant="outline" className="h-8 px-2.5 text-xs"><a href={waLink(r.whatsapp)} target="_blank" rel="noopener noreferrer" data-testid={`button-open-whatsapp-${r.id}`}><MessageCircle className="mr-1 h-3.5 w-3.5" />WhatsApp</a></Button>}
        {talk ? (
          r.status === "contacted" ? null : <PrimaryButton busy={busy} icon={MessageCircle} onClick={() => run({ tab: "orders", id: r.id, method: "POST", path: "/contacted", optimistic: { status: "contacted" }, success: "Marked contacted" })} testId={`button-contacted-${r.id}`}>Mark contacted</PrimaryButton>
        ) : isAdmin ? (
          <PlacePopover r={r} busy={busy} platformNames={platformNames} label={awaiting ? "Approve & place" : "Verify & place"} onConfirm={(designerId) => placeOrder(r, designerId)} onEdit={() => openEdit(r)} />
        ) : (
          <SendForApprovalPopover busy={busy} onSend={note => run({ tab: "orders", id: r.id, method: "POST", path: "/send-for-approval", body: { note: note || null }, optimistic: { status: "pending_approval" }, success: "Sent to admin for approval" })} />
        )}
        <RowMenu disabled={busy} testId={`menu-order-${r.id}`}>
          {talk && <DropdownMenuItem onSelect={() => setAdvanceTarget(r)} data-testid={`button-record-advance-${r.id}`}>Record advance</DropdownMenuItem>}
          {isAdmin && !talk && <DropdownMenuItem onSelect={() => openEdit(r)}>Edit before placing</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => setSelectedId(r.id)}>Add note</DropdownMenuItem>
          <DropdownMenuItem className="text-rose-300 focus:text-rose-200" onSelect={reject} data-testid={`button-reject-${r.id}`}>{talk ? "Not interested" : awaiting ? "Decline" : "Reject"}</DropdownMenuItem>
        </RowMenu>
      </div>
    );
  };

  // ── Reviews tab actions ──
  const setReviewStatus = (r: CvReview, next: "in_review" | "sent" | "new", success: string) =>
    run({ tab: "reviews", id: r.id, method: "PATCH", path: "", body: { status: next }, optimistic: { status: next }, success });
  const openConvert = (r: CvReview) => { setConvertTarget(r); setConvertType("documentation"); };
  const renderReviewActions = (r: CvReview) => {
    const busy = busyIds.has(r.id);
    if (r.crm_order_id) return <ViewOrderLink orderId={r.crm_order_id} testId={`link-view-order-${r.id}`} />;
    const reject = () => setRejectTarget({ kind: "review", id: r.id, name: r.name, awaiting: false });
    if (r.status === "rejected") {
      return (
        <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
          <span className="truncate text-xs text-slate-500">{REJECT_LABEL[r.reject_reason ?? ""] ?? "Rejected"}</span>
          <RowMenu disabled={busy}><DropdownMenuItem onSelect={() => setReviewStatus(r, "new", "Review reopened")}>Reopen</DropdownMenuItem></RowMenu>
        </div>
      );
    }
    return (
      <div className="flex min-w-0 items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
        {r.status === "new" && <PrimaryButton busy={busy} icon={Sparkles} onClick={() => setReviewStatus(r, "in_review", "Review started")} testId={`button-start-review-${r.id}`}>Start review</PrimaryButton>}
        {r.status === "in_review" && <PrimaryButton busy={busy} icon={Send} onClick={() => setReviewStatus(r, "sent", "Review marked as sent")} testId={`button-mark-sent-${r.id}`}>Mark sent</PrimaryButton>}
        {r.status === "sent" && <PrimaryButton busy={busy} icon={ShieldCheck} onClick={() => openConvert(r)} testId={`button-convert-${r.id}`}>Convert to order</PrimaryButton>}
        <RowMenu disabled={busy} testId={`menu-review-${r.id}`}>
          {r.status === "new" && <DropdownMenuItem onSelect={() => setReviewStatus(r, "sent", "Review marked as sent")}>Mark sent</DropdownMenuItem>}
          {r.status !== "sent" && <DropdownMenuItem onSelect={() => openConvert(r)}>Convert to order</DropdownMenuItem>}
          <DropdownMenuItem className="text-rose-300 focus:text-rose-200" onSelect={reject}>Reject</DropdownMenuItem>
        </RowMenu>
      </div>
    );
  };

  // ── Partners tab actions ──
  const setPartnerStatus = (p: Partner, next: string) =>
    run({ tab: "partners", id: p.id, method: "PATCH", path: "", body: { status: next }, optimistic: { status: next }, success: `Marked as ${STATUS_STYLES[next]?.label.toLowerCase() ?? next}` });
  const changeStatus = (kind: "order" | "partner", r: WebsiteOrder | Partner, next: string) => {
    const name = kind === "order" ? (r as WebsiteOrder).name : (r as Partner).org_name;
    const lc = { action: "status_changed", to: next, by: user?.name ?? null, at: new Date().toISOString() };
    if (next === "rejected" || next === "lost") {
      setRejectTarget({ kind, id: r.id, name, awaiting: r.status === "pending_approval" });
      if (view !== "paid") setRejectReason("not_interested");
      return;
    }
    if (kind === "partner") {
      run({ tab: "partners", id: r.id, method: "PATCH", path: "", body: { status: PARTNER_DB[next] }, optimistic: { status: PARTNER_DB[next], last_change: lc }, success: "Status saved" });
    } else {
      run({ tab: "orders", id: r.id, method: "POST", path: "/status", body: { status: next }, optimistic: { last_change: lc }, success: "Status saved" });
    }
  };
  const renderStatus = (kind: "order" | "partner", r: WebsiteOrder | Partner) => {
    const cur = kind === "order" ? orderRowStatus(r as WebsiteOrder) : partnerRowStatus(r.status);
    const opts = ROW_STATUSES[view];
    const label = opts.find(o => o.key === cur)?.label ?? cur;
    const locked = cur === "placed";
    const who = whoLine(r.last_change, label);
    return (
      <div className="min-w-0" onClick={e => e.stopPropagation()}>
        <Select value={cur} disabled={locked || busyIds.has(r.id)} onValueChange={v => v !== cur && changeStatus(kind, r, v)}>
          <SelectTrigger className="h-8 w-full max-w-[150px] text-xs" data-testid={`select-row-status-${r.id}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {opts.map(o => <SelectItem key={o.key} value={o.key} disabled={o.key === "placed"}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {kind === "order" && r.status === "pending_approval" && <p className="mt-1 text-[11px] text-orange-200">Waiting for admin</p>}
        {who && <p className="mt-1 truncate text-[11px] text-slate-500" title={who} data-testid={`who-${r.id}`}>{who}</p>}
      </div>
    );
  };

  const partnerAction = (p: Partner) => p.whatsapp
    ? <Button asChild size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={e => e.stopPropagation()}><a href={waLink(p.whatsapp)} target="_blank" rel="noopener noreferrer" aria-label="Open WhatsApp"><MessageCircle className="h-3.5 w-3.5" /></a></Button>
    : null;
  const renderPartnerActions = (p: Partner) => {
    const busy = busyIds.has(p.id);
    const primary: Record<string, { next: string; label: string; icon: React.ElementType } | undefined> = {
      new: { next: "contacted", label: "Mark contacted", icon: MessageCircle },
      contacted: { next: "trial", label: "Start trial", icon: CalendarCheck },
      trial: { next: "active", label: "Mark active", icon: CheckCircle2 },
    };
    const step = primary[p.status];
    return (
      <div className="flex min-w-0 items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
        {step && <PrimaryButton busy={busy} icon={step.icon} onClick={() => setPartnerStatus(p, step.next)} testId={`button-partner-${step.next}-${p.id}`}>{step.label}</PrimaryButton>}
        <RowMenu disabled={busy} testId={`menu-partner-${p.id}`}>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Change status</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="border-slate-800 bg-slate-900 text-slate-200">
              {STATUS_FILTERS.partners.filter(s => s.value !== "all" && s.value !== p.status).map(s => (
                <DropdownMenuItem key={s.value} onSelect={() => setPartnerStatus(p, s.value)}>{s.label}</DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator className="bg-slate-800" />
          <DropdownMenuItem onSelect={() => { setNoteTarget(p); setNoteDraft(p.internal_notes ?? ""); }}>Add note</DropdownMenuItem>
        </RowMenu>
      </div>
    );
  };

  // ── Header pieces ──
  const hasFilters = !!filters.q;
  const exportHref = `${BASE}/${tab}/export?${queryString}`;
  const viewBadge: Record<View, number> = {
    paid: (counts?.paid_new ?? 0) + (isAdmin ? counts?.awaiting_approval ?? 0 : 0),
    talk: counts?.talk_new ?? 0,
    partners: counts?.partners_new ?? 0,
  };

  // Column layouts (fixed widths → no horizontal scroll).
  const cols: Record<View, Array<{ label: string; width: string; className?: string }>> = {
    paid: [
      { label: "Received", width: "8%" }, { label: "Client", width: "13%" }, { label: "Package", width: "11%" },
      { label: "Total", width: "9%" }, { label: "Paid", width: "9%" }, { label: "Balance", width: "9%" },
      { label: "Proof", width: "6%" }, { label: "Status", width: "16%" }, { label: "Action", width: "19%", className: "text-right" },
    ],
    talk: [
      { label: "Received", width: "10%" }, { label: "Client", width: "22%" }, { label: "Package", width: "17%" },
      { label: "Total", width: "10%" }, { label: "Status", width: "16%" }, { label: "Action", width: "25%", className: "text-right" },
    ],
    partners: [
      { label: "Received", width: "10%" }, { label: "Organization", width: "20%" }, { label: "Contact", width: "21%" },
      { label: "Country", width: "11%" }, { label: "Monthly volume", width: "12%" }, { label: "Status", width: "16%" }, { label: "Action", width: "10%", className: "text-right" },
    ],
  };
  const columns = cols[view];

  const emptyText = hasFilters ? "No requests match your search." : "Nothing here.";

  return (
    <div className="crm-page space-y-5">
      <PageHeader title="Website Requests" testId="text-page-title" actions={
        <Button variant="outline" asChild data-testid="button-export-csv">
          <a href={exportHref} download><Download className="mr-2 h-4 w-4" />Export CSV</a>
        </Button>
      } />

      <Tabs value={view} onValueChange={v => switchView(v as View)} className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
          {(["paid", "talk", "partners"] as View[]).map(v => (
            <TabsTrigger key={v} value={v} className="shrink-0 px-5" data-testid={`tab-${v}`}>
              {VIEW_LABELS[v]}
              {viewBadge[v] > 0 && <span className="ml-2 rounded-full bg-primary px-1.5 text-[10px] font-bold text-on-color" data-testid={`badge-tab-${v}`}>{viewBadge[v]}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input placeholder={TABLE_TEXT[tab].search} className="pl-10" value={searchInput} onChange={e => setSearchInput(e.target.value)} data-testid="input-search-website-requests" />
          {(list.isFetching || searchInput.trim() !== filters.q) && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-500" />}
        </div>
        <Select value={status === ALL_FILTER[view] ? "all" : status} onValueChange={v => setFilters({ status: v === "all" ? ALL_FILTER[view] : v === DEFAULT_STATUS[tab] ? "" : v })}>
          <SelectTrigger className="w-full sm:w-44" data-testid="select-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {ROW_STATUSES[view].map(o => <SelectItem key={o.filter} value={o.filter}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {tab === "orders" && (
          <div className="divide-y divide-slate-800 md:hidden" data-testid="order-cards">
            {list.isLoading && <p className="p-4 text-sm text-slate-500">Loading…</p>}
            {!list.isLoading && rows.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{emptyText}</p>}
            {rows.map((r: WebsiteOrder) => { const paid = paidToday(r); return (
              <div key={r.id} className={cn("space-y-1.5 p-4", isUnhandled(r) && "shadow-[inset_3px_0_0_rgba(244,63,94,0.7)]")} onClick={() => setSelectedId(r.id)} data-testid={`card-website-request-${r.id}`}>
                <div className="flex items-baseline justify-between gap-2"><p className="truncate font-semibold text-white">{r.name || "—"}</p><span className="shrink-0 text-xs text-slate-500">{timeAgo(r.created_at)}</span></div>
                <p className="truncate text-sm text-slate-300">{packageLabel(r.package)}</p>
                <p className="text-xs text-slate-400">Total <span className="text-white">{money(r.total, r.currency)}</span>{view === "paid" && <> · Paid <span className="text-emerald-300">{money(paid, r.currency)}</span> · Balance <span className="text-amber-200">{money(balanceOf(r), r.currency)}</span></>}</p>
                <div className="flex items-start justify-between gap-2 pt-1" onClick={e => e.stopPropagation()}><div className="w-36">{renderStatus("order", r)}</div>{renderOrderActions(r)}</div>
              </div>
            ); })}
          </div>
        )}
        {tab === "partners" && (
          <div className="divide-y divide-slate-800 md:hidden" data-testid="partner-cards">
            {!list.isLoading && rows.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{emptyText}</p>}
            {rows.map((p: Partner) => (
              <div key={p.id} className="space-y-1.5 p-4" onClick={() => setSelectedId(p.id)} data-testid={`card-partner-${p.id}`}>
                <div className="flex items-baseline justify-between gap-2"><p className="truncate font-semibold text-white">{p.org_name}</p><span className="shrink-0 text-xs text-slate-500">{timeAgo(p.created_at)}</span></div>
                <p className="truncate text-sm text-slate-300">{p.contact_name || "—"}{p.country_hq ? ` · ${p.country_hq}` : ""}</p>
                <p className="text-xs text-slate-400">Monthly volume <span className="text-white">{p.monthly_volume || "—"}</span></p>
                <div className="flex items-start justify-between gap-2 pt-1" onClick={e => e.stopPropagation()}><div className="w-36">{renderStatus("partner", p)}</div>{partnerAction(p)}</div>
              </div>
            ))}
          </div>
        )}
        <div className={cn("overflow-x-auto", tab !== "reviews" && "hidden md:block")}><Table className="min-w-[760px] table-fixed lg:min-w-0" data-testid={`table-website-${tab}`}>
          <colgroup>{columns.map(c => <col key={c.label} style={{ width: c.width }} />)}</colgroup>
          <TableHeader className="bg-slate-900/50">
            <TableRow className="border-slate-800 hover:bg-transparent">
              {columns.map(c => <TableHead key={c.label} className={cn("text-slate-400", c.className)}>{c.label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && <SkeletonRows cols={columns.length} />}
            {list.isError && (
              <TableRow className="border-slate-800"><TableCell colSpan={columns.length} className="py-8 text-center text-rose-300">
                {getErrorMessage(list.error, "Couldn't load requests.")} <Button variant="ghost" size="sm" className="text-cyan-300" onClick={() => list.refetch()}>Retry</Button>
              </TableCell></TableRow>
            )}
            {!list.isLoading && !list.isError && rows.length === 0 && (
              <TableRow className="border-slate-800"><TableCell colSpan={columns.length} className="py-8 text-center text-slate-500" data-testid="text-no-website-requests">{emptyText}</TableCell></TableRow>
            )}

            {tab === "orders" && rows.map((r: WebsiteOrder) => (
              <TableRow key={r.id} className={cn("cursor-pointer border-slate-800 hover:bg-slate-900/50", isUnhandled(r) && "[&>td:first-child]:shadow-[inset_3px_0_0_rgba(244,63,94,0.7)]", busyIds.has(r.id) && "opacity-60")} onClick={() => setSelectedId(r.id)} data-testid={`row-website-request-${r.id}`}>
                <TableCell className="py-3 text-xs text-slate-400"><span title={format(new Date(r.created_at), "MMM dd, yyyy · h:mm a")}>{timeAgo(r.created_at)}</span></TableCell>
                <TableCell>
                  <p className="truncate text-sm font-semibold text-white" title={r.name ?? ""}>{r.name || "—"}</p>
                  {r.whatsapp && <span className="flex min-w-0 items-center gap-1" onClick={e => e.stopPropagation()}><a href={waLink(r.whatsapp)} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-emerald-300 hover:underline" data-testid={`link-whatsapp-${r.id}`}>{r.whatsapp}</a><button type="button" className="shrink-0 text-slate-500 hover:text-white" aria-label="Copy WhatsApp number" onClick={() => copyText(r.whatsapp!)}><Copy className="h-3 w-3" /></button></span>}
                </TableCell>
                <TableCell><p className="truncate text-sm text-slate-200" title={packageLabel(r.package)}>{packageLabel(r.package)}</p></TableCell>
                <TableCell className="whitespace-nowrap text-sm text-white">{money(r.total, r.currency)}</TableCell>
                {view === "paid" && <>
                  <TableCell className="whitespace-nowrap text-sm text-emerald-300">{money(paidToday(r), r.currency)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-amber-200">{money(balanceOf(r), r.currency)}</TableCell>
                  <TableCell>
                    {safeUrl(r.payment_screenshot_url)
                      ? <a href={safeUrl(r.payment_screenshot_url)!} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-sm text-cyan-300 hover:underline" data-testid={`link-screenshot-${r.id}`}>View</a>
                      : <span className="text-slate-600">—</span>}
                  </TableCell>
                </>}
                <TableCell>{renderStatus("order", r)}</TableCell>
                <TableCell className="text-right">{renderOrderActions(r)}</TableCell>
              </TableRow>
            ))}

            {tab === "reviews" && rows.map((r: CvReview) => {
              const countries = r.target_countries?.length ? r.target_countries.join(", ") : r.target_country;
              return (
                <TableRow key={r.id} className={cn("cursor-pointer border-slate-800 hover:bg-slate-900/50", busyIds.has(r.id) && "opacity-60")} onClick={() => setSelectedId(r.id)} data-testid={`row-cv-review-${r.id}`}>
                  <TableCell className="py-3"><CustomerCell id={r.id} name={r.name} whatsapp={r.whatsapp} createdAt={r.created_at} /></TableCell>
                  <TableCell><p className="truncate text-sm text-slate-200" title={r.target_role ?? ""}>{r.target_role || "—"}</p></TableCell>
                  <TableCell><p className="line-clamp-2 text-sm text-slate-300" title={countries ?? ""}>{countries || "—"}</p></TableCell>
                  <TableCell>
                    {safeUrl(r.cv_url)
                      ? <a href={safeUrl(r.cv_url)!} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-sm text-cyan-300 hover:underline" data-testid={`link-cv-${r.id}`}>View<ExternalLink className="h-3 w-3" /></a>
                      : <span className="text-slate-600">—</span>}
                  </TableCell>
                  <TableCell><StatusPill status={r.status} /></TableCell>
                  <TableCell className="text-right">{renderReviewActions(r)}</TableCell>
                </TableRow>
              );
            })}

            {tab === "partners" && rows.map((p: Partner) => (
              <TableRow key={p.id} className={cn("cursor-pointer border-slate-800 hover:bg-slate-900/50", busyIds.has(p.id) && "opacity-60")} onClick={() => setSelectedId(p.id)} data-testid={`row-partner-${p.id}`}>
                <TableCell className="py-3 text-xs text-slate-400">{timeAgo(p.created_at)}</TableCell>
                <TableCell><p className="truncate text-sm font-semibold text-white" title={p.org_name}>{p.org_name}</p></TableCell>
                <TableCell>
                  <p className="truncate text-sm text-slate-200">{p.contact_name || "—"}</p>
                  {p.whatsapp && <a href={waLink(p.whatsapp)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="truncate text-xs text-emerald-300 hover:underline">{p.whatsapp}</a>}
                </TableCell>
                <TableCell><p className="truncate text-sm text-slate-300">{p.country_hq || "—"}</p></TableCell>
                <TableCell><p className="truncate text-sm text-slate-300">{p.monthly_volume || "—"}</p></TableCell>
                <TableCell>{renderStatus("partner", p)}</TableCell>
                <TableCell className="text-right">{partnerAction(p)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></div>
        {total > 0 && pageCount > 1 && (
          <div className="flex items-center justify-between border-t border-slate-800 px-6 py-3 text-sm text-slate-400" data-testid="pagination">
            <span>Page {filters.page} of {pageCount} · {total} total</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={filters.page <= 1 || list.isFetching} onClick={() => setFilters({ page: filters.page - 1 }, { resetPage: false })} data-testid="button-prev-page"><ChevronLeft className="h-4 w-4" />Prev</Button>
              <Button variant="outline" size="sm" disabled={filters.page >= pageCount || list.isFetching} onClick={() => setFilters({ page: filters.page + 1 }, { resetPage: false })} data-testid="button-next-page">Next<ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      <Sheet open={!!selectedId} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <RecordAdvanceDialog r={advanceTarget} onClose={() => setAdvanceTarget(null)} onDone={() => list.refetch()} />
        <SheetContent className="detail-drawer flex w-full flex-col border-slate-800 bg-slate-950 p-0 sm:max-w-xl">
          <SheetHeader className="detail-drawer-header border-b border-slate-800 px-6 py-4 text-left">
            <SheetTitle className="flex items-center justify-between gap-2 font-display text-white">
              <span className="flex items-center gap-2">
                {tab === "partners" ? <Building2 className="h-5 w-5" /> : tab === "reviews" ? <FileText className="h-5 w-5" /> : <Globe className="h-5 w-5" />}
                {tab === "partners" ? "Agency Partner" : tab === "reviews" ? "Free CV Review" : "Website Order"}
              </span>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white" onClick={() => setSelectedId(null)} aria-label="Close details" data-testid="button-close-request-details">
                <X className="h-4 w-4" />
              </Button>
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {detailLoading && (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-900" />)}</div>
            )}
            {detail && tab === "orders" && <OrderDrawerBody d={detail as WebsiteOrderDetail} isAdmin={isAdmin} busy={busyIds.has(detail.id)} onRetry={() => retryMeta(detail.id)}
              onSaveNotes={v => run({ tab: "orders", id: detail.id, method: "PATCH", path: "/notes", body: { crmNotes: v }, success: "Notes saved" })}
              onCopy={text => { navigator.clipboard.writeText(text); toast({ title: "WhatsApp number copied" }); }} />}
            {detail && tab === "reviews" && <ReviewDrawerBody d={detail as CvReviewDetail} busy={busyIds.has(detail.id)}
              onSaveNotes={v => run({ tab: "reviews", id: detail.id, method: "PATCH", path: "", body: { notes: v }, success: "Notes saved" })} />}
            {detail && tab === "partners" && <PartnerDrawerBody d={detail as PartnerDetail} busy={busyIds.has(detail.id)}
              onSaveNotes={v => run({ tab: "partners", id: detail.id, method: "PATCH", path: "", body: { notes: v }, success: "Notes saved" })} />}
          </div>

          {detail && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-800 bg-slate-950 px-6 py-3" data-testid="drawer-actions">
              <span className="truncate text-sm text-slate-300">{tab === "orders" ? money(detail.total, detail.currency) : <StatusPill status={detail.status} />}</span>
              {tab === "orders" ? renderOrderActions(detail) : tab === "reviews" ? renderReviewActions(detail) : renderPartnerActions(detail)}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Reject / Decline dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={open => { if (!open) { setRejectTarget(null); setRejectReason(""); setRejectNote(""); } }}>
        <DialogContent className="max-w-sm border-slate-800 bg-slate-900">
          <DialogHeader><DialogTitle className="text-white">{rejectTarget?.awaiting ? "Decline request" : view === "paid" ? "Reject request" : "Not interested"}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-400">{rejectTarget?.name || "Customer"}{rejectTarget?.amount ? ` · ${rejectTarget.amount}` : ""}</p>
          <div className="space-y-2">
            <Label className="text-slate-300">Reason *</Label>
            <Select value={rejectReason} onValueChange={setRejectReason}>
              <SelectTrigger className="border-slate-800 bg-slate-950 text-white" data-testid="select-reject-reason"><SelectValue placeholder="Select a reason" /></SelectTrigger>
              <SelectContent className="">
                {REJECT_REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {rejectTarget?.kind === "order" && <Textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={2} maxLength={500} className="resize-none border-slate-800 bg-slate-950 text-white" placeholder="Optional note (logged)" data-testid="input-reject-note" />}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!rejectReason || !rejectTarget || busyIds.has(rejectTarget.id)}
              onClick={() => {
                if (!rejectTarget) return;
                const done = () => { setRejectTarget(null); setRejectReason(""); setRejectNote(""); };
                if (rejectTarget.kind === "order") {
                  run({ tab: "orders", id: rejectTarget.id, method: "POST", path: "/reject", body: { reason: rejectReason, note: rejectNote.trim() || null }, optimistic: { status: "rejected", reject_reason: rejectReason }, success: rejectTarget.awaiting ? "Request declined" : "Request rejected", onDone: done });
                } else if (rejectTarget.kind === "partner") {
                  run({ tab: "partners", id: rejectTarget.id, method: "PATCH", path: "", body: { status: "lost", reason: rejectReason }, optimistic: { status: "lost" }, success: "Marked not interested", onDone: done });
                } else {
                  run({ tab: "reviews", id: rejectTarget.id, method: "PATCH", path: "", body: { status: "rejected", reason: rejectReason }, optimistic: { status: "rejected", reject_reason: rejectReason }, success: "Review rejected", onDone: done });
                }
              }}
              data-testid="button-confirm-reject"
            >
              {rejectTarget && busyIds.has(rejectTarget.id) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {rejectTarget?.awaiting ? "Decline" : view === "paid" ? "Reject" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Partner note */}
      <Dialog open={!!noteTarget} onOpenChange={open => { if (!open) setNoteTarget(null); }}>
        <DialogContent className="max-w-md border-slate-800 bg-slate-900">
          <DialogHeader><DialogTitle className="text-white">Notes · {noteTarget?.org_name}</DialogTitle></DialogHeader>
          <Textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} rows={5} maxLength={5000} className="resize-none border-slate-800 bg-slate-950 text-white" placeholder="Visible to the CRM team only..." data-testid="input-partner-note" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNoteTarget(null)}>Cancel</Button>
            <Button disabled={!noteTarget || busyIds.has(noteTarget.id) || noteDraft === (noteTarget?.internal_notes ?? "")} onClick={() => noteTarget && run({ tab: "partners", id: noteTarget.id, method: "PATCH", path: "", body: { notes: noteDraft }, optimistic: { internal_notes: noteDraft }, success: "Note saved", onDone: () => setNoteTarget(null) })} data-testid="button-save-partner-note">Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit before placing — the existing CRM Create Order form, prefilled (admin only) */}
      <Dialog open={!!editTarget} onOpenChange={open => { if (!open) { setEditTarget(null); setEditType(null); } }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-slate-800 bg-slate-900">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-white">
              {editType ? ORDER_SERVICE_TYPE_TITLES[editType] : "Choose Service"}
              <span className="mt-1 block text-xs font-normal text-slate-400">From website request · {editTarget?.name}</span>
            </DialogTitle>
          </DialogHeader>
          {editTarget && (editType ? (
            <CreateOrderForm
              key={`${editTarget.id}-${editType}`}
              designers={availableDesigners}
              orderType={editType}
              websitePrefill={buildPrefill(editTarget, platformNames).prefill}
              onBack={() => setEditType(null)}
              onConverted={() => { refreshTab("orders"); refreshCounts(); queryClient.invalidateQueries({ queryKey: ["/api/stats"] }); }}
              onSuccess={() => { setEditTarget(null); setEditType(null); }}
            />
          ) : (
            <ServiceTypeSelector onSelect={setEditType} />
          ))}
        </DialogContent>
      </Dialog>

      {/* Convert a free CV review → normal order form, prefilled */}
      <Dialog open={!!convertTarget} onOpenChange={open => { if (!open) { setConvertTarget(null); setConvertType(null); } }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-slate-800 bg-slate-900">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-white">
              {convertType ? ORDER_SERVICE_TYPE_TITLES[convertType] : "Choose Service"}
              <span className="mt-1 block text-xs font-normal text-slate-400">From free CV review · {convertTarget?.name}</span>
            </DialogTitle>
          </DialogHeader>
          {convertTarget && (convertType ? (
            <CreateOrderForm
              key={`${convertTarget.id}-${convertType}`}
              designers={availableDesigners}
              orderType={convertType}
              contactPrefill={reviewContactPrefill(convertTarget)}
              onBack={() => setConvertType(null)}
              onCreated={async order => {
                try {
                  const updated = await (await apiRequest("POST", `${BASE}/reviews/${convertTarget.id}/convert`, { orderId: order.id })).json();
                  patchRow("reviews", convertTarget.id, updated);
                  toast({ title: "Review converted", description: `Linked to order ${order.orderNumber ?? `#${order.id}`}.` });
                } catch (err) {
                  toast({ title: "Order created, but linking the review failed", description: getErrorMessage(err), variant: "destructive" });
                } finally {
                  queryClient.invalidateQueries({ queryKey: [`${BASE}/reviews/stats`] });
                  refreshCounts();
                }
              }}
              onSuccess={() => { setConvertTarget(null); setConvertType(null); }}
            />
          ) : (
            <ServiceTypeSelector onSelect={setConvertType} />
          ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Drawer bodies ─────────────────────────────────────────────────────────────

function OrderDrawerBody({ d, isAdmin, busy, onRetry, onSaveNotes, onCopy }: {
  d: WebsiteOrderDetail; isAdmin: boolean; busy: boolean; onRetry: () => void; onSaveNotes: (v: string) => void; onCopy: (text: string) => void;
}) {
  const metaResponse = d.meta?.response ?? null;
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-2xl font-bold text-white">{d.name || "Unnamed customer"}</span>
          <StatusPill status={d.crm_order_id && d.status !== "paid" ? "converted" : d.status} />
        </div>
        <p className="text-sm text-slate-400">Submitted {format(new Date(d.created_at), "MMMM dd, yyyy 'at' h:mm a")} · {timeAgo(d.created_at)}</p>
      </div>

      {d.status === "pending_approval" && (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-100" data-testid="banner-pending-approval">
          <p className="flex items-center gap-2"><Send className="h-4 w-4 text-orange-300" />Sent for approval{d.submittedByName ? ` by ${d.submittedByName}` : ""}{d.submitted_at ? ` · ${timeAgo(d.submitted_at)}` : ""}</p>
          {d.approval_note && <p className="mt-1 whitespace-pre-wrap pl-6 text-orange-100/80">"{d.approval_note}"</p>}
        </div>
      )}
      {d.flags.length > 0 && (
        <div className="space-y-2" data-testid="request-flags">
          {d.flags.map(f => (
            <div key={f.code} className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100" data-testid={`flag-${f.code}`}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />{f.message}
            </div>
          ))}
        </div>
      )}
      {d.status === "rejected" && d.reject_reason && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100"><XCircle className="h-4 w-4 text-rose-300" />Rejected — {REJECT_LABEL[d.reject_reason] ?? d.reject_reason}</div>
      )}
      {d.crm_order_id && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
          <span>Order {d.crmOrder?.orderNumber ?? `#${d.crm_order_id}`} placed{d.verifiedByName ? ` by ${d.verifiedByName}` : ""}{d.verified_at ? ` · ${format(new Date(d.verified_at), "MMM dd, yyyy · h:mm a")}` : ""} · received {money(d.paid_amount)}</span>
        </div>
      )}

      <DrawerSection title="Client">
        <div className="grid grid-cols-2 gap-4">
          <Field label="WhatsApp">
            {d.whatsapp ? (
              <div className="flex items-center gap-1.5">
                <a href={waLink(d.whatsapp)} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:underline" data-testid="link-open-whatsapp-chat">{d.whatsapp}</a>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-white" onClick={() => onCopy(d.whatsapp!)} aria-label="Copy WhatsApp number" data-testid="button-copy-whatsapp"><Copy className="h-3.5 w-3.5" /></Button>
              </div>
            ) : null}
          </Field>
          <Field label="Email">{d.email}</Field>
          <Field label="Market">{marketOf(d).flag} {marketOf(d).name}</Field>
          <Field label="Landing page"><span className="break-all text-xs">{landingPath(d)}</span></Field>
        </div>
      </DrawerSection>

      <DrawerSection title="Career">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Target countries" wide>{d.target_country}</Field>
          <Field label="Target role" wide>{d.target_role}</Field>
          {d.notes && <Field label="Notes from the client" wide><span className="whitespace-pre-wrap text-slate-300">{d.notes}</span></Field>}
          {safeUrl(d.cv_url) && <div className="col-span-2"><a href={safeUrl(d.cv_url)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-cyan-300 hover:underline">Open current CV <ExternalLink className="h-3 w-3" /></a></div>}
        </div>
      </DrawerSection>

      <DrawerSection title="Order">
        <p className="flex flex-wrap items-center gap-2 text-sm text-white">{packageLabel(d.package)} <span className="text-slate-500">· {money(d.package_price, d.currency)}</span></p>
        {(d.addons ?? []).length > 0 && (
          <ul className="space-y-1 text-sm">
            {(d.addons ?? []).map((a, i) => (
              <li key={`${a.id}-${i}`} className="flex justify-between gap-3 text-slate-200"><span>{a.name ?? a.id} <span className="text-slate-500">{a.qty ?? 1} × {money(a.price, d.currency)}</span></span><span className="text-slate-300">{money((a.price || 0) * (a.qty ?? 1), d.currency)}</span></li>
            ))}
          </ul>
        )}
        <p className="text-sm text-slate-400">Same-day delivery: <span className={d.same_day ? "text-amber-300" : "text-slate-300"}>{d.same_day ? "Yes" : "No"}</span></p>
        <div className="space-y-1 border-t border-slate-800 pt-3 text-sm">
          <div className="flex justify-between font-semibold text-white"><span>Total</span><span>{money(d.total, d.currency)}</span></div>
        </div>
      </DrawerSection>

      <DrawerSection title="Payment">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Choice"><PayBadge r={d} /></Field>
          <Field label="Paid today">{paidToday(d) > 0 ? money(paidToday(d), d.currency) : "Nothing paid yet"}</Field>
          <Field label="Balance due">{money(Math.max(0, (d.total || 0) - paidToday(d)), d.currency)}</Field>
          <Field label="Method">{d.payment_method}</Field>
          <Field label="Transaction ID" wide>{d.transaction_id}</Field>
        </div>
        {safeUrl(d.payment_screenshot_url) ? (
          <a href={safeUrl(d.payment_screenshot_url)!} target="_blank" rel="noopener noreferrer" className="block" data-testid="link-screenshot-thumbnail">
            <img src={safeUrl(d.payment_screenshot_url)!} alt="Payment screenshot" loading="lazy" className="max-h-96 w-full rounded-md border border-slate-700 object-contain transition-opacity hover:opacity-80" />
          </a>
        ) : <p className="text-sm text-slate-500">No screenshot uploaded.</p>}
      </DrawerSection>

      {isAdmin && (
        <DrawerSection title="Meta Purchase">
          <div className="flex items-center gap-3">
            <MetaBadge status={d.meta_status} busy={busy} error={metaResponse?.error} onRetry={d.meta_status === "failed" ? onRetry : undefined} />
            {d.meta_purchase_sent_at && <span className="text-xs text-slate-500">{format(new Date(d.meta_purchase_sent_at), "MMM dd, yyyy · h:mm a")}</span>}
          </div>
          {!d.meta_status && <p className="text-xs text-slate-500">{d.crm_order_id ? "Not sent — no payment was recorded, or Meta wasn't configured when the order was placed." : "Sent automatically when the order is placed with a payment."}</p>}
          {metaResponse?.error && <p className="text-xs text-rose-300">{metaResponse.error}</p>}
          <MetaTestPurchase id={d.id} />
        </DrawerSection>
      )}

      <DrawerSection title="Source">
        <p className="text-sm text-slate-200" data-testid="text-source">{sourceText(d)}</p>
      </DrawerSection>

      <DrawerSection title="Internal notes"><NotesEditor value={d.crm_notes} busy={busy} onSave={onSaveNotes} testId="crm-notes" /></DrawerSection>
      <DrawerSection title="Activity"><ActivityList items={d.activity} /></DrawerSection>
    </div>
  );
}

function ReviewDrawerBody({ d, busy, onSaveNotes }: { d: CvReviewDetail; busy: boolean; onSaveNotes: (v: string) => void }) {
  const countries = d.target_countries?.length ? d.target_countries.join(", ") : d.target_country;
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-2xl font-bold text-white">{d.name}</span>
          <StatusPill status={d.status} />
        </div>
        <p className="text-sm text-slate-400">Submitted {format(new Date(d.created_at), "MMMM dd, yyyy 'at' h:mm a")} · {timeAgo(d.created_at)}</p>
      </div>
      {d.crmOrder && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />Converted to order {d.crmOrder.orderNumber ?? `#${d.crmOrder.id}`}
        </div>
      )}
      {d.status === "rejected" && <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100"><XCircle className="h-4 w-4 text-rose-300" />Rejected — {REJECT_LABEL[d.reject_reason ?? ""] ?? d.reject_reason ?? "no reason"}</div>}
      <DrawerSection title="Customer">
        <div className="grid grid-cols-2 gap-4">
          <Field label="WhatsApp">{d.whatsapp && <a href={waLink(d.whatsapp)} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:underline">{d.whatsapp}</a>}</Field>
          <Field label="Email">{d.email}</Field>
          <Field label="Target role">{d.target_role}</Field>
          <Field label="Target countries">{countries}</Field>
          {d.notes && <Field label="Customer notes" wide><span className="whitespace-pre-wrap text-slate-300">{d.notes}</span></Field>}
        </div>
      </DrawerSection>
      <DrawerSection title="CV">
        {safeUrl(d.cv_url)
          ? <a href={safeUrl(d.cv_url)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-cyan-300 hover:underline" data-testid="link-review-cv">{d.cv_filename || "Open CV"} <ExternalLink className="h-3 w-3" /></a>
          : <p className="text-sm text-slate-500">No CV uploaded.</p>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Review started">{d.review_started_at ? format(new Date(d.review_started_at), "MMM dd · h:mm a") : null}</Field>
          <Field label="Sent">{d.sent_at ? format(new Date(d.sent_at), "MMM dd · h:mm a") : null}</Field>
        </div>
      </DrawerSection>
      <DrawerSection title="Source">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Market"><span className="uppercase">{d.market}</span></Field>
          <Field label="UTM source">{d.utm_source}</Field>
          <Field label="Campaign">{d.utm_campaign}</Field>
        </div>
      </DrawerSection>
      <DrawerSection title="Internal notes"><NotesEditor value={d.internal_notes} busy={busy} onSave={onSaveNotes} testId="review-notes" /></DrawerSection>
      <DrawerSection title="Activity"><ActivityList items={d.activity} /></DrawerSection>
    </div>
  );
}

function PartnerDrawerBody({ d, busy, onSaveNotes }: { d: PartnerDetail; busy: boolean; onSaveNotes: (v: string) => void }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-2xl font-bold text-white">{d.org_name}</span>
          <StatusPill status={d.status} />
        </div>
        <p className="text-sm text-slate-400">{d.org_type || "Organization"} · submitted {format(new Date(d.created_at), "MMMM dd, yyyy")} · {timeAgo(d.created_at)}</p>
      </div>
      <DrawerSection title="Contact">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name">{d.contact_name}</Field>
          <Field label="Designation">{d.designation}</Field>
          <Field label="WhatsApp">{d.whatsapp && <a href={waLink(d.whatsapp)} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:underline">{d.whatsapp}</a>}</Field>
          <Field label="Email">{d.email}</Field>
        </div>
      </DrawerSection>
      <DrawerSection title="Business">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Country (HQ)">{d.country_hq}</Field>
          <Field label="Monthly volume">{d.monthly_volume}</Field>
          <Field label="Destinations" wide>{d.destinations}</Field>
          <Field label="Model" wide>{d.model}</Field>
          {d.notes && <Field label="Their message" wide><span className="whitespace-pre-wrap text-slate-300">{d.notes}</span></Field>}
        </div>
      </DrawerSection>
      <DrawerSection title="Internal notes"><NotesEditor value={d.internal_notes} busy={busy} onSave={onSaveNotes} testId="partner-notes" /></DrawerSection>
      <DrawerSection title="Activity"><ActivityList items={d.activity} /></DrawerSection>
    </div>
  );
}

/** Admin dry-run: sends the exact Purchase payload with META_TEST_EVENT_CODE. Creates nothing. */
function MetaTestPurchase({ id }: { id: string }) {
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setErr(null); setOut(null);
    try { setOut(await (await apiRequest("POST", `${BASE}/orders/${id}/meta-test`)).json()); }
    catch (e) { setErr(getErrorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 border-t border-slate-800 pt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Dry run: test event only. No order, payment or status change.</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={run} data-testid="button-meta-test">{busy ? "Sending…" : "Send test Purchase"}</Button>
      </div>
      {err && <p className="text-xs text-rose-300">{err}</p>}
      {out && (
        <div className="space-y-2 text-xs">
          <p>events_received: <b>{String(out.response?.events_received ?? "—")}</b> · fbtrace_id: <span className="font-mono">{out.response?.fbtrace_id ?? "—"}</span>{out.response?.error && <span className="text-rose-300"> · {out.response.error}</span>}</p>
          {out.missing?.length > 0 && <p className="text-amber-300">Empty (website didn't save): {out.missing.join(", ")}</p>}
        </div>
      )}
    </div>
  );
}

/** Talk-first → client paid: amount + screenshot. Request becomes Paid 50% / 100%. */
function RecordAdvanceDialog({ r, onClose, onDone }: { r: WebsiteOrder | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [txn, setTxn] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setAmount(""); setFile(null); setTxn(""); }, [r?.id]);
  const save = async () => {
    if (!r || !file || !(Number(amount) > 0)) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("screenshot", file);
      const up = await fetch(`${BASE}/orders/${r.id}/advance-screenshot`, { method: "POST", body: fd, credentials: "include" });
      const upJson = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(upJson.message || `Upload failed (${up.status})`);
      const { url } = upJson;
      await apiRequest("POST", `${BASE}/orders/${r.id}/record-advance`, { amount: Number(amount), screenshotUrl: url, transactionId: txn || null });
      toast({ title: "Advance recorded", description: "Now use Verify & place." });
      onDone(); onClose();
    } catch (e) { toast({ title: "Couldn't record the advance", description: getErrorMessage(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={!!r} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Record advance</DialogTitle></DialogHeader>
        {r && <p className="text-sm text-slate-400">{r.name} · total {money(r.total, r.currency)}</p>}
        <div className="space-y-3">
          <div><Label>Amount received (Rs)</Label><Input type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)} data-testid="input-advance-amount" /></div>
          <div><Label>Transaction ID (optional)</Label><Input value={txn} onChange={e => setTxn(e.target.value)} /></div>
          <div><Label>Payment screenshot</Label><Input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)} data-testid="input-advance-screenshot" /></div>
          <Button className="w-full" disabled={busy || !file || !(Number(amount) > 0)} onClick={save} data-testid="button-save-advance">{busy ? "Saving…" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
