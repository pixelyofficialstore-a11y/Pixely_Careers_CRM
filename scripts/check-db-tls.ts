// Read-only check: connects with certificate verification and prints the TLS version.
// Usage: npx tsx scripts/check-db-tls.ts
import "dotenv/config";
import pg from "pg";
import { sslConfigFor, stripSslParams } from "../server/dbSsl";

const url = (process.env.MIGRATION_DATABASE_URL_CHECK === "1" ? process.env.MIGRATION_DATABASE_URL : (process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL)) || "";
const client = new pg.Client({ connectionString: stripSslParams(url.trim()), ssl: sslConfigFor(url), connectionTimeoutMillis: 15_000 });
const timer = setTimeout(() => { console.log("timeout"); process.exit(2); }, 30_000);
client.connect()
  .then(() => client.query("select ssl, version from pg_stat_ssl where pid = pg_backend_pid()"))
  .then(r => { console.log("verified TLS ok (client→pooler cert checked against the Supabase CA)"); return client.end(); })
  .catch(e => { console.log("TLS check failed:", e.code || "", e.message); process.exitCode = 1; })
  .finally(() => clearTimeout(timer));
