/** Rule 0 check: exact row count of every table in public + website. Read-only. */
import pg from "pg";
import { sslConfigFor, stripSslParams } from "../server/dbSsl";
const url = process.env.SUPABASE_DATABASE_URL!;
const c = new pg.Client({ connectionString: stripSslParams(url), ssl: sslConfigFor(url) });
await c.connect();
await c.query("begin read only");
const t = await c.query(`select table_schema s, table_name t from information_schema.tables where table_schema in ('public','website') and table_type='BASE TABLE' order by 1,2`);
const out: Record<string, number> = {};
for (const r of t.rows) out[`${r.s}.${r.t}`] = Number((await c.query(`select count(*) n from "${r.s}"."${r.t}"`)).rows[0].n);
await c.query("rollback"); await c.end();
console.log(JSON.stringify(out));
