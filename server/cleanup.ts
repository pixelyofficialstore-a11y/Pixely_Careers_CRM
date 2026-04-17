import { lt, ne } from "drizzle-orm";
import { db } from "./db";
import { notifications, paymentVerifications } from "../shared/schema";

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

async function runCleanup() {
  const cutoff = new Date(Date.now() - FIVE_DAYS_MS);
  try {
    const deletedNotifs = await db
      .delete(notifications)
      .where(lt(notifications.createdAt, cutoff));

    const deletedPayments = await db
      .delete(paymentVerifications)
      .where(
        lt(paymentVerifications.createdAt, cutoff)
      );

    console.log(
      `[cleanup] Removed old records: notifications=${deletedNotifs.rowCount ?? 0}, payment_verifications=${deletedPayments.rowCount ?? 0}`
    );
  } catch (err) {
    console.error("[cleanup] Error during cleanup:", err);
  }
}

export function startCleanupJob() {
  runCleanup();
  setInterval(runCleanup, 24 * 60 * 60 * 1000);
}
