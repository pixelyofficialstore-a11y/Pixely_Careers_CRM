/**
 * Rule 0 test harness: every query the app makes goes through ONE connection
 * inside a transaction that is always ROLLED BACK, and that connection is then
 * destroyed (so a late async write can't autocommit). pool.connect() is blocked
 * so nothing can open a second, committing connection.
 *
 * Each app query runs inside its own SAVEPOINT (serialised), so an expected
 * error (e.g. a table that doesn't exist yet) can't abort the whole transaction.
 */
import type { PoolClient } from "pg";
import { pool } from "../db";

let client: PoolClient | null = null;
let chain: Promise<unknown> = Promise.resolve();
const original = { query: pool.query.bind(pool), connect: pool.connect.bind(pool) };

function runIsolated(c: PoolClient, args: any[]) {
  const callback = typeof args[args.length - 1] === "function" ? args.pop() : null;
  const job = chain.then(async () => {
    await c.query("SAVEPOINT t");
    try {
      const result = await (c.query as any)(...args);
      await c.query("RELEASE SAVEPOINT t");
      return result;
    } catch (err) {
      await c.query("ROLLBACK TO SAVEPOINT t");
      throw err;
    }
  });
  chain = job.catch(() => undefined);
  if (callback) {
    job.then(r => callback(null, r), e => callback(e));
    return undefined;
  }
  return job;
}

export async function beginTestTransaction() {
  if (client) throw new Error("test transaction already open");
  client = await original.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = '20s'");
  const c = client;
  (pool as any).query = (...args: any[]) => runIsolated(c, args);
  (pool as any).connect = async () => {
    throw new Error("pool.connect() is blocked during tests (would bypass the rolled-back transaction)");
  };
  return c;
}

export async function rollbackTestTransaction() {
  (pool as any).query = original.query;
  (pool as any).connect = original.connect;
  if (!client) return;
  const c = client;
  client = null;
  try {
    await chain;
    await c.query("ROLLBACK");
  } finally {
    c.release(true); // destroy, never return to the pool
  }
}

/** Runs a query inside the test transaction (for test fixtures). */
export function testQuery(text: string, params: unknown[] = []) {
  if (!client) throw new Error("no test transaction");
  return runIsolated(client, [text, params]) as Promise<{ rows: any[]; rowCount: number }>;
}

export async function tableExists(name: string): Promise<boolean> {
  const r = await testQuery("select to_regclass($1) is not null as ok", [name]);
  return Boolean(r.rows[0]?.ok);
}

/** True once migration 0001 has added the users security columns. */
export async function securityColumnsExist(): Promise<boolean> {
  const r = await testQuery(
    "select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'sessions_valid_after'",
  );
  return r.rows[0]?.n === 1;
}
