// READ-ONLY schema report (runs inside BEGIN READ ONLY ... ROLLBACK). Prints no row data.
// Usage: npx tsx scripts/db-inspect.ts
import "dotenv/config";
import pg from "pg";
import { sslConfigFor, stripSslParams } from "../server/dbSsl";

const url = (process.env.MIGRATION_DATABASE_URL || process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "").trim();
const client = new pg.Client({ connectionString: stripSslParams(url), ssl: sslConfigFor(url), connectionTimeoutMillis: 15_000 });

async function main() {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  try {
    const q = async (title: string, sql: string) => {
      const r = await client.query(sql);
      console.log(`\n## ${title} (${r.rowCount})`);
      for (const row of r.rows) console.log("  " + Object.values(row).join(" | "));
    };
    await q("current role", "select current_user, (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls");
    await q("tables (schema | table | rls | approx rows)", `
      select n.nspname, c.relname, c.relrowsecurity, c.reltuples::bigint
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname in ('public','website') order by 1,2`);
    await q("anon/authenticated table grants", `
      select table_schema, table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
      from information_schema.role_table_grants
      where grantee in ('anon','authenticated') and table_schema in ('public','website')
      group by 1,2,3 order by 1,2,3`);
    await q("indexes", `
      select schemaname, tablename, indexname, indexdef from pg_indexes
      where schemaname in ('public','website') order by 1,2,3`);
    await q("foreign keys without a leading index", `
      select n.nspname, c.relname, a.attname, con.conname
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = con.conkey[1]
      where con.contype = 'f' and n.nspname in ('public','website') and array_length(con.conkey,1) = 1
        and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = con.conkey[1])
      order by 1,2,3`);
    await q("sequences", `select sequence_schema, sequence_name from information_schema.sequences where sequence_schema in ('public','website') order by 1,2`);
    await q("roles named crm_app", `select rolname from pg_roles where rolname = 'crm_app'`);
    await q("columns that already exist (users security / audit / files)", `
      select table_name, column_name from information_schema.columns
      where table_schema='public' and ((table_name='users' and column_name in ('must_change_password','password_changed_at','sessions_valid_after','totp_secret','totp_enabled'))
        or table_name in ('audit_events','files','schema_migrations')) order by 1,2`);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}
main().catch(e => { console.error("inspect failed:", e.message); process.exit(1); });
