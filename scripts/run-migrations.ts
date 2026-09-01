import { runMigrations } from "../server/migrate";

runMigrations()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[post-merge] Migration failed:", error);
    process.exit(1);
  });