/**
 * Shared "place an approved order" logic. Used by the Orders page
 * (POST /api/orders, admin) and by Website Requests (Verify & place order), so
 * both paths get the same order number allocation, order/services rows,
 * activity log and designer assignment. Runs inside the caller's transaction.
 */
import { orders, orderServices, activityLogs, type Order, type InsertOrder, type InsertOrderService } from "@shared/schema";
import { storage } from "./storage";

export type PlaceOrderInput = {
  order: Omit<InsertOrder, "orderNumber" | "status" | "advancePaymentStatus" | "createdById" | "assignedToId" | "intendedDesignerId" | "remainingAmount" | "paymentStatus" | "advanceAmount"> & {
    advanceAmount?: number | null;
  };
  services: Omit<InsertOrderService, "orderId">[];
  designerId?: number | null;
  actorId: number;
  /** Extra details stored on the order_created activity entry. */
  source?: Record<string, unknown>;
};

/**
 * Creates an admin-approved order: allocates the next PX number (advisory
 * locked, so concurrent placements never collide), stores the order + services,
 * and logs creation/assignment. `tx` must be a drizzle transaction.
 */
export async function placeApprovedOrderTx(tx: any, input: PlaceOrderInput): Promise<Order> {
  const totalPrice = Number(input.order.totalPrice || 0);
  const advanceAmount = Math.max(0, Number(input.order.advanceAmount || 0));
  const remainingAmount = Math.max(0, totalPrice - advanceAmount);
  const designerId = input.designerId || null;
  const orderNumber = await storage.generateOrderNumber(tx);

  // Meta tracking columns are server-owned; never accept them from a request body.
  const { metaEventId: _m1, metaStatus: _m2, metaPurchaseSentAt: _m3, ...orderFields } = input.order as any;
  const [order] = await tx.insert(orders).values({
    ...orderFields,
    totalPrice,
    advanceAmount,
    remainingAmount,
    paymentStatus: remainingAmount === 0 ? "paid" : "pending",
    assignedToId: designerId,
    intendedDesignerId: designerId,
    advancePaymentStatus: "approved",
    orderNumber,
    createdById: input.actorId,
    status: "new",
  }).returning();

  if (input.services.length > 0) {
    await tx.insert(orderServices).values(input.services.map(svc => ({ ...svc, orderId: order.id })));
  }

  await tx.insert(activityLogs).values({
    orderId: order.id,
    actorId: input.actorId,
    activityType: "order_created",
    newValue: "new",
    ...(input.source ? { details: input.source } : {}),
  });
  if (designerId) {
    const designer = await storage.getUser(designerId);
    await tx.insert(activityLogs).values({
      orderId: order.id,
      actorId: input.actorId,
      activityType: "assignment",
      newValue: String(designerId),
      details: {
        previousDesigner: null,
        newDesigner: designer ? { id: designer.id, name: designer.name, role: designer.role, title: designer.title, avatar: designer.avatar } : null,
      },
    });
  }
  return order;
}
