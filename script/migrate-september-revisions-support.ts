/**
 * One-time data migration: fills in missing Revisions / Support Period on
 * existing September 2026 orders that don't have them set yet.
 *
 * Only fills fields that are currently NULL — never overwrites an order that
 * already has an explicit value (including package-converted orders from the
 * earlier migration, which already have both fields populated and are
 * therefore skipped entirely). Safe to re-run: filling only NULLs makes it
 * naturally idempotent.
 *
 * Rule (applied per missing field independently):
 *   - Resume Distribution orders never get numberOfRevisions/remainingRevisions
 *     (not applicable), only supportPeriod if missing.
 *   - 1-2 services on the order -> revision limit 2, support 15 Days
 *   - 3+ services on the order  -> revision limit 3, support 1 Month
 *   - remainingRevisions is only initialized when it is ALSO currently NULL
 *     (never overwrites a manually-tracked remaining count).
 *
 * Usage:
 *   npx tsx script/migrate-september-revisions-support.ts            (dry run)
 *   npx tsx script/migrate-september-revisions-support.ts --apply    (writes changes)
 */
import { pool, db } from "../server/db";
import { orders, orderServices } from "../shared/schema";
import { and, eq, gte, lt } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

async function main() {
  const septOrders = await db.select().from(orders).where(
    and(
      gte(orders.createdAt, new Date("2026-09-01T00:00:00Z")),
      lt(orders.createdAt, new Date("2026-10-01T00:00:00Z")),
    ),
  );

  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: scanning ${septOrders.length} September order(s).\n`);

  let revisionsFilled = 0;
  let supportFilled = 0;
  let skipped = 0;

  for (const order of septOrders) {
    const needsRevisions = order.orderType !== "resume_distribution" && order.numberOfRevisions == null;
    const needsSupport = order.supportPeriod == null;
    if (!needsRevisions && !needsSupport) {
      skipped++;
      continue;
    }

    const services = await db.select().from(orderServices).where(eq(orderServices.orderId, order.id));
    const totalServices = services.reduce((acc, s) => acc + (s.quantity || 1), 0);
    const isSmall = totalServices <= 2;
    const ruleRevisionLimit = isSmall ? 2 : 3;
    const ruleSupport = isSmall ? "15_days" : "1_month";

    const updates: { numberOfRevisions?: number; remainingRevisions?: number; supportPeriod?: string } = {};
    if (needsRevisions) {
      updates.numberOfRevisions = ruleRevisionLimit;
      if (order.remainingRevisions == null) updates.remainingRevisions = ruleRevisionLimit;
    }
    if (needsSupport) {
      updates.supportPeriod = ruleSupport;
    }

    console.log(`Order ${order.orderNumber || order.id} (${order.orderType}, ${totalServices} service${totalServices === 1 ? "" : "s"})`);
    console.log(`  current: numberOfRevisions=${order.numberOfRevisions}, remainingRevisions=${order.remainingRevisions}, supportPeriod=${order.supportPeriod}`);
    console.log(`  filling: ${JSON.stringify(updates)}\n`);

    if (needsRevisions) revisionsFilled++;
    if (needsSupport) supportFilled++;

    if (APPLY) {
      await db.update(orders).set(updates as any).where(eq(orders.id, order.id));
    }
  }

  console.log(`${APPLY ? "Applied" : "Would apply"}: revisions filled on ${revisionsFilled} order(s), support period filled on ${supportFilled} order(s). ${skipped} order(s) already had both and were left untouched.`);
  if (!APPLY) console.log("\nThis was a dry run — nothing was written. Re-run with --apply to commit these changes.");
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(async () => { await pool.end(); });
