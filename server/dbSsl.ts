import fs from "node:fs";
import path from "node:path";

/**
 * TLS for Supabase Postgres with certificate verification.
 *
 * The Supabase root CA (Dashboard → Project Settings → Database → SSL
 * configuration → "Download certificate", prod-ca-2021.crt) is read from:
 *   1. SUPABASE_CA_CERT       (PEM text; use this on Railway)
 *   2. SUPABASE_CA_CERT_PATH  (file path)
 *   3. certs/supabase-ca.crt  (local default; the CA is public, safe to commit)
 */
function loadCa(): string | undefined {
  const inline = process.env.SUPABASE_CA_CERT?.trim();
  if (inline) return inline.replace(/\n/g, "\n");
  const file = process.env.SUPABASE_CA_CERT_PATH || path.resolve(process.cwd(), "certs", "supabase-ca.crt");
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/** Removes sslmode/ssl* params: they would override the ssl object below. */
export function stripSslParams(url: string): string {
  try {
    const u = new URL(url);
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return url;
  }
}

let warned = false;

export function sslConfigFor(url: string) {
  const isSupabase = /supabase\.(co|com)/.test(url);
  if (!isSupabase && process.env.DB_SSL !== "require") return undefined;
  const ca = loadCa();
  if (ca) return { rejectUnauthorized: true, ca };
  if (process.env.DB_SSL_ALLOW_UNVERIFIED === "1") {
    if (!warned) {
      console.warn("[db] WARNING: TLS certificate NOT verified (DB_SSL_ALLOW_UNVERIFIED=1). Set SUPABASE_CA_CERT.");
      warned = true;
    }
    return { rejectUnauthorized: false };
  }
  throw new Error(
    "Supabase CA certificate not found. Set SUPABASE_CA_CERT (PEM) or add certs/supabase-ca.crt. " +
    "Temporary escape hatch: DB_SSL_ALLOW_UNVERIFIED=1.",
  );
}
