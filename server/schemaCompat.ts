/**
 * Pre-migration compatibility (read-only check, never changes the DB).
 *
 * Until migration 0001 adds the users security columns, the app reads only the
 * original users columns so sign-in keeps working. Security features that need
 * the new columns (forced password change, 2-step codes, session revocation)
 * stay inactive until the migration is applied and the server restarts.
 */
import { getTableColumns } from "drizzle-orm";
import { users } from "@shared/schema";
import { pool } from "./db";

const SECURITY_COLUMNS = ["mustChangePassword", "passwordChangedAt", "sessionsValidAfter", "totpSecret", "totpEnabled"] as const;

let legacyUsers = false;

export async function detectSchemaCompat(): Promise<void> {
  try {
    const r = await pool.query(
      "select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'sessions_valid_after'",
    );
    legacyUsers = r.rows[0]?.n !== 1;
  } catch (err: any) {
    console.error("[schema] could not check users columns:", err?.message || err);
    legacyUsers = false;
  }
  if (legacyUsers) {
    console.warn("[schema] users security columns are missing (migration 0001 not applied) - running in compatibility mode: forced password change, 2FA and session revocation are OFF.");
  }
}

export function isLegacyUsersSchema() {
  return legacyUsers;
}

/** Column set for selecting/returning users rows. */
export function userColumns() {
  const cols: Record<string, any> = { ...getTableColumns(users) };
  if (legacyUsers) for (const k of SECURITY_COLUMNS) delete cols[k];
  return cols as ReturnType<typeof getTableColumns<typeof users>>;
}

/** Drops security fields from an update/insert payload when the columns don't exist. */
export function stripUserSecurityFields<T extends Record<string, any>>(values: T): T {
  if (!legacyUsers) return values;
  const copy: Record<string, any> = { ...values };
  for (const k of SECURITY_COLUMNS) delete copy[k];
  return copy as T;
}
