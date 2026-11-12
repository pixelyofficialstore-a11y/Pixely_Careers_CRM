/**
 * Rule 0 backup: pg_dump of the CRM (public) and website schemas.
 *
 *   npx tsx --env-file=.env scripts/backup-db.ts
 *
 * Uses tools/pg17/pgsql/bin/pg_dump.exe (or PG_DUMP), connects through the
 * Supabase pooler in SESSION mode (port 5432; pg_dump can't use the 6543
 * transaction pooler), verifies TLS against certs/supabase-ca.crt, and writes
 * backups/pixely-<UTC timestamp>.dump. The password is passed via the
 * environment and never printed. Read-only: pg_dump never changes data.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const raw = (process.env.MIGRATION_DATABASE_URL || process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "").trim().replace(/\s+/g, "");
if (!raw) { console.error("✖ DATABASE_URL is not set"); process.exit(1); }
const url = new URL(raw);
if (url.hostname.includes("pooler") && url.port === "6543") url.port = "5432";

const pgDump = process.env.PG_DUMP || path.resolve("tools/pg17/pgsql/bin/pg_dump.exe");
if (!fs.existsSync(pgDump)) { console.error(`✖ pg_dump not found at ${pgDump}`); process.exit(1); }
const ca = path.resolve("certs/supabase-ca.crt");

fs.mkdirSync("backups", { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const out = path.resolve("backups", `pixely-${stamp}.dump`);

const args = [
  "--format=custom", "--no-password", "--verbose",
  "--schema=public", "--schema=website",
  `--file=${out}`,
  `--host=${url.hostname}`, `--port=${url.port || "5432"}`,
  `--username=${decodeURIComponent(url.username)}`,
  `--dbname=${url.pathname.slice(1) || "postgres"}`,
];
const env = {
  ...process.env,
  PGPASSWORD: decodeURIComponent(url.password),
  PGSSLMODE: fs.existsSync(ca) ? "verify-full" : "require",
  ...(fs.existsSync(ca) ? { PGSSLROOTCERT: ca } : {}),
  PGCONNECT_TIMEOUT: "20",
};
console.log(`→ pg_dump ${url.hostname}:${url.port} (schemas public, website) → ${path.relative(process.cwd(), out)}`);
const r = spawnSync(pgDump, args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const log = (r.stderr || "").split("\n").filter(Boolean);
const tables = log.filter(l => /dumping contents of table/.test(l)).length;
if (r.status !== 0) {
  console.error(log.slice(-15).join("\n"));
  console.error(`✖ pg_dump failed (exit ${r.status})`);
  process.exit(1);
}
const size = fs.statSync(out).size;
console.log(`✔ backup written: ${path.relative(process.cwd(), out)} (${(size / 1024 / 1024).toFixed(2)} MB, ${tables} tables with data)`);
