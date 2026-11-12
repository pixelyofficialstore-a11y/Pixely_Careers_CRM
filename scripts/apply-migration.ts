/**
 * Applies ONE reviewed SQL migration with the owner role.  (Rule 0)
 *
 *   pnpm db:migrate -- migrations/0001_phase0_security.sql --dry-run
 *   pnpm db:migrate -- migrations/0001_phase0_security.sql --approved
 *
 * Refuses to run unless:
 *   - --approved is passed (the owner approved this exact file in writing),
 *   - MIGRATION_DATABASE_URL (owner role) is set,
 *   - a pg_dump backup newer than 24 h exists in backups/ (or BACKUP_FILE),
 *   - the file contains no UPDATE/DELETE/TRUNCATE/DROP/MERGE statements,
 *   - it was not applied before (public.schema_migrations).
 *
 * {{CRM_APP_PASSWORD}} is substituted from CRM_APP_DB_PASSWORD; never printed.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { sslConfigFor, stripSslParams } from "../server/dbSsl";

const args = process.argv.slice(2).filter(a => a !== "--");
const file = args.find(a => !a.startsWith("--"));
const approved = args.includes("--approved");
const dryRun = args.includes("--dry-run");

function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!file) fail("Usage: pnpm db:migrate -- migrations/<file>.sql [--dry-run | --approved]");
const sqlPath = path.resolve(file);
if (!fs.existsSync(sqlPath)) fail(`No such file: ${file}`);
const name = path.basename(sqlPath, ".sql");
const raw = fs.readFileSync(sqlPath, "utf8");

// Static guard against data-changing statements (comments stripped first).
const code = raw.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const statements = code.split(";").map(s => s.trim().replace(/\s+/g, " ")).filter(Boolean);
const forbiddenStart = /^(UPDATE|DELETE|TRUNCATE|MERGE|DROP|COPY)\b/i;
const forbiddenAnywhere = /\b(ALTER TABLE [^ ]+ DROP|ALTER TABLE [^ ]+ ALTER COLUMN [^ ]+ (TYPE|SET DATA TYPE)|INSERT INTO (?!public\.schema_migrations\b))/i;
const bad = statements.find(s => forbiddenStart.test(s) || forbiddenAnywhere.test(s));
if (bad) fail(`Refusing: data-changing statement found ("${bad.slice(0, 80)}"). Rule 0 allows schema changes only.`);

const needsPassword = raw.includes("{{CRM_APP_PASSWORD}}");
const appPassword = process.env.CRM_APP_DB_PASSWORD || "";
if (needsPassword && !/^[A-Za-z0-9_-]{32,}$/.test(appPassword)) {
  fail("CRM_APP_DB_PASSWORD must be set in .env (32+ chars, letters/digits/_/-). Run: npx tsx scripts/gen-app-db-password.ts");
}

if (dryRun) {
  console.log(raw.replace(/\{\{CRM_APP_PASSWORD\}\}/g, "********"));
  console.log(`\n(dry run: nothing executed)`);
  process.exit(0);
}

if (!approved) fail("Refusing: pass --approved only after the owner approved this exact SQL in writing.");

const ownerUrl = (process.env.MIGRATION_DATABASE_URL || "").trim();
if (!ownerUrl) fail("MIGRATION_DATABASE_URL (owner role) is not set.");

const backupDir = path.resolve("backups");
const backupFile = process.env.BACKUP_FILE
  ? path.resolve(process.env.BACKUP_FILE)
  : fs.existsSync(backupDir)
    ? fs.readdirSync(backupDir).filter(f => /\.(dump|sql|sql\.gz)$/.test(f)).map(f => path.join(backupDir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
    : undefined;
if (!backupFile || !fs.existsSync(backupFile)) fail("No backup found in backups/. Run pg_dump first (see docs/security/MIGRATIONS.md).");
const stat = fs.statSync(backupFile);
if (Date.now() - stat.mtimeMs > 24 * 3600 * 1000) fail(`Latest backup is older than 24 h: ${path.basename(backupFile)}`);
if (stat.size < 10 * 1024) fail(`Backup looks too small (${stat.size} bytes): ${path.basename(backupFile)}`);
console.log(`✔ backup: ${path.relative(process.cwd(), backupFile)} (${(stat.size / 1024 / 1024).toFixed(2)} MB, ${new Date(stat.mtimeMs).toISOString()})`);

const sql = raw.replace(/\{\{CRM_APP_PASSWORD\}\}/g, appPassword);

const client = new pg.Client({ connectionString: stripSslParams(ownerUrl), ssl: sslConfigFor(ownerUrl), connectionTimeoutMillis: 15_000 });

async function counts() {
  const r = await client.query(`
    select c.relname as t, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname = 'public' and c.relname not in ('audit_events','files','schema_migrations')
    order by 1`);
  return new Map<string, number>(r.rows.map((row: any) => [row.t, Number(row.n)]));
}

(async () => {
  await client.connect();
  const exists = await client.query(`select to_regclass('public.schema_migrations') is not null as ok`);
  if (exists.rows[0].ok) {
    const done = await client.query(`select 1 from public.schema_migrations where name = $1`, [name]);
    if (done.rowCount) fail(`${name} was already applied.`);
  }
  const before = await counts();
  console.log(`→ applying ${name} …`);
  await client.query(sql); // the file has its own BEGIN/COMMIT
  const after = await counts();
  const changed = [...before].filter(([t, n]) => after.get(t) !== n);
  console.log(`✔ applied ${name}`);
  console.log(changed.length === 0
    ? `✔ row counts unchanged on all ${before.size} existing public tables`
    : `⚠ row counts changed (sessions/notifications can change from live traffic): ${changed.map(([t, n]) => `${t} ${n}→${after.get(t)}`).join(", ")}`);
  await client.end();
})().catch(async err => {
  console.error(`✖ migration failed (rolled back): ${err.message}`);
  try { await client.end(); } catch { /* ignore */ }
  process.exit(1);
});
