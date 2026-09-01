import { 
  users, orders, notifications, orderServices, paymentVerifications, supportDesignerAssignments,
  servicesCatalog, packageConfigs, platformsCatalog, complaintCategoryConfigs, pushSubscriptions, activityLogs, complaints, complaintNotes, clientReviews, clientSuggestions, suggestionNotes,
  type User, type InsertUser, type Order, type InsertOrder,
  type OrderService, type InsertOrderService, type OrderWithServices,
  type PaymentVerification, type InsertPaymentVerification, type PaymentVerificationWithUsers,
  type Notification, type SupportDesignerAssignment,
  type ServiceCatalogItem, type InsertServiceCatalogItem,
  type PackageConfig, type InsertPackageConfig,
  type PlatformCatalogItem, type InsertPlatformCatalogItem,
  type ComplaintCategoryConfig, type InsertComplaintCategoryConfig,
  type PushSubscription, type Complaint, type InsertComplaint, type ComplaintResponse, type ComplaintNote, type ComplaintNoteResponse,
  type ComplaintHistoryEntry, type ComplaintStats,
  type InsertActivityLog, type ActivityLog,
  type ClientReview, type InsertClientReview, type ClientSuggestion, type InsertClientSuggestion, type ActivityLogWithActor, type SuggestionNote,
} from "@shared/schema";
import { db } from "./db";
import { eq, ne, desc, sql, and, isNotNull, inArray, asc } from "drizzle-orm";
import { getStartOfBusinessDay, getStartOfBusinessMonth } from "@shared/business-time";
import { getOrderAccounting } from "@shared/order-accounting";
import { canAccessComplaintCase, type CaseRole } from "@shared/case-access";

export type ComplaintListFilters = {
  search?: string;
  status?: string;
  category?: string;
  orderId?: number;
  designerId?: number;
  month?: number;
  year?: number;
};

export type OrderCancellation = {
  reason: string;
  advanceRefunded: boolean;
  actorId: number;
  expectedStatus?: string;
  complaintId?: number;
  complaintNumber?: string;
};

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User>;
  getUsers(): Promise<User[]>;

  getOrder(id: number): Promise<OrderWithServices | undefined>;
  getOrders(role: string, userId: number): Promise<OrderWithServices[]>;
  createOrder(order: InsertOrder, services?: Omit<InsertOrderService, 'orderId'>[]): Promise<Order>;
  updateOrder(id: number, updates: Partial<InsertOrder>): Promise<Order>;
  cancelOrder(id: number, cancellation: OrderCancellation): Promise<Order | undefined>;
  getOrderServices(orderId: number): Promise<OrderService[]>;
  createOrderService(service: InsertOrderService): Promise<OrderService>;
  replaceOrderServices(orderId: number, services: Omit<InsertOrderService, 'orderId'>[]): Promise<void>;
  deleteOrder(id: number): Promise<void>;
  generateOrderNumber(): Promise<string>;

  getNotifications(userId: number): Promise<Notification[]>;
  markNotificationRead(id: number, userId: number): Promise<Notification | undefined>;
  createNotification(userId: number, type: string, title: string, message: string, priority: string, relatedId?: number, relatedType?: string): Promise<{ notification: Notification; created: boolean }>;

  getStats(role: string, userId: number, complaintFilters?: ComplaintListFilters): Promise<any>;

  getPaymentVerifications(role: string, userId: number): Promise<PaymentVerificationWithUsers[]>;
  getPaymentVerificationsByOrder(orderId: number): Promise<PaymentVerificationWithUsers[]>;
  getPaymentVerificationByScreenshotUrl(url: string): Promise<PaymentVerification | undefined>;
  createPaymentVerification(data: InsertPaymentVerification): Promise<PaymentVerification>;
  updatePaymentVerification(id: number, updates: Partial<InsertPaymentVerification>): Promise<PaymentVerification>;

  getDesignerAssignments(supportUserId: number): Promise<SupportDesignerAssignment[]>;
  getAllDesignerAssignments(): Promise<SupportDesignerAssignment[]>;
  setDesignerAssignments(supportUserId: number, designerIds: number[]): Promise<void>;

  getServicesCatalog(): Promise<ServiceCatalogItem[]>;
  createServiceCatalogItem(item: InsertServiceCatalogItem): Promise<ServiceCatalogItem>;
  updateServiceCatalogItem(id: number, updates: Partial<InsertServiceCatalogItem>): Promise<ServiceCatalogItem>;
  deleteServiceCatalogItem(id: number): Promise<void>;

  getPackageConfigs(): Promise<PackageConfig[]>;
  createPackageConfig(pkg: InsertPackageConfig): Promise<PackageConfig>;
  updatePackageConfig(id: number, updates: Partial<InsertPackageConfig>): Promise<PackageConfig>;
  deletePackageConfig(id: number): Promise<void>;

  getPlatformsCatalog(): Promise<PlatformCatalogItem[]>;
  createPlatformCatalogItem(item: InsertPlatformCatalogItem): Promise<PlatformCatalogItem>;
  updatePlatformCatalogItem(id: number, updates: Partial<InsertPlatformCatalogItem>): Promise<PlatformCatalogItem>;
  deletePlatformCatalogItem(id: number): Promise<void>;

  getComplaintCategoryConfigs(): Promise<ComplaintCategoryConfig[]>;
  createComplaintCategoryConfig(item: InsertComplaintCategoryConfig): Promise<ComplaintCategoryConfig>;
  updateComplaintCategoryConfig(id: number, updates: Partial<InsertComplaintCategoryConfig>): Promise<ComplaintCategoryConfig>;
  deleteComplaintCategoryConfig(id: number): Promise<void>;

  getAdmins(): Promise<User[]>;
  getUnreadNotificationCount(userId: number): Promise<number>;
  getActionableComplaintCount(role: string, userId: number): Promise<number>;
  getPendingPaymentCount(): Promise<number>;
  markAllNotificationsRead(userId: number): Promise<void>;

  savePushSubscription(userId: number, endpoint: string, p256dh: string, auth: string): Promise<PushSubscription>;
  deletePushSubscription(endpoint: string): Promise<void>;
  getPushSubscriptionsForUser(userId: number): Promise<PushSubscription[]>;

  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
  getOrderActivity(orderId: number): Promise<ActivityLogWithActor[]>;
  getClientReviews(role: string, userId: number, orderId?: number): Promise<ClientReview[]>;
  getClientReviewByOrder(orderId: number): Promise<ClientReview | undefined>;
  createClientReview(data: InsertClientReview): Promise<ClientReview>;
  updateClientReview(id: number, updates: Partial<InsertClientReview>): Promise<ClientReview>;
  getClientSuggestions(role: string, userId: number, orderId?: number): Promise<ClientSuggestion[]>;
  getClientSuggestion(id: number): Promise<ClientSuggestion | undefined>;
  createClientSuggestion(data: InsertClientSuggestion): Promise<ClientSuggestion>;
  updateClientSuggestion(id: number, updates: Partial<InsertClientSuggestion>): Promise<ClientSuggestion>;
  createComplaint(data: InsertComplaint, actorId: number): Promise<Complaint>;
  getComplaints(role: string, userId: number, filters?: ComplaintListFilters): Promise<ComplaintResponse[]>;
  getComplaintForUser(id: number, role: string, userId: number): Promise<ComplaintResponse | undefined>;
  getComplaintRecord(id: number): Promise<Complaint | undefined>;
  updateComplaint(
    id: number,
    expectedStatus: Complaint["status"],
    updates: Partial<InsertComplaint>,
    historyEvents: InsertActivityLog[],
    cancellation?: OrderCancellation,
  ): Promise<Complaint | undefined>;
  getComplaintHistory(id: number): Promise<ComplaintHistoryEntry[]>;
  getComplaintNotes(id: number): Promise<ComplaintNoteResponse[]>;
  addComplaintNote(id: number, noteText: string, actorId: number): Promise<ComplaintNote>;
  getComplaintStats(role: string, userId: number, filters?: ComplaintListFilters): Promise<ComplaintStats>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User> {
    const [user] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    return user;
  }

  async getUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(users.id);
  }

  async getOrder(id: number): Promise<OrderWithServices | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    if (!order) return undefined;
    const services = await this.getOrderServices(id);
    const allUsers = await this.getUsers();
    const assignee = order.assignedToId ? allUsers.find(u => u.id === order.assignedToId) : null;
    return { ...order, services, assignee };
  }

  async getOrders(role: string, userId: number): Promise<OrderWithServices[]> {
    let orderList: Order[];
    if (role === "admin") {
      orderList = await db.select().from(orders).where(ne(orders.status, "pending_payment")).orderBy(desc(orders.createdAt));
    } else if (role === "support") {
      // Support can view all orders (all months), like admin. Deleting remains admin-only.
      orderList = await db.select().from(orders).where(ne(orders.status, "pending_payment")).orderBy(desc(orders.createdAt));
    } else {
      orderList = await db.select().from(orders).where(and(eq(orders.assignedToId, userId), ne(orders.status, "pending_payment"))).orderBy(desc(orders.createdAt));
    }
    const allServices = await db.select().from(orderServices);
    const allUsers = await this.getUsers();
    return orderList.map(order => ({
      ...order,
      services: allServices.filter(s => s.orderId === order.id),
      assignee: order.assignedToId ? allUsers.find(u => u.id === order.assignedToId) : null
    }));
  }

  async createOrder(order: InsertOrder, services?: Omit<InsertOrderService, 'orderId'>[]): Promise<Order> {
    const [newOrder] = await db.insert(orders).values(order).returning();
    if (services && services.length > 0) {
      for (const svc of services) {
        await this.createOrderService({ ...svc, orderId: newOrder.id });
      }
    }
    return newOrder;
  }

  async updateOrder(id: number, updates: Partial<InsertOrder>): Promise<Order> {
    const [updatedOrder] = await db.update(orders).set(updates).where(eq(orders.id, id)).returning();
    return updatedOrder;
  }

  async cancelOrder(id: number, cancellation: OrderCancellation): Promise<Order | undefined> {
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`);
      const [existing] = await tx.select().from(orders).where(eq(orders.id, id));
      if (!existing || existing.status === "canceled") return undefined;
      if (cancellation.expectedStatus && existing.status !== cancellation.expectedStatus) return undefined;

      const now = new Date();
      const advanceAmount = Math.max(0, Number(existing.advanceAmount || 0));
      const refundAmount = cancellation.advanceRefunded ? advanceAmount : 0;
      const [updated] = await tx.update(orders).set({
        status: "canceled",
        cancellationReason: cancellation.reason,
        canceledByUserId: cancellation.actorId,
        canceledAt: now,
        advanceRefunded: cancellation.advanceRefunded,
        refundAmount,
        refundRecordedByUserId: cancellation.advanceRefunded ? cancellation.actorId : null,
        refundRecordedAt: cancellation.advanceRefunded ? now : null,
      }).where(and(eq(orders.id, id), ne(orders.status, "canceled"))).returning();
      if (!updated) return undefined;

      const complaintDetails = cancellation.complaintId ? {
        complaintId: cancellation.complaintId,
        complaintNumber: cancellation.complaintNumber,
      } : {};
      await tx.insert(activityLogs).values([
        {
          orderId: id,
          actorId: cancellation.actorId,
          activityType: "status_change",
          previousValue: existing.status,
          newValue: "canceled",
          details: {
            ...complaintDetails,
            cancellationReason: cancellation.reason,
            advanceRefunded: cancellation.advanceRefunded,
            refundAmount,
          },
        },
        {
          orderId: id,
          actorId: cancellation.actorId,
          activityType: "payment_change",
          previousValue: "advance_received",
          newValue: cancellation.advanceRefunded ? "refunded" : "retained",
          details: { ...complaintDetails, amount: advanceAmount, cancellation: true },
        },
        {
          orderId: id,
          actorId: cancellation.actorId,
          activityType: "payment_change",
          previousValue: "remaining_receivable",
          newValue: "canceled",
          details: {
            ...complaintDetails,
            amount: Math.max(0, Number(existing.remainingAmount || 0)),
            cancellation: true,
          },
        },
      ]);
      return updated;
    });
  }

  async getOrderServices(orderId: number): Promise<OrderService[]> {
    return await db.select().from(orderServices).where(eq(orderServices.orderId, orderId));
  }

  async createOrderService(service: InsertOrderService): Promise<OrderService> {
    const [newService] = await db.insert(orderServices).values(service).returning();
    return newService;
  }

  async replaceOrderServices(orderId: number, services: Omit<InsertOrderService, 'orderId'>[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(orderServices).where(eq(orderServices.orderId, orderId));
      if (services && services.length > 0) {
        await tx.insert(orderServices).values(services.map(svc => ({ ...svc, orderId })));
      }
    });
  }

  async deleteOrder(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(orderServices).where(eq(orderServices.orderId, id));
      await tx.delete(activityLogs).where(eq(activityLogs.orderId, id));
      await tx.delete(paymentVerifications).where(eq(paymentVerifications.orderId, id));
      await tx.delete(clientReviews).where(eq(clientReviews.orderId, id));
      await tx.delete(clientSuggestions).where(eq(clientSuggestions.orderId, id));
      await tx.delete(notifications).where(and(eq(notifications.relatedId, id), eq(notifications.relatedType, "order")));
      await tx.delete(orders).where(eq(orders.id, id));
    });
  }

  async generateOrderNumber(): Promise<string> {
    const year = new Date().getFullYear().toString().slice(-2);
    const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
    const existing = await db.select({ orderNumber: orders.orderNumber }).from(orders).where(isNotNull(orders.orderNumber));
    
    // Find the highest sequence number across ALL existing order numbers (not count-based — avoids duplicates on gaps/deletions)
    let maxSeq = 0;
    for (const o of existing) {
      const match = o.orderNumber?.match(/PX-\d{4}-(\d+)/);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    }
    
    return `PX-${year}${month}-${(maxSeq + 1).toString().padStart(3, '0')}`;
  }

  async getNotifications(userId: number): Promise<Notification[]> {
    return await db.select().from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt));
  }

  async markNotificationRead(id: number, userId: number): Promise<Notification | undefined> {
    const [notification] = await db.update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning();
    return notification;
  }

  async createNotification(userId: number, type: string, title: string, message: string, priority: string, relatedId?: number, relatedType?: string): Promise<{ notification: Notification; created: boolean }> {
    const dedupeKey = [type, title, message, relatedType || "", relatedId ?? ""].join("::");
    const [existing] = await db.select().from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.dedupeKey, dedupeKey)))
      .limit(1);
    if (existing) return { notification: existing, created: false };
    try {
      const [notification] = await db.insert(notifications).values({
        userId,
        type,
        title,
        message,
        priority,
        relatedId,
        relatedType,
        dedupeKey,
      }).returning();
      return { notification, created: true };
    } catch (error: any) {
      // A concurrent retry may win the unique (recipient, dedupe key) race.
      if (error?.code !== "23505") throw error;
      const [notification] = await db.select().from(notifications)
        .where(and(eq(notifications.userId, userId), eq(notifications.dedupeKey, dedupeKey)))
        .limit(1);
      if (!notification) throw error;
      return { notification, created: false };
    }
  }

  async getStats(role: string, userId: number, complaintFilters: ComplaintListFilters = {}): Promise<any> {
    const allOrdersRaw = await db.select().from(orders);
    const allOrders = allOrdersRaw.filter(o => o.advancePaymentStatus === 'approved');
    // Canceled orders retain original amounts for audit. Their accounting
    // projection decides whether an advance was refunded or retained.
    const collectedOrderIds = new Set(allOrders.filter(order => getOrderAccounting(order).netCollected > 0).map(order => order.id));
    const allPaymentVerifications = await db.select().from(paymentVerifications);
    const allUsers = await db.select().from(users);
    
    const today = getStartOfBusinessDay();
    const todayOrders = allOrders.filter(o => new Date(o.createdAt!) >= today);
    const thisMonth = getStartOfBusinessMonth();
    const monthlyOrders = allOrders.filter(o => new Date(o.createdAt!) >= thisMonth);
    
    const orderStats = {
      total: allOrders.length,
      today: todayOrders.length,
      monthly: monthlyOrders.length,
      new: allOrders.filter(o => o.status === 'new').length,
      working: allOrders.filter(o => o.status === 'working').length,
      ready: allOrders.filter(o => o.status === 'ready').length,
      delivered: allOrders.filter(o => o.status === 'delivered').length,
      canceled: allOrders.filter(o => o.status === 'canceled').length,
    };

    const totalRevenue = allOrders.reduce((acc, order) => acc + getOrderAccounting(order).netCollected, 0);
    const pendingPayments = allOrders.reduce((acc, order) => acc + getOrderAccounting(order).remainingReceivable, 0);
    const adminUserIds = new Set(allUsers.filter(user => user.role === "admin").map(user => user.id));
    const allOrderIds = new Set(allOrders.map(order => order.id));
    const approvedPaymentsThisMonth = allPaymentVerifications.filter(payment =>
      payment.status === "approved" &&
      allOrderIds.has(payment.orderId) &&
      payment.reviewedAt &&
      new Date(payment.reviewedAt) >= thisMonth
    );
    const paymentTotalsByOrderThisMonth = new Map<number, number>();
    const initialPaymentOrderIdsThisMonth = new Set<number>();
    for (const payment of approvedPaymentsThisMonth) {
      paymentTotalsByOrderThisMonth.set(
        payment.orderId,
        (paymentTotalsByOrderThisMonth.get(payment.orderId) || 0) + (payment.amount || 0),
      );
      if (payment.paymentType === "advance" || payment.paymentType === "full") {
        initialPaymentOrderIdsThisMonth.add(payment.orderId);
      }
    }
    // Admin-created orders are auto-approved without a payment verification
    // row. Count only the amount not already represented by payment events.
    const directAdminCashInflowThisMonth = monthlyOrders
      .filter(order =>
        adminUserIds.has(order.createdById || -1) &&
        order.createdAt &&
        new Date(order.createdAt) >= thisMonth &&
        !initialPaymentOrderIdsThisMonth.has(order.id)
      )
      .reduce((sum, order) => sum + Math.max(
        0,
        Number(order.advanceAmount || 0) - (paymentTotalsByOrderThisMonth.get(order.id) || 0),
      ), 0);
    const paymentCashInflowThisMonth = approvedPaymentsThisMonth
      .reduce((sum, payment) => sum + (payment.amount || 0), 0);
    const cashInflowThisMonth = paymentCashInflowThisMonth + directAdminCashInflowThisMonth;
    const refundsThisMonth = allOrders
      .filter(order =>
        order.status === "canceled" &&
        Number(order.refundAmount || 0) > 0 &&
        order.refundRecordedAt &&
        new Date(order.refundRecordedAt) >= thisMonth
      )
      .reduce((sum, order) => sum + Number(order.refundAmount || 0), 0);
    const approvedPaymentsToday = allPaymentVerifications.filter(payment =>
      payment.status === "approved" &&
       collectedOrderIds.has(payment.orderId) &&
      payment.reviewedAt &&
      new Date(payment.reviewedAt) >= today
    );
    const approvedAdvancePaymentsToday = approvedPaymentsToday
      .filter(payment => payment.paymentType === "advance" || payment.paymentType === "full")
    const verifiedAdvanceOrderIdsToday = new Set(approvedAdvancePaymentsToday.map(payment => payment.orderId));
    const verifiedAdvanceToday = approvedAdvancePaymentsToday
      .reduce((sum, payment) => sum + (payment.amount || 0), 0);
    const directAdminAdvanceToday = allOrders
      .filter(order =>
        adminUserIds.has(order.createdById || -1) &&
        order.createdAt &&
        new Date(order.createdAt) >= today &&
        getOrderAccounting(order).netCollected > 0 &&
        !verifiedAdvanceOrderIdsToday.has(order.id)
      )
      .reduce((sum, order) => sum + getOrderAccounting(order).netCollected, 0);
    const remainingReceivedToday = approvedPaymentsToday
      .filter(payment => payment.paymentType === "remaining")
      .reduce((sum, payment) => sum + (payment.amount || 0), 0);
    const advanceReceivedToday = verifiedAdvanceToday + directAdminAdvanceToday;

    return {
      orders: orderStats,
      complaints: await this.getComplaintStats(role, userId, complaintFilters),
      finance: {
        totalRevenue,
        monthlyRevenue: monthlyOrders.reduce((acc, order) => acc + getOrderAccounting(order).netCollected, 0),
        pendingPayments,
        todayCashFlow: {
          advance: advanceReceivedToday,
          remaining: remainingReceivedToday,
          total: advanceReceivedToday + remainingReceivedToday,
        },
        monthlyCashFlow: {
          inflow: cashInflowThisMonth,
          refunds: refundsThisMonth,
          net: cashInflowThisMonth - refundsThisMonth,
        },
      },
    };
  }

  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const [created] = await db.insert(activityLogs).values(log).returning();
    return created;
  }

  async getOrderActivity(orderId: number): Promise<ActivityLogWithActor[]> {
    const logs = (await db.select().from(activityLogs).where(eq(activityLogs.orderId, orderId)).orderBy(desc(activityLogs.createdAt)))
      .filter(log => {
        const details = (log.details || {}) as Record<string, unknown>;
        return !(log.activityType === "review_updated" && typeof details.event === "string" && details.event.includes("review_progress"));
      });
    const usersById = new Map((await this.getUsers()).map(user => [user.id, user]));
    return logs.map(log => ({ ...log, actor: log.actorId ? usersById.get(log.actorId) || null : null }));
  }

  private async feedbackOrders(role: string, userId: number): Promise<number[]> {
    if (role === "admin" || role === "support") return (await db.select({ id: orders.id }).from(orders)).map(row => row.id);
    return (await db.select({ id: orders.id }).from(orders).where(eq(orders.assignedToId, userId))).map(row => row.id);
  }

  async getClientReviews(role: string, userId: number, orderId?: number): Promise<ClientReview[]> {
    const ids = await this.feedbackOrders(role, userId);
    if (orderId !== undefined && !ids.includes(orderId)) return [];
    const where = orderId !== undefined ? eq(clientReviews.orderId, orderId) : inArray(clientReviews.orderId, ids);
    return db.select().from(clientReviews).where(where).orderBy(desc(clientReviews.createdAt));
  }
  async getClientReviewByOrder(orderId: number): Promise<ClientReview | undefined> {
    const [review] = await db.select().from(clientReviews).where(eq(clientReviews.orderId, orderId));
    return review;
  }
  async createClientReview(data: InsertClientReview): Promise<ClientReview> {
    return db.transaction(async tx => {
      const result = await tx.execute(sql`SELECT nextval('review_number_seq') AS value`);
      const value = Number((result as any).rows?.[0]?.value ?? (result as any)[0]?.value);
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("Unable to allocate a review number");
      const now = new Date();
      const [created] = await tx.insert(clientReviews).values({ ...data, reviewNumber: `REV-${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}-${String(value).padStart(3, "0")}` }).returning();
      return created;
    });
  }
  async updateClientReview(id: number, updates: Partial<InsertClientReview>): Promise<ClientReview> {
    const [updated] = await db.update(clientReviews).set({ ...updates, updatedAt: new Date() }).where(eq(clientReviews.id, id)).returning();
    return updated;
  }
  async getClientSuggestions(role: string, userId: number, orderId?: number): Promise<ClientSuggestion[]> {
    const ids = await this.feedbackOrders(role, userId);
    if (orderId !== undefined && !ids.includes(orderId)) return [];
    const where = orderId !== undefined ? eq(clientSuggestions.orderId, orderId) : inArray(clientSuggestions.orderId, ids);
    return db.select().from(clientSuggestions).where(where).orderBy(desc(clientSuggestions.createdAt));
  }
  async getClientSuggestion(id: number): Promise<ClientSuggestion | undefined> {
    const [suggestion] = await db.select().from(clientSuggestions).where(eq(clientSuggestions.id, id));
    return suggestion;
  }
  async createClientSuggestion(data: InsertClientSuggestion): Promise<ClientSuggestion> {
    return db.transaction(async tx => {
      const result = await tx.execute(sql`SELECT nextval('suggestion_number_seq') AS value`);
      const value = Number((result as any).rows?.[0]?.value ?? (result as any)[0]?.value);
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("Unable to allocate a suggestion number");
      const now = new Date();
      const [created] = await tx.insert(clientSuggestions).values({ ...data, suggestionNumber: `SUG-${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}-${String(value).padStart(3, "0")}` }).returning();
      return created;
    });
  }
  async updateClientSuggestion(id: number, updates: Partial<InsertClientSuggestion>): Promise<ClientSuggestion> {
    const [updated] = await db.update(clientSuggestions).set({ ...updates, updatedAt: new Date() }).where(eq(clientSuggestions.id, id)).returning();
    return updated;
  }
  async getSuggestionNotes(suggestionId: number): Promise<Array<SuggestionNote & { createdBy: Pick<User, "id" | "name" | "role"> | null }>> {
    const [notes, usersList] = await Promise.all([
      db.select().from(suggestionNotes).where(eq(suggestionNotes.suggestionId, suggestionId)).orderBy(desc(suggestionNotes.createdAt)),
      this.getUsers(),
    ]);
    const usersById = new Map(usersList.map(user => [user.id, user]));
    return notes.map(note => {
      const author = note.createdByUserId ? usersById.get(note.createdByUserId) : undefined;
      return { ...note, createdBy: author ? { id: author.id, name: author.name, role: author.role } : null };
    });
  }
  async addSuggestionNote(suggestionId: number, noteText: string, createdByUserId: number): Promise<SuggestionNote> {
    const [note] = await db.insert(suggestionNotes).values({ suggestionId, noteText, createdByUserId }).returning();
    return note;
  }

  private complaintUserSummary(user: User | undefined) {
    if (!user) return undefined;
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      title: user.title,
      avatar: user.avatar,
    };
  }

  private toComplaintResponse(
    complaint: Complaint,
    order: Order | undefined,
    usersById: Map<number, User>,
    role: string,
    services: OrderService[] = [],
  ): ComplaintResponse | undefined {
    const against = complaint.complaintAgainstUserId
      ? this.complaintUserSummary(usersById.get(complaint.complaintAgainstUserId))
      : undefined;
    if (!order || (complaint.complaintTargetType === "designer" && !against)) return undefined;

    const response: ComplaintResponse = {
      id: complaint.id,
      complaintNumber: complaint.complaintNumber,
      orderId: complaint.orderId,
      complaintAgainstUserId: complaint.complaintAgainstUserId,
      orderNumber: order.orderNumber,
      clientName: order.clientName,
      order: {
        clientName: order.clientName,
        orderNumber: order.orderNumber,
        status: order.status,
        packageType: order.packageType,
        services: services.filter(service => service.orderId === order.id),
        ...(role === "admin" || role === "support" ? {
          totalPrice: order.totalPrice,
          advanceAmount: order.advanceAmount,
          remainingAmount: order.remainingAmount,
          discountAmount: order.discountAmount,
          advanceRefunded: order.advanceRefunded,
          refundAmount: order.refundAmount,
        } : {}),
      },
      complaintTargetType: complaint.complaintTargetType || "designer",
      complaintTargetName: complaint.complaintTargetType === "client" ? order.clientName : (against?.name || "Assigned designer"),
      ...(against ? { complaintAgainst: against } : {}),
      category: complaint.category,
      description: complaint.description,
      status: complaint.status,
      resolvedAt: complaint.resolvedAt,
      dismissedAt: complaint.dismissedAt,
      dismissalReason: complaint.dismissalReason,
      resolutionScreenshotUrl: complaint.resolutionScreenshotUrl,
      createdAt: complaint.createdAt,
      updatedAt: complaint.updatedAt,
    };

    // Filer identity and internal notes are deliberately admin-only. Designers
    // and support receive the same safe base projection regardless of client code.
    if (role === "admin") {
      response.filedBy = this.complaintUserSummary(usersById.get(complaint.filedByUserId));
    }
    response.resolution = complaint.resolution;
    response.resolutionOutcome = complaint.resolutionOutcome;
    // A response is only built after visibility has been authorized.
    response.screenshotUrl = complaint.screenshotUrl;
    if (role === "admin") {
      response.resolvedBy = complaint.resolvedByUserId
        ? this.complaintUserSummary(usersById.get(complaint.resolvedByUserId))
        : null;
      response.dismissedBy = complaint.dismissedByUserId
        ? this.complaintUserSummary(usersById.get(complaint.dismissedByUserId))
        : null;
    }
    return response;
  }

  async createComplaint(data: InsertComplaint, actorId: number): Promise<Complaint> {
    return await db.transaction(async (tx) => {
      const result = await tx.execute(sql`SELECT nextval('complaint_number_seq') AS value`);
      const suffix = Number((result as any).rows?.[0]?.value ?? (result as any)[0]?.value);
      if (!Number.isSafeInteger(suffix) || suffix < 1) {
        throw new Error("Unable to allocate a complaint number");
      }
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const [created] = await tx.insert(complaints).values({
        ...data,
        complaintNumber: `CMP-${yy}${mm}-${String(suffix).padStart(3, "0")}`,
      }).returning();
      await tx.insert(activityLogs).values({
        orderId: created.orderId,
        actorId,
        activityType: "complaint_created",
        newValue: created.status,
        details: {
          complaintId: created.id,
          complaintNumber: created.complaintNumber,
          category: created.category,
        },
      });
      return created;
    });
  }

  async getComplaints(role: string, userId: number, filters: ComplaintListFilters = {}): Promise<ComplaintResponse[]> {
    let visible = (await db.select().from(complaints).orderBy(desc(complaints.createdAt)))
      .filter(complaint => canAccessComplaintCase(
        role as CaseRole,
        userId,
        complaint.filedByUserId,
        complaint.complaintAgainstUserId,
        complaint.complaintTargetType || "designer",
      ));

    if (filters.orderId) {
      visible = visible.filter(complaint => complaint.orderId === filters.orderId);
    }
    if (filters.designerId) {
      visible = visible.filter(complaint => complaint.complaintAgainstUserId === filters.designerId);
    }
    if (filters.status) {
      visible = visible.filter(complaint => complaint.status === filters.status);
    }
    if (filters.category) {
      visible = visible.filter(complaint => complaint.category === filters.category);
    }
    if (filters.year) {
      visible = visible.filter(complaint => complaint.createdAt?.getFullYear() === filters.year);
    }
    if (filters.month) {
      visible = visible.filter(complaint => (complaint.createdAt?.getMonth() ?? -1) + 1 === filters.month);
    }

    const [allOrders, allUsers, allServices] = await Promise.all([
      db.select().from(orders),
      this.getUsers(),
      db.select().from(orderServices),
    ]);
    const ordersById = new Map(allOrders.map(order => [order.id, order]));
    const usersById = new Map(allUsers.map(user => [user.id, user]));
    const search = filters.search?.trim().toLowerCase();

    return visible
      .map(complaint => this.toComplaintResponse(complaint, ordersById.get(complaint.orderId), usersById, role, allServices))
      .filter((response): response is ComplaintResponse => {
        if (!response) return false;
        if (!search) return true;
        return [
          response.complaintNumber,
          response.orderNumber,
          response.clientName,
          response.category,
          response.description,
           response.complaintTargetName,
           response.complaintAgainst?.name,
        ].some(value => value?.toLowerCase().includes(search));
      });
  }

  async getComplaintForUser(id: number, role: string, userId: number): Promise<ComplaintResponse | undefined> {
    const complaintsForUser = await this.getComplaints(role, userId);
    const response = complaintsForUser.find(complaint => complaint.id === id);
    if (response && role === "admin") {
      response.adminNotesLog = await this.getComplaintNotes(id);
    }
    return response;
  }

  async getComplaintRecord(id: number): Promise<Complaint | undefined> {
    const [complaint] = await db.select().from(complaints).where(eq(complaints.id, id));
    return complaint;
  }

  async updateComplaint(
    id: number,
    expectedStatus: Complaint["status"],
    updates: Partial<InsertComplaint>,
    historyEvents: InsertActivityLog[],
    cancellation?: OrderCancellation,
  ): Promise<Complaint | undefined> {
    return await db.transaction(async (tx) => {
      const [updated] = await tx.update(complaints)
        .set({ ...updates, updatedAt: new Date() })
        .where(and(eq(complaints.id, id), eq(complaints.status, expectedStatus)))
        .returning();
      if (!updated) return undefined;
      if (historyEvents.length > 0) {
        await tx.insert(activityLogs).values(historyEvents);
      }
      if (cancellation) {
        const now = new Date();
        await tx.execute(sql`SELECT id FROM orders WHERE id = ${updated.orderId} FOR UPDATE`);
        const [existingOrder] = await tx.select().from(orders).where(eq(orders.id, updated.orderId));
        if (!existingOrder || existingOrder.status === "canceled") {
          throw new Error("Unable to cancel the related order");
        }
        const advanceAmount = Math.max(0, Number(existingOrder.advanceAmount || 0));
        const refundAmount = cancellation.advanceRefunded ? advanceAmount : 0;
        const [updatedOrder] = await tx.update(orders)
          .set({
            status: "canceled",
            cancellationReason: cancellation.reason,
            canceledByUserId: cancellation.actorId,
            canceledAt: now,
            advanceRefunded: cancellation.advanceRefunded,
            refundAmount,
            refundRecordedByUserId: cancellation.advanceRefunded ? cancellation.actorId : null,
            refundRecordedAt: cancellation.advanceRefunded ? now : null,
          })
          .where(and(eq(orders.id, updated.orderId), ne(orders.status, "canceled")))
          .returning();
        if (!updatedOrder) {
          throw new Error("Unable to cancel the related order");
        }
        await tx.insert(activityLogs).values([
          {
            orderId: updated.orderId,
            actorId: cancellation.actorId,
            activityType: "status_change",
            previousValue: existingOrder.status,
            newValue: "canceled",
            details: {
              complaintId: cancellation.complaintId,
              complaintNumber: cancellation.complaintNumber,
              cancellationReason: cancellation.reason,
              advanceRefunded: cancellation.advanceRefunded,
              refundAmount,
            },
          },
          {
            orderId: updated.orderId,
            actorId: cancellation.actorId,
            activityType: "payment_change",
            previousValue: "advance_received",
            newValue: cancellation.advanceRefunded ? "refunded" : "retained",
            details: {
              complaintId: cancellation.complaintId,
              complaintNumber: cancellation.complaintNumber,
              amount: advanceAmount,
              cancellation: true,
            },
          },
          {
            orderId: updated.orderId,
            actorId: cancellation.actorId,
            activityType: "payment_change",
            previousValue: "remaining_receivable",
            newValue: "canceled",
            details: {
              complaintId: cancellation.complaintId,
              complaintNumber: cancellation.complaintNumber,
              amount: Math.max(0, Number(existingOrder.remainingAmount || 0)),
              cancellation: true,
            },
          },
        ]);
      }
      return updated;
    });
  }

  async getComplaintNotes(id: number): Promise<ComplaintNoteResponse[]> {
    const notes = await db.select().from(complaintNotes)
      .where(eq(complaintNotes.complaintId, id))
      .orderBy(desc(complaintNotes.createdAt), desc(complaintNotes.id));
    const allUsers = await this.getUsers();
    const usersById = new Map(allUsers.map(user => [user.id, user]));
    return notes.map(note => ({
      id: note.id,
      noteText: note.noteText,
      createdAt: note.createdAt,
      createdBy: note.createdByUserId
        ? this.complaintUserSummary(usersById.get(note.createdByUserId))
        : null,
    }));
  }

  async addComplaintNote(id: number, noteText: string, actorId: number): Promise<ComplaintNote> {
    const text = noteText.trim();
    if (!text) throw new Error("Admin note cannot be empty.");
    return await db.transaction(async (tx) => {
      const [complaint] = await tx.select().from(complaints).where(eq(complaints.id, id));
      if (!complaint) throw new Error("Complaint not found.");
      const [note] = await tx.insert(complaintNotes).values({
        complaintId: id,
        noteText: text,
        createdByUserId: actorId,
      }).returning();
      await tx.insert(activityLogs).values({
        orderId: complaint.orderId,
        actorId,
        activityType: "complaint_note",
        newValue: "added",
        details: {
          complaintId: complaint.id,
          complaintNumber: complaint.complaintNumber,
        },
      });
      return note;
    });
  }

  async getComplaintHistory(id: number): Promise<ComplaintHistoryEntry[]> {
    const complaint = await this.getComplaintRecord(id);
    if (!complaint) return [];
    const logs = await db.select().from(activityLogs)
      .where(eq(activityLogs.orderId, complaint.orderId))
      .orderBy(desc(activityLogs.createdAt));
    const allUsers = await this.getUsers();
    const usersById = new Map(allUsers.map(user => [user.id, user]));

    return logs
      .filter(log => {
        const details = log.details;
        return details && typeof details === "object" && details.complaintId === id;
      })
      .map(log => ({
        id: log.id,
        action: log.activityType,
        previousValue: log.previousValue,
        newValue: log.newValue,
        details: log.details,
        createdAt: log.createdAt,
        actor: log.actorId ? this.complaintUserSummary(usersById.get(log.actorId)) : undefined,
      }));
  }

  async getComplaintStats(role: string, userId: number, filters: ComplaintListFilters = {}): Promise<ComplaintStats> {
    const rows = await this.getComplaints(role, userId, filters);
    return {
      all: rows.length,
      confirmed: rows.filter(row => row.status === "confirmed").length,
      dismissed: rows.filter(row => row.status === "dismissed").length,
      resolved: rows.filter(row => row.status === "resolved").length,
      refund: rows.filter(row =>
        row.status === "refunded"
      ).length,
    };
  }

  async getActionableComplaintCount(role: string, userId: number): Promise<number> {
    const rows = await db.select({
      filedByUserId: complaints.filedByUserId,
      complaintAgainstUserId: complaints.complaintAgainstUserId,
      complaintTargetType: complaints.complaintTargetType,
      status: complaints.status,
    }).from(complaints).where(eq(complaints.status, "new"));
    return rows.filter(row => canAccessComplaintCase(
      role as CaseRole,
      userId,
      row.filedByUserId,
      row.complaintAgainstUserId,
      row.complaintTargetType || "designer",
    )).length;
  }

  async getPaymentVerifications(role: string, userId: number): Promise<PaymentVerificationWithUsers[]> {
    let verificationList: PaymentVerification[];
    
    if (role === "admin") {
      verificationList = await db.select().from(paymentVerifications).orderBy(desc(paymentVerifications.createdAt));
    } else {
      verificationList = await db.select().from(paymentVerifications)
        .where(eq(paymentVerifications.submittedById, userId))
        .orderBy(desc(paymentVerifications.createdAt));
    }

    const allUsers = await this.getUsers();
    return verificationList.map(pv => ({
      ...pv,
      screenshotData: null,
      submittedBy: allUsers.find(u => u.id === pv.submittedById) || null,
      reviewedBy: pv.reviewedById ? allUsers.find(u => u.id === pv.reviewedById) || null : null,
    }));
  }

  async getPaymentVerificationByScreenshotUrl(url: string): Promise<PaymentVerification | undefined> {
    const [verification] = await db.select().from(paymentVerifications)
      .where(eq(paymentVerifications.screenshotUrl, url));
    return verification;
  }

  async getPaymentVerificationsByOrder(orderId: number): Promise<PaymentVerificationWithUsers[]> {
    const verificationList = await db.select().from(paymentVerifications)
      .where(eq(paymentVerifications.orderId, orderId))
      .orderBy(desc(paymentVerifications.createdAt));
    
    const allUsers = await this.getUsers();
    return verificationList.map(pv => ({
      ...pv,
      screenshotData: null,
      submittedBy: allUsers.find(u => u.id === pv.submittedById) || null,
      reviewedBy: pv.reviewedById ? allUsers.find(u => u.id === pv.reviewedById) || null : null,
    }));
  }

  async createPaymentVerification(data: InsertPaymentVerification): Promise<PaymentVerification> {
    const [verification] = await db.insert(paymentVerifications).values(data).returning();
    return verification;
  }

  async updatePaymentVerification(id: number, updates: Partial<InsertPaymentVerification>): Promise<PaymentVerification> {
    const [verification] = await db.update(paymentVerifications).set(updates).where(eq(paymentVerifications.id, id)).returning();
    return verification;
  }

  async getDesignerAssignments(supportUserId: number): Promise<SupportDesignerAssignment[]> {
    return await db.select().from(supportDesignerAssignments)
      .where(eq(supportDesignerAssignments.supportUserId, supportUserId));
  }

  async getAllDesignerAssignments(): Promise<SupportDesignerAssignment[]> {
    return await db.select().from(supportDesignerAssignments);
  }

  async setDesignerAssignments(supportUserId: number, designerIds: number[]): Promise<void> {
    await db.delete(supportDesignerAssignments)
      .where(eq(supportDesignerAssignments.supportUserId, supportUserId));
    
    if (designerIds.length > 0) {
      await db.insert(supportDesignerAssignments).values(
        designerIds.map(designerUserId => ({
          supportUserId,
          designerUserId,
        }))
      );
    }
  }

  async getServicesCatalog(): Promise<ServiceCatalogItem[]> {
    return await db.select().from(servicesCatalog).orderBy(asc(servicesCatalog.sortOrder), asc(servicesCatalog.id));
  }

  async createServiceCatalogItem(item: InsertServiceCatalogItem): Promise<ServiceCatalogItem> {
    const [newItem] = await db.insert(servicesCatalog).values(item).returning();
    return newItem;
  }

  async updateServiceCatalogItem(id: number, updates: Partial<InsertServiceCatalogItem>): Promise<ServiceCatalogItem> {
    const [updated] = await db.update(servicesCatalog).set(updates).where(eq(servicesCatalog.id, id)).returning();
    return updated;
  }

  async deleteServiceCatalogItem(id: number): Promise<void> {
    await db.delete(servicesCatalog).where(eq(servicesCatalog.id, id));
  }

  async getPackageConfigs(): Promise<PackageConfig[]> {
    return await db.select().from(packageConfigs).orderBy(asc(packageConfigs.sortOrder), asc(packageConfigs.id));
  }

  async createPackageConfig(pkg: InsertPackageConfig): Promise<PackageConfig> {
    const [newPkg] = await db.insert(packageConfigs).values(pkg).returning();
    return newPkg;
  }

  async updatePackageConfig(id: number, updates: Partial<InsertPackageConfig>): Promise<PackageConfig> {
    const [updated] = await db.update(packageConfigs).set(updates).where(eq(packageConfigs.id, id)).returning();
    return updated;
  }

  async deletePackageConfig(id: number): Promise<void> {
    await db.delete(packageConfigs).where(eq(packageConfigs.id, id));
  }

  async getPlatformsCatalog(): Promise<PlatformCatalogItem[]> {
    return await db.select().from(platformsCatalog).orderBy(asc(platformsCatalog.sortOrder), asc(platformsCatalog.id));
  }

  async createPlatformCatalogItem(item: InsertPlatformCatalogItem): Promise<PlatformCatalogItem> {
    const [newItem] = await db.insert(platformsCatalog).values(item).returning();
    return newItem;
  }

  async updatePlatformCatalogItem(id: number, updates: Partial<InsertPlatformCatalogItem>): Promise<PlatformCatalogItem> {
    const [updated] = await db.update(platformsCatalog).set(updates).where(eq(platformsCatalog.id, id)).returning();
    return updated;
  }

  async deletePlatformCatalogItem(id: number): Promise<void> {
    await db.delete(platformsCatalog).where(eq(platformsCatalog.id, id));
  }

  async getComplaintCategoryConfigs(): Promise<ComplaintCategoryConfig[]> {
    return await db.select().from(complaintCategoryConfigs)
      .orderBy(asc(complaintCategoryConfigs.sortOrder), asc(complaintCategoryConfigs.id));
  }

  async createComplaintCategoryConfig(item: InsertComplaintCategoryConfig): Promise<ComplaintCategoryConfig> {
    const [created] = await db.insert(complaintCategoryConfigs).values(item).returning();
    return created;
  }

  async updateComplaintCategoryConfig(id: number, updates: Partial<InsertComplaintCategoryConfig>): Promise<ComplaintCategoryConfig> {
    const [updated] = await db.update(complaintCategoryConfigs).set(updates)
      .where(eq(complaintCategoryConfigs.id, id)).returning();
    return updated;
  }

  async deleteComplaintCategoryConfig(id: number): Promise<void> {
    await db.delete(complaintCategoryConfigs).where(eq(complaintCategoryConfigs.id, id));
  }

  async getAdmins(): Promise<User[]> {
    return await db.select().from(users).where(eq(users.role, "admin"));
  }

  async getUnreadNotificationCount(userId: number): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
    return result[0]?.count || 0;
  }

  async getPendingPaymentCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(paymentVerifications)
      .where(eq(paymentVerifications.status, "pending_confirmation"));
    return result[0]?.count || 0;
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    await db
      .update(notifications)
      .set({ read: true })
      .where(eq(notifications.userId, userId));
  }

  async savePushSubscription(userId: number, endpoint: string, p256dh: string, auth: string): Promise<PushSubscription> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    const [sub] = await db.insert(pushSubscriptions).values({ userId, endpoint, p256dh, auth }).returning();
    return sub;
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  async getPushSubscriptionsForUser(userId: number): Promise<PushSubscription[]> {
    return await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  }
}

export const storage = new DatabaseStorage();
