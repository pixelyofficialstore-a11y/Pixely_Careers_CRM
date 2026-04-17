import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

const databaseUrl = (process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "").trim().replace(/\s+/g, '') || undefined;

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
