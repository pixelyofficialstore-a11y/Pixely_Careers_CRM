import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import * as schema from "@shared/schema";
import { sslConfigFor, stripSslParams } from "./dbSsl";

const { Pool } = pg;

const databaseUrl = (process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "").trim().replace(/\s+/g, '') || undefined;

if (!databaseUrl) {
  throw new Error(
    "SUPABASE_DATABASE_URL or DATABASE_URL must be set.",
  );
}

/** Set per request in index.ts so slow-query logs can name the route. */
export const requestContext = new AsyncLocalStorage<{ route: string }>();

const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS || 200);

// One process-wide pool. node-postgres only uses server-side prepared
// statements when a query is given a `name`, and nothing here names queries,
// so it is safe behind Supabase's transaction pooler (port 6543).
export const pool = new Pool({
  connectionString: stripSslParams(databaseUrl),
  ssl: sslConfigFor(databaseUrl),
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
});

pool.on("error", (err: Error) => {
  console.error(`[db] idle client error: ${err.message}`);
});

// Log every query slower than SLOW_QUERY_MS so slow spots show up in Railway logs.
pool.on("connect", (client: any) => {
  const original = client.query.bind(client);
  client.query = (...args: any[]) => {
    const started = Date.now();
    const route = requestContext.getStore()?.route ?? "background";
    const result = original(...args);
    if (result && typeof result.then === "function") {
      const text = typeof args[0] === "string" ? args[0] : args[0]?.text;
      result.then(
        () => {
          const ms = Date.now() - started;
          if (ms > SLOW_QUERY_MS && text && !/^(begin|commit|rollback|savepoint|release)/i.test(text)) {
            console.warn(`[slow-query] ${ms}ms route=${route} sql=${String(text).replace(/\s+/g, " ").slice(0, 300)}`);
          }
        },
        () => {},
      );
    }
    return result;
  };
});

export const db = drizzle(pool, { schema });
