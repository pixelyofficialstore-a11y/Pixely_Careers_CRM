import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

// In production use SUPABASE_DATABASE_URL if set; in dev always use local DATABASE_URL so
// dev data (orders, etc.) is not lost when the Supabase secret is present.
const databaseUrl = (
  process.env.NODE_ENV === "production"
    ? (process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL)
    : (process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL)
  || ""
).trim().replace(/\s+/g, '') || undefined;

if (!databaseUrl) {
  throw new Error(
    "SUPABASE_DATABASE_URL or DATABASE_URL must be set.",
  );
}

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});
export const db = drizzle(pool, { schema });
