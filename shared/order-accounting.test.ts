import assert from "node:assert/strict";
import test from "node:test";
import { getOrderAccounting, getPaymentApprovalConflict } from "./order-accounting";

test("an active order keeps collected and receivable amounts", () => {
  assert.deepEqual(getOrderAccounting({
    status: "working",
    advanceAmount: 4_000,
    remainingAmount: 6_000,
  }), {
    netCollected: 4_000,
    remainingReceivable: 6_000,
    accountedTotal: 10_000,
  });
});

test("a canceled order with a retained advance keeps only that advance collected", () => {
  assert.deepEqual(getOrderAccounting({
    status: "canceled",
    advanceAmount: 4_000,
    remainingAmount: 6_000,
    advanceRefunded: false,
    refundAmount: 0,
  }), {
    netCollected: 4_000,
    remainingReceivable: 0,
    accountedTotal: 4_000,
  });
});

test("a canceled order with a refunded advance has zero collected and receivable", () => {
  assert.deepEqual(getOrderAccounting({
    status: "canceled",
    advanceAmount: 4_000,
    remainingAmount: 6_000,
    advanceRefunded: true,
    refundAmount: 4_000,
  }), {
    netCollected: 0,
    remainingReceivable: 0,
    accountedTotal: 0,
  });
});

test("a second remaining approval cannot exceed the locked current balance", () => {
  assert.equal(getPaymentApprovalConflict({
    status: "working",
    remainingAmount: 2_000,
  }, {
    paymentType: "remaining",
    amount: 8_000,
  }), "Payment amount exceeds the current remaining balance");
});

test("a duplicate initial approval cannot reopen an already approved order", () => {
  assert.equal(getPaymentApprovalConflict({
    status: "new",
    advancePaymentStatus: "approved",
  }, {
    paymentType: "advance",
    amount: 4_000,
  }), "The initial payment for this order was already approved");
});