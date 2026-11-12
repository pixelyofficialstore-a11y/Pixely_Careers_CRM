/** Phase 5: WhatsApp quick replies. Defaults are used until an admin saves templates in Settings. */
export type TemplateVars = { name?: string | null; order?: string | null; amount?: string | null; balance?: string | null; link?: string | null };

export const DEFAULT_WHATSAPP_TEMPLATES: { kind: string; label: string; body: string }[] = [
  { kind: "payment_received", label: "Payment received", body: "Hi {name}, we have received your payment of {amount} for order {order}. Thank you! Our team has started on your order." },
  { kind: "draft_ready", label: "Draft ready", body: "Hi {name}, the first draft for order {order} is ready. Please review it and share any changes you would like. {link}" },
  { kind: "revision_done", label: "Revision done", body: "Hi {name}, your requested changes for order {order} are done. Please have a look and let us know if everything is good. {link}" },
  { kind: "delivered", label: "Delivered", body: "Hi {name}, your order {order} has been delivered. Thank you for choosing Pixely Careers! {link}" },
  { kind: "review_request", label: "Review request", body: "Hi {name}, we hope you are happy with your order {order}. Could you share a short review of your experience? It really helps us. Thank you!" },
];

/** Fills {name} {order} {amount} {balance} {link}; unknown/empty placeholders are removed cleanly. */
export function fillTemplate(body: string, vars: TemplateVars): string {
  return body
    .replace(/\{(name|order|amount|balance|link)\}/g, (_, k: keyof TemplateVars) => String(vars[k] ?? "").trim())
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}
