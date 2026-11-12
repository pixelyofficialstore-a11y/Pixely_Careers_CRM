/**
 * Client key from a phone number. MUST match SQL public.pk_phone_key (migration 0004):
 * Pakistani numbers in any format -> 92XXXXXXXXXX; others -> digits, leading 00 removed.
 */
export function pkPhoneKey(phone: string | null | undefined): string | null {
  const d = String(phone ?? "").replace(/[^0-9]/g, "");
  if (/^03[0-9]{9}$/.test(d)) return "92" + d.slice(1);
  if (/^3[0-9]{9}$/.test(d)) return "92" + d;
  if (d.startsWith("00")) return d.slice(2) || null;
  return d || null;
}

/** wa.me link for a phone (null if no usable number). */
export function waLink(phone: string | null | undefined, text?: string): string | null {
  const key = pkPhoneKey(phone);
  if (!key || key.length < 8) return null;
  return `https://wa.me/${key}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
