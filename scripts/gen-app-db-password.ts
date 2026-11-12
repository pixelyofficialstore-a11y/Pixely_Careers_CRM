// Generates CRM_APP_DB_PASSWORD into .env (only if missing). Prints nothing secret.
import fs from "node:fs";
import { randomBytes } from "node:crypto";

const envPath = ".env";
const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
if (/^CRM_APP_DB_PASSWORD=.+$/m.test(env)) {
  console.log("CRM_APP_DB_PASSWORD already set in .env (unchanged).");
} else {
  const pw = randomBytes(30).toString("base64url");
  fs.appendFileSync(envPath, `${env.endsWith("\n") || env === "" ? "" : "\n"}CRM_APP_DB_PASSWORD=${pw}\n`);
  console.log("CRM_APP_DB_PASSWORD written to .env (value not shown).");
}
