import { defineConfig } from "drizzle-kit";

// Rule 0: the database is live production. drizzle-kit may only GENERATE SQL for
// review; push/drop/migrate are blocked. Reviewed SQL lives in migrations/ and is
// applied with `pnpm db:migrate` after written owner approval.
const blocked = ["push", "drop", "migrate", "up"];
if (process.argv.some(arg => blocked.includes(arg))) {
  throw new Error("drizzle-kit push/drop/migrate are forbidden (Rule 0). Use reviewed SQL in migrations/.");
}

const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "postgres://unused";

export default defineConfig({
  out: "./drizzle-generated",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
