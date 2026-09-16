/**
 * One-time data migration: converts September 2026 orders that still use the
 * legacy package system (ats_career, international_career_pro,
 * executive_career_branding) into the new individual-service structure.
 *
 * - Only touches orders created in September 2026 with one of those three
 *   packageType values.
 * - Adds the package's individual services as order_services rows, skipping
 *   any service name that's already present on the order (existing add-ons
 *   are preserved untouched, never duplicated).
 * - Sets numberOfRevisions + remainingRevisions (equal, since no revisions
 *   have been used yet) and supportPeriod per the package mapping.
 * - Clears packageType so the order stops displaying as a package and
 *   behaves like any other service-based order.
 * - Never touches client info, payments, designer, status, dates, or any
 *   other order field. Never deletes anything.
 * - Idempotent: clearing packageType removes the order from the WHERE
 *   clause, so re-running finds nothing left to convert.
 *
 * Usage:
 *   npx tsx script/migrate-september-packages.ts            (dry run — prints the plan only)
 *   npx tsx script/migrate-september-packages.ts --apply     (actually writes the changes)
 */
import { pool, db } from "../server/db";
import { orders, orderServices } from "../shared/schema";
import { and, eq, gte, inArray, lt } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

type PackageDef = {
  services: string[];
  numberOfRevisions: number;
  supportPeriod: string;
};

const PACKAGE_MAP: Record<string, PackageDef> = {
  ats_career: {
    services: ["ATS CV", "Cover Letter (Professional)", "LinkedIn Profile"],
    numberOfRevisions: 3,
    supportPeriod: "1_month", // "30 Days" under the old option set — the current option set's closest equivalent
  },
  international_career_pro: {
    services: [
      "ATS CV", "Cover Letter (Professional)", "LinkedIn Profile",
      "Indeed Profile", "Naukri Gulf Profile", "Bio Statement", "Contact Card",
    ],
    numberOfRevisions: 3,
    supportPeriod: "3_months",
  },
  executive_career_branding: {
    services: [
      "ATS CV", "Infographics Resume", "Cover Letter (Professional)", "LinkedIn Profile",
      "Indeed Profile", "Naukri Gulf Profile", "Bio Statement", "Contact Card", "Interview Prep Guide",
    ],
    numberOfRevisions: 4,
    supportPeriod: "6_months",
  },
};

async function main() {
  const packageKeys = Object.keys(PACKAGE_MAP);
  const targetOrders = await db.select().from(orders).where(
    and(
      inArray(orders.packageType, packageKeys),
      gte(orders.createdAt, new Date("2026-09-01T00:00:00Z")),
      lt(orders.createdAt, new Date("2026-10-01T00:00:00Z")),
    ),
  );

  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: found ${targetOrders.length} September order(s) to convert.\n`);

  let totalServicesAdded = 0;

  for (const order of targetOrders) {
    const def = PACKAGE_MAP[order.packageType!];
    if (!def) continue;

    const existingServices = await db.select().from(orderServices).where(eq(orderServices.orderId, order.id));
    const existingNames = new Set(existingServices.map(s => s.serviceType));
    const toAdd = def.services.filter(name => !existingNames.has(name));

    console.log(`Order ${order.orderNumber || order.id} (${order.packageType}) — client: ${order.clientName}`);
    console.log(`  existing add-ons: ${existingServices.map(s => s.serviceType).join(", ") || "none"}`);
    console.log(`  services to add:  ${toAdd.join(", ") || "none (all already present)"}`);
    console.log(`  numberOfRevisions -> ${def.numberOfRevisions}, remainingRevisions -> ${def.numberOfRevisions}, supportPeriod -> ${def.supportPeriod}`);
    console.log(`  packageType -> null\n`);

    totalServicesAdded += toAdd.length;

    if (APPLY) {
      await db.transaction(async (tx) => {
        if (toAdd.length > 0) {
          await tx.insert(orderServices).values(
            toAdd.map(serviceType => ({ orderId: order.id, serviceType, quantity: 1, instructions: null })),
          );
        }
        await tx.update(orders).set({
          packageType: null,
          numberOfRevisions: def.numberOfRevisions,
          remainingRevisions: def.numberOfRevisions,
          supportPeriod: def.supportPeriod as any,
        }).where(eq(orders.id, order.id));
      });
    }
  }

  console.log(`${APPLY ? "Applied" : "Would apply"}: ${targetOrders.length} order(s) converted, ${totalServicesAdded} service row(s) ${APPLY ? "inserted" : "would be inserted"}.`);
  if (!APPLY) console.log("\nThis was a dry run — nothing was written. Re-run with --apply to commit these changes.");
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(async () => { await pool.end(); });
