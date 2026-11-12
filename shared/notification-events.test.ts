import assert from "node:assert/strict";
import test from "node:test";
import {
  EVENT_CATEGORY, NOTIFIABLE_EVENTS, NOTIFICATION_CATEGORY_INFO, SOUND_EVENTS, notificationCategories,
  categoriesForRole, isWithinQuietHours, businessMinutesOfDay, shortName, rs, rsFromPaisa,
} from "./notification-events";

test("every event belongs to a known category", () => {
  for (const e of NOTIFIABLE_EVENTS) assert.ok(notificationCategories.includes(EVENT_CATEGORY[e]), e);
  for (const c of notificationCategories) assert.ok(NOTIFICATION_CATEGORY_INFO[c].roles.length > 0, c);
});

test("sound only for the matrix events: new order, payment to verify, assigned to you", () => {
  assert.deepEqual([...SOUND_EVENTS].map(e => EVENT_CATEGORY[e]).sort(), ["new_order", "new_order", "order_assigned", "payment_submitted"]);
  assert.equal(SOUND_EVENTS.has("refund_requested"), false);
  assert.equal(SOUND_EVENTS.has("complaint_created_by_support"), false);
});

test("settings show only the categories a role can receive", () => {
  assert.ok(categoriesForRole("admin").includes("daily_summary"));
  assert.ok(!categoriesForRole("support").includes("daily_summary"));
  assert.ok(categoriesForRole("designer").includes("order_assigned"));
  assert.ok(!categoriesForRole("designer").includes("payment_submitted"));
  assert.ok(!categoriesForRole("admin").includes("order_assigned"));
});

test("quiet hours use Pakistan time and can wrap midnight", () => {
  // 2026-11-12 18:30 UTC = 23:30 PKT
  const lateNight = new Date("2026-11-12T18:30:00Z");
  assert.equal(businessMinutesOfDay(lateNight), 23 * 60 + 30);
  assert.equal(isWithinQuietHours(22 * 60, 8 * 60, lateNight), true);
  // 05:00 UTC = 10:00 PKT
  const morning = new Date("2026-11-12T05:00:00Z");
  assert.equal(isWithinQuietHours(22 * 60, 8 * 60, morning), false);
  assert.equal(isWithinQuietHours(9 * 60, 17 * 60, morning), true);
  assert.equal(isWithinQuietHours(null, null, lateNight), false);
  assert.equal(isWithinQuietHours(600, 600, lateNight), false);
});

test("message helpers: short client name and rupees", () => {
  assert.equal(shortName("Ahmed Raza Khan"), "Ahmed R.");
  assert.equal(shortName("Ahmed"), "Ahmed");
  assert.equal(shortName("  "), "Client");
  assert.equal(rs(19000), "Rs 19,000");
  assert.equal(rsFromPaisa(100000), "Rs 1,000");
  assert.equal(["🛒 New order", [rs(19000), "11.11 Bundle", shortName("Ahmed Raza")].join(" · ")].join(" · "),
    "🛒 New order · Rs 19,000 · 11.11 Bundle · Ahmed R.");
});
