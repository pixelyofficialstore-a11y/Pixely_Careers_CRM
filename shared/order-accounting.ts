export type OrderAccountingInput = {
  status?: string | null;
  advanceAmount?: number | null;
  remainingAmount?: number | null;
  advanceRefunded?: boolean | null;
  refundAmount?: number | null;
};

export type PaymentApprovalInput = {
  paymentType: "advance" | "full" | "remaining";
  amount: number;
};

const money = (value: number | null | undefined) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
};

export function getOrderAccounting(order: OrderAccountingInput) {
  const advance = money(order.advanceAmount);
  const remaining = money(order.remainingAmount);
  const canceled = order.status === "canceled";
  const refunded = canceled && order.advanceRefunded === true;
  const refund = refunded ? Math.min(advance, money(order.refundAmount)) : 0;
  const netCollected = Math.max(0, advance - refund);
  const remainingReceivable = canceled ? 0 : remaining;

  return {
    netCollected,
    remainingReceivable,
    accountedTotal: netCollected + remainingReceivable,
  };
}

export function getPaymentApprovalConflict(
  order: OrderAccountingInput & { advancePaymentStatus?: string | null },
  payment: PaymentApprovalInput,
) {
  if (order.status === "canceled") return "Canceled orders cannot receive approved payments";
  if (payment.paymentType === "remaining") {
    return money(payment.amount) > money(order.remainingAmount)
      ? "Payment amount exceeds the current remaining balance"
      : null;
  }
  return order.status !== "pending_payment" || order.advancePaymentStatus === "approved"
    ? "The initial payment for this order was already approved"
    : null;
}