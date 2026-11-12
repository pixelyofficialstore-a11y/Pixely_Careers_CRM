import assert from "node:assert/strict";
import test from "node:test";
import {
  mapLegacyStatus, storedOrMappedWorkStatus, effectiveWorkStatus, paymentStateOf, deliveryDaysFor,
  effectiveDueAt, isOverdue, supportEndsAt, WORK_TO_LEGACY, LEGACY_TO_WORK, workStatuses,
} from "./order-process";
import { getOrderAccounting } from "./order-accounting";

test("old statuses map to the owner-approved work statuses", () => {
  assert.equal(mapLegacyStatus("pending_payment"), "request");
  assert.equal(mapLegacyStatus("new"), "confirmed");
  assert.equal(mapLegacyStatus("working"), "in_progress");
  assert.equal(mapLegacyStatus("ready"), "draft_sent");
  assert.equal(mapLegacyStatus("delivered"), "delivered");
  assert.equal(mapLegacyStatus("canceled"), "canceled");
});

test("every work status maps back to an old status that maps forward again (except revisions)", () => {
  for (const ws of workStatuses) {
    const legacy = WORK_TO_LEGACY[ws];
    assert.ok(legacy, ws);
    if (ws !== "revisions") assert.equal(LEGACY_TO_WORK[legacy], ws);
  }
  assert.equal(WORK_TO_LEGACY.revisions, "ready");
});

test("a stored work status is used only while it agrees with the old status", () => {
  assert.equal(storedOrMappedWorkStatus({ status: "ready", workStatus: "revisions" }), "revisions");
  assert.equal(storedOrMappedWorkStatus({ status: "ready", workStatus: null }), "draft_sent");
  // An older code path changed status only: fall back to the mapping.
  assert.equal(storedOrMappedWorkStatus({ status: "delivered", workStatus: "revisions" }), "delivered");
  assert.equal(storedOrMappedWorkStatus({ status: "new", workStatus: "bogus" }), "confirmed");
});

test("closed is computed when a delivered order's support period has ended", () => {
  const createdAt = new Date("2026-01-01T10:00:00Z");
  const now = new Date("2026-03-01T00:00:00Z");
  assert.equal(effectiveWorkStatus({ status: "delivered", createdAt, supportPeriod: "1_month" }, now), "closed");
  assert.equal(effectiveWorkStatus({ status: "delivered", createdAt, supportPeriod: "3_months" }, now), "delivered");
  assert.equal(effectiveWorkStatus({ status: "delivered", createdAt, supportPeriod: null }, now), "delivered");
  assert.equal(effectiveWorkStatus({ status: "working", createdAt, supportPeriod: "15_days" }, now), "in_progress");
  assert.equal(supportEndsAt({ createdAt, supportPeriod: "15_days" })?.toISOString(), "2026-01-16T10:00:00.000Z");
});

test("payment status is computed from payments and refunds", () => {
  assert.equal(paymentStateOf({ advanceAmount: 0, remainingAmount: 5000 }), "unpaid");
  assert.equal(paymentStateOf({ advanceAmount: 2000, remainingAmount: 3000 }), "advance_paid");
  assert.equal(paymentStateOf({ advanceAmount: 5000, remainingAmount: 0 }), "fully_paid");
  assert.equal(paymentStateOf({ advanceAmount: 5000, remainingAmount: 0 }, 1000), "partially_refunded");
  assert.equal(paymentStateOf({ advanceAmount: 5000, remainingAmount: 0 }, 5000), "refunded");
  // Legacy cancel refund still counts.
  assert.equal(paymentStateOf({ status: "canceled", advanceAmount: 5000, advanceRefunded: true, refundAmount: 5000 }), "refunded");
  assert.equal(paymentStateOf({ status: "canceled", advanceAmount: 5000, remainingAmount: 3000, advanceRefunded: false, refundAmount: 0 }), "advance_paid");
});

test("refund records reduce net collected but never below zero", () => {
  assert.equal(getOrderAccounting({ advanceAmount: 5000, remainingAmount: 0 }, 2000).netCollected, 3000);
  assert.equal(getOrderAccounting({ advanceAmount: 5000, remainingAmount: 0 }, 9000).netCollected, 0);
  assert.equal(getOrderAccounting({ status: "canceled", advanceAmount: 5000, advanceRefunded: true, refundAmount: 3000 }, 2000).netCollected, 0);
});

test("delivery days follow the owner's defaults, with package settings overriding", () => {
  assert.equal(deliveryDaysFor("ats_career", "documentation"), 2);
  assert.equal(deliveryDaysFor("international_career_pro", "documentation"), 2);
  assert.equal(deliveryDaysFor("executive_career_branding", "documentation"), 3);
  assert.equal(deliveryDaysFor("executive_bundle", "documentation"), 5);
  assert.equal(deliveryDaysFor(null, "portfolio_website"), 5);
  assert.equal(deliveryDaysFor(null, "resume_distribution"), 30);
  assert.equal(deliveryDaysFor("custom", "documentation"), 3);
  assert.equal(deliveryDaysFor(null, "documentation"), 3);
  assert.equal(deliveryDaysFor("ats_career", "documentation", new Map([["ats_career", 4]])), 4);
  assert.equal(deliveryDaysFor("ats_career", "documentation", new Map([["ats_career", null]])), 2);
});

test("due date: stored on new orders, computed for old ones; overdue only while Confirmed or In progress", () => {
  const createdAt = new Date("2026-11-01T00:00:00Z");
  const computed = effectiveDueAt({ createdAt, packageType: "ats_career", orderType: "documentation" });
  assert.equal(computed?.toISOString(), "2026-11-03T00:00:00.000Z");
  const stored = new Date("2026-11-10T00:00:00Z");
  assert.equal(effectiveDueAt({ dueAt: stored, createdAt, packageType: "ats_career" })?.toISOString(), stored.toISOString());
  const now = new Date("2026-11-05T00:00:00Z");
  assert.equal(isOverdue("in_progress", computed, now), true);
  assert.equal(isOverdue("confirmed", computed, now), true);
  assert.equal(isOverdue("draft_sent", computed, now), false);
  assert.equal(isOverdue("delivered", computed, now), false);
  assert.equal(isOverdue("request", computed, now), false);
  assert.equal(isOverdue("in_progress", stored, now), false);
});
