import { NOTIFICATION_LIST_DAYS } from "@shared/notification-events";
import { pkPhoneKey } from "@shared/phone";
import { 
  users, orders, notifications, orderServices, paymentVerifications, supportDesignerAssignments,
  servicesCatalog, packageConfigs, platformsCatalog, complaintCategoryConfigs, pushSubscriptions, activityLogs, complaints, complaintEvidence, complaintDesignerEvidence, complaintNotes, clientReviews, clientSuggestions, suggestionNotes,
  type User, type InsertUser, type Order, type InsertOrder,
  type OrderService, type InsertOrderService, type OrderWithServices,
  type PaymentVerification, type InsertPaymentVerification, type PaymentVerificationWithUsers,
  type Notification, type SupportDesignerAssignment,
  type ServiceCatalogItem, type InsertServiceCatalogItem,
  type PackageConfig, type InsertPackageConfig,
  type PlatformCatalogItem, type InsertPlatformCatalogItem,
  type ComplaintCategoryConfig, type InsertComplaintCategoryConfig,
  type PushSubscription, type Complaint, type InsertComplaint, type ComplaintResponse, type ComplaintEvidence, type ComplaintDesignerEvidence, type ComplaintNote, type ComplaintNoteResponse,
  type ComplaintHistoryEntry, type ComplaintStats,
  type InsertActivityLog, type ActivityLog,
  type ClientReview, type InsertClientReview, type ClientSuggestion, type InsertClientSuggestion, type ActivityLogWithActor, type SuggestionNote,
} from "@shared/schema";
import { db } from "./db";
import { userColumns, stripUserSecurityFields } from "./schemaCompat";
import { eq, ne, desc, sql, and, isNotNull, inArray, asc, getTableColumns } from "drizzle-orm";

// Arbitrary constant key for pg_advisory_xact_lock around order-number allocation.
const ORDER_NUMBER_LOCK_KEY = 7_311_001;
import { getStartOfBusinessDay, getStartOfBusinessMonth } from "@shared/business-time";
import { getOrderAccounting } from "@shared/order-accounting";
import { canAccessComplaintCase, canAccessOrderCase, isSupportedComplaintTarget, type CaseRole } from "@shared/case-access";

export type ComplaintListFilters = {
  search?: string;
  status?: string;
  category?: string;
  orderId?: number;
  /** Load a single complaint (detail view). */
  id?: number;
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

export type NotificationListOptions = { limit?: number; offset?: number; types?: string[] };

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User>;
  getUsers(): Promise<User[]>;

  getOrder(id: number): Promise<OrderWithServices | undefined>;
  createOrder(order: InsertOrder, services?: Omit<InsertOrderService, 'orderId'>[]): Promise<Order>;
  updateOrder(id: number, updates: Partial<InsertOrder>): Promise<Order>;
  cancelOrder(id: number, cancellation: OrderCancellation): Promise<Order | undefined>;
  getOrderServices(orderId: number): Promise<OrderService[]>;
  getOrderService(id: number): Promise<OrderService | undefined>;
  createOrderService(service: InsertOrderService): Promise<OrderService>;
  updateOrderService(id: number, updates: Partial<InsertOrderService>): Promise<OrderService>;
  replaceOrderServices(orderId: number, services: Omit<InsertOrderService, 'orderId'>[]): Promise<void>;
  deleteOrder(id: number): Promise<void>;
  generateOrderNumber(tx?: any): Promise<string>;

  getNotifications(userId: number, opts?: NotificationListOptions): Promise<Notification[]>;
  markNotificationRead(id: number, userId: number): Promise<Notification | undefined>;
  createNotification(userId: number, type: string, title: string, message: string, priority: string, relatedId?: number, relatedType?: string, dedupeKey?: string): Promise<{ notification: Notification; created: boolean }>;

  invalidateUsersCache(): void;

  getPaymentVerification(id: number): Promise<PaymentVerificationWithUsers | undefined>;
  getPaymentVerificationsByOrder(orderId: number): Promise<PaymentVerificationWithUsers[]>;
  getPaymentVerificationByScreenshotUrl(url: string): Promise<PaymentVerification | undefined>;
  createPaymentVerification(data: InsertPaymentVerification): Promise<PaymentVerification>;

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
  createComplaint(
    data: InsertComplaint,
    actorId: number,
    evidence?: Array<Pick<ComplaintEvidence, "url" | "fileName" | "fileSize">>,
  ): Promise<Complaint>;
  saveDesignerExplanation(
    complaintId: number,
    designerId: number,
    explanation: string,
    evidence?: Array<Pick<ComplaintDesignerEvidence, "url" | "fileName" | "fileSize">>,
  ): Promise<Complaint | undefined>;
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
  // Small in-process cache of the users table. Every authenticated request
  // deserializes the session user, and most list endpoints join users in JS,
  // so this removes one database round trip from nearly every request.
  private usersCache: { at: number; rows: User[] } | null = null;
  private usersInflight: Promise<User[]> | null = null;
  private static USERS_TTL_MS = 30_000;

  invalidateUsersCache() {
    this.usersCache = null;
    this.usersInflight = null;
  }

  async getUser(id: number): Promise<User | undefined> {
    const cached = this.usersCache && Date.now() - this.usersCache.at < DatabaseStorage.USERS_TTL_MS
      ? this.usersCache.rows.find(u => u.id === id)
      : undefined;
    if (cached) return cached;
    const [user] = await db.select(userColumns()).from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select(userColumns()).from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(stripUserSecurityFields(insertUser)).returning(userColumns());
    this.invalidateUsersCache();
    return user;
  }

  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User> {
    const [user] = await db.update(users).set(stripUserSecurityFields(updates)).where(eq(users.id, id)).returning(userColumns());
    this.invalidateUsersCache();
    return user;
  }

  async getUsers(): Promise<User[]> {
    if (this.usersCache && Date.now() - this.usersCache.at < DatabaseStorage.USERS_TTL_MS) {
      return [...this.usersCache.rows];
    }
    if (!this.usersInflight) {
      const inflight = db.select(userColumns()).from(users).orderBy(users.id)
        .then(rows => {
          if (this.usersInflight === inflight) this.usersCache = { at: Date.now(), rows };
          return rows;
        })
        .finally(() => {
          if (this.usersInflight === inflight) this.usersInflight = null;
        });
      this.usersInflight = inflight;
    }
    return [...(await this.usersInflight)];
  }

  async getOrder(id: number): Promise<OrderWithServices | undefined> {
    const [[order], services, allUsers] = await Promise.all([
      db.select().from(orders).where(eq(orders.id, id)),
      this.getOrderServices(id),
      this.getUsers(),
    ]);
    if (!order) return undefined;
    const assignee = order.assignedToId ? allUsers.find(u => u.id === order.assignedToId) : null;
    return { ...order, services, assignee };
  }

  async createOrder(order: InsertOrder, services?: Omit<InsertOrderService, 'orderId'>[]): Promise<Order> {
    // Phase 5: new orders carry their client key (old rows are never back-filled).
    const [newOrder] = await db.insert(orders).values({ ...order, clientKey: pkPhoneKey(order.clientPhone) }).returning();
    if (services && services.length > 0) {
      for (const svc of services) {
        await this.createOrderService({ ...svc, orderId: newOrder.id });
      }
    }
    return newOrder;
  }

  async updateOrder(id: number, updates: Partial<InsertOrder>): Promise<Order> {
    // A phone edit keeps a NEW order's client key in step; old orders (key NULL) stay NULL.
    const set: Record<string, unknown> = { ...updates };
    if (updates.clientPhone !== undefined) set.clientKey = sql`case when ${orders.clientKey} is null then null else ${pkPhoneKey(updates.clientPhone)} end`;
    const [updatedOrder] = await db.update(orders).set(set as Partial<InsertOrder>).where(eq(orders.id, id)).returning();
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
      // Phase 2: refund records already approved on this order are not refunded twice.
      const recorded = await tx.execute(sql`SELECT coalesce(sum(approved_amount), 0)::int AS v FROM refunds WHERE order_id = ${id} AND status IN ('approved', 'paid')`);
      const alreadyRefunded = Number(((recorded as any).rows ?? recorded)[0]?.v || 0);
      const refundAmount = cancellation.advanceRefunded ? Math.max(0, advanceAmount - alreadyRefunded) : 0;
      const [updated] = await tx.update(orders).set({
        status: "canceled",
        workStatus: "canceled",
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

  async getOrderService(id: number): Promise<OrderService | undefined> {
    const [service] = await db.select().from(orderServices).where(eq(orderServices.id, id));
    return service;
  }

  async createOrderService(service: InsertOrderService): Promise<OrderService> {
    const [newService] = await db.insert(orderServices).values(service).returning();
    return newService;
  }

  async updateOrderService(id: number, updates: Partial<InsertOrderService>): Promise<OrderService> {
    const [updated] = await db.update(orderServices).set(updates).where(eq(orderServices.id, id)).returning();
    return updated;
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

  /**
   * Next PX-YYMM-NNN number. The sequence is the highest existing one + 1
   * (not count-based, so gaps/deletions never cause duplicates).
   * Pass a transaction to make allocation race-free: it takes a transaction
   * advisory lock, so two concurrent approvals can't receive the same number.
   */
  async generateOrderNumber(tx?: any): Promise<string> {
    const executor = tx || db;
    if (tx) await tx.execute(sql`SELECT pg_advisory_xact_lock(${ORDER_NUMBER_LOCK_KEY})`);
    const year = new Date().getFullYear().toString().slice(-2);
    const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
    const result = await executor.execute(sql`
      SELECT COALESCE(MAX(substring(order_number from 'PX-[0-9]{4}-([0-9]+)')::int), 0) AS max_seq
      FROM orders WHERE order_number IS NOT NULL`);
    const maxSeq = Number((result as any).rows?.[0]?.max_seq ?? 0);
    return `PX-${year}${month}-${(maxSeq + 1).toString().padStart(3, '0')}`;
  }

  /**
   * Bell list: last 30 days only (older rows are hidden, never deleted),
   * unread first, optional type group, offset paging for infinite scroll.
   */
  async getNotifications(userId: number, opts: NotificationListOptions = {}): Promise<Notification[]> {
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    const conditions = [
      eq(notifications.userId, userId),
      sql`${notifications.createdAt} >= now() - (${NOTIFICATION_LIST_DAYS} * interval '1 day')`,
    ];
    if (opts.types?.length) conditions.push(inArray(notifications.type, opts.types));
    const rows = await db.select().from(notifications)
      .where(and(...conditions))
      .orderBy(notifications.read, desc(notifications.createdAt), desc(notifications.id))
      .limit(limit)
      .offset(offset);
    const complaintIds = rows
      .filter(notification => notification.relatedType === "complaint" && notification.relatedId)
      .map(notification => notification.relatedId as number);
    if (!complaintIds.length) return rows;
    const legacyComplaints = await db.select({ id: complaints.id })
      .from(complaints)
      .where(and(eq(complaints.complaintTargetType, "client"), inArray(complaints.id, complaintIds)));
    const legacyIds = new Set(legacyComplaints.map(complaint => complaint.id));
    return rows.filter(notification => !(notification.relatedType === "complaint" && notification.relatedId && legacyIds.has(notification.relatedId)));
  }

  async markNotificationRead(id: number, userId: number): Promise<Notification | undefined> {
    const [notification] = await db.update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning();
    return notification;
  }

  async createNotification(userId: number, type: string, title: string, message: string, priority: string, relatedId?: number, relatedType?: string, dedupeKeyOverride?: string): Promise<{ notification: Notification; created: boolean }> {
    const dedupeKey = dedupeKeyOverride || [type, title, message, relatedType || "", relatedId ?? ""].join("::");
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
  /** Notes for many suggestions in one query (feedback list). */
  async getSuggestionNotesFor(suggestionIds: number[]) {
    const out = new Map<number, Array<SuggestionNote & { createdBy: Pick<User, "id" | "name" | "role"> | null }>>();
    if (suggestionIds.length === 0) return out;
    const [notes, usersList] = await Promise.all([
      db.select().from(suggestionNotes).where(inArray(suggestionNotes.suggestionId, suggestionIds)).orderBy(desc(suggestionNotes.createdAt)),
      this.getUsers(),
    ]);
    const usersById = new Map(usersList.map(user => [user.id, user]));
    for (const note of notes) {
      const author = note.createdByUserId ? usersById.get(note.createdByUserId) : undefined;
      const list = out.get(note.suggestionId) ?? [];
      list.push({ ...note, createdBy: author ? { id: author.id, name: author.name, role: author.role } : null });
      out.set(note.suggestionId, list);
    }
    return out;
  }
  /** Orders with their services for many ids in two queries (feedback list). */
  async getOrdersWithServicesByIds(ids: number[]) {
    const out = new Map<number, Order & { services: OrderService[] }>();
    if (ids.length === 0) return out;
    const [orderRows, serviceRows] = await Promise.all([
      db.select().from(orders).where(inArray(orders.id, ids)),
      db.select().from(orderServices).where(inArray(orderServices.orderId, ids)),
    ]);
    for (const o of orderRows) out.set(o.id, { ...o, services: serviceRows.filter(sv => sv.orderId === o.id) });
    return out;
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
    evidenceByComplaintId: Map<number, ComplaintEvidence[]> = new Map(),
    designerEvidenceByComplaintId: Map<number, ComplaintDesignerEvidence[]> = new Map(),
  ): ComplaintResponse | undefined {
    const against = complaint.complaintAgainstUserId
      ? this.complaintUserSummary(usersById.get(complaint.complaintAgainstUserId))
      : undefined;
    if (!order || !against) return undefined;

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
      complaintTargetType: "designer",
      complaintTargetName: against.name || "Assigned designer",
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
      designerExplanation: complaint.designerExplanation,
      designerExplanationAt: complaint.designerExplanationAt,
      designerExplanationBy: complaint.designerExplanationByUserId
        ? this.complaintUserSummary(usersById.get(complaint.designerExplanationByUserId))
        : null,
      evidence: (evidenceByComplaintId.get(complaint.id) || (complaint.screenshotUrl ? [{
        id: 0,
        complaintId: complaint.id,
        url: complaint.screenshotUrl,
        fileName: "Complaint evidence",
        fileSize: 0,
        createdAt: complaint.createdAt,
      }] : [])).map(item => ({
        id: item.id,
        url: item.url,
        fileName: item.fileName,
        fileSize: item.fileSize,
        createdAt: item.createdAt,
      })),
      designerEvidence: (designerEvidenceByComplaintId.get(complaint.id) || []).map(item => ({
        id: item.id,
        url: item.url,
        fileName: item.fileName,
        fileSize: item.fileSize,
        createdAt: item.createdAt,
      })),
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

  async createComplaint(
    data: InsertComplaint,
    actorId: number,
    evidence: Array<Pick<ComplaintEvidence, "url" | "fileName" | "fileSize">> = [],
  ): Promise<Complaint> {
    if (data.complaintTargetType && data.complaintTargetType !== "designer") {
      throw new Error("Client-target complaints are no longer supported.");
    }
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
      if (evidence.length > 0) {
        await tx.insert(complaintEvidence).values(
          evidence.map(item => ({ complaintId: created.id, ...item })),
        );
      }
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

  async saveDesignerExplanation(
    complaintId: number,
    designerId: number,
    explanation: string,
    evidence: Array<Pick<ComplaintDesignerEvidence, "url" | "fileName" | "fileSize">> = [],
  ): Promise<Complaint | undefined> {
    const text = explanation.trim();
    if (!text) throw new Error("Designer explanation cannot be empty.");
    return await db.transaction(async (tx) => {
      const [complaint] = await tx.select().from(complaints).where(eq(complaints.id, complaintId));
      if (!complaint || complaint.complaintAgainstUserId !== designerId) return undefined;
      if (complaint.status === "dismissed" || complaint.status === "resolved" || complaint.status === "refunded") {
        throw new Error("Designer explanations are closed for this complaint.");
      }
      if (complaint.designerExplanation) {
        throw new Error("A designer explanation has already been recorded for this complaint.");
      }
      const [updated] = await tx.update(complaints)
        .set({
          designerExplanation: text,
          designerExplanationByUserId: designerId,
          designerExplanationAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(complaints.id, complaintId), eq(complaints.complaintAgainstUserId, designerId)))
        .returning();
      if (!updated) return undefined;
      if (evidence.length > 0) {
        await tx.insert(complaintDesignerEvidence).values(
          evidence.map(item => ({ complaintId, ...item })),
        );
      }
      await tx.insert(activityLogs).values({
        orderId: complaint.orderId,
        actorId: designerId,
        activityType: "complaint_designer_explanation",
        newValue: "added",
        details: {
          complaintId: complaint.id,
          complaintNumber: complaint.complaintNumber,
          evidenceCount: evidence.length,
        },
      });
      return updated;
    });
  }

  async getComplaints(role: string, userId: number, filters: ComplaintListFilters = {}): Promise<ComplaintResponse[]> {
    let visible = (await (filters.id
      ? db.select().from(complaints).where(eq(complaints.id, filters.id))
      : db.select().from(complaints).orderBy(desc(complaints.createdAt))))
      .filter(complaint => isSupportedComplaintTarget(complaint.complaintTargetType))
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

    // Load related rows only for the complaints being returned (not every order).
    const orderIds = Array.from(new Set(visible.map(c => c.orderId)));
    const complaintIds = visible.map(c => c.id);
    if (complaintIds.length === 0) return [];
    const [allOrders, allUsers, allServices, allEvidence, allDesignerEvidence] = await Promise.all([
      db.select().from(orders).where(inArray(orders.id, orderIds)),
      this.getUsers(),
      db.select().from(orderServices).where(inArray(orderServices.orderId, orderIds)),
      db.select().from(complaintEvidence).where(inArray(complaintEvidence.complaintId, complaintIds)).orderBy(asc(complaintEvidence.createdAt)),
      db.select().from(complaintDesignerEvidence).where(inArray(complaintDesignerEvidence.complaintId, complaintIds)).orderBy(asc(complaintDesignerEvidence.createdAt)),
    ]);
    const ordersById = new Map(allOrders.map(order => [order.id, order]));
    const usersById = new Map(allUsers.map(user => [user.id, user]));
    const evidenceByComplaintId = new Map<number, ComplaintEvidence[]>();
    for (const evidence of allEvidence) {
      const items = evidenceByComplaintId.get(evidence.complaintId) || [];
      items.push(evidence);
      evidenceByComplaintId.set(evidence.complaintId, items);
    }
    const designerEvidenceByComplaintId = new Map<number, ComplaintDesignerEvidence[]>();
    for (const evidence of allDesignerEvidence) {
      const items = designerEvidenceByComplaintId.get(evidence.complaintId) || [];
      items.push(evidence);
      designerEvidenceByComplaintId.set(evidence.complaintId, items);
    }
    const search = filters.search?.trim().toLowerCase();

    return visible
      .map(complaint => this.toComplaintResponse(complaint, ordersById.get(complaint.orderId), usersById, role, allServices, evidenceByComplaintId, designerEvidenceByComplaintId))
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
    const complaintsForUser = await this.getComplaints(role, userId, { id });
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
      new: rows.filter(row => row.status === "new").length,
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
    return rows.filter(row => isSupportedComplaintTarget(row.complaintTargetType)).filter(row => canAccessComplaintCase(
      role as CaseRole,
      userId,
      row.filedByUserId,
      row.complaintAgainstUserId,
      row.complaintTargetType || "designer",
    )).length;
  }

  async getPaymentVerification(id: number): Promise<PaymentVerificationWithUsers | undefined> {
    const { screenshotData: _omit, ...pvColumns } = getTableColumns(paymentVerifications);
    const [[pv], allUsers] = await Promise.all([
      db.select(pvColumns).from(paymentVerifications).where(eq(paymentVerifications.id, id)),
      this.getUsers(),
    ]);
    if (!pv) return undefined;
    return {
      ...pv,
      screenshotData: null,
      submittedBy: allUsers.find(u => u.id === pv.submittedById) || null,
      reviewedBy: pv.reviewedById ? allUsers.find(u => u.id === pv.reviewedById) || null : null,
    };
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
    return await db.select(userColumns()).from(users).where(and(eq(users.role, "admin"), eq(users.isActive, true)));
  }

  async getUnreadNotificationCount(userId: number): Promise<number> {
    const rows = await db
      .select({ id: notifications.id, relatedId: notifications.relatedId, relatedType: notifications.relatedType })
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.read, false),
        sql`${notifications.createdAt} >= now() - (${NOTIFICATION_LIST_DAYS} * interval '1 day')`,
      ));
    const complaintIds = rows
      .filter(notification => notification.relatedType === "complaint" && notification.relatedId)
      .map(notification => notification.relatedId as number);
    if (!complaintIds.length) return rows.length;
    const legacyComplaints = await db.select({ id: complaints.id })
      .from(complaints)
      .where(and(eq(complaints.complaintTargetType, "client"), inArray(complaints.id, complaintIds)));
    const legacyIds = new Set(legacyComplaints.map(complaint => complaint.id));
    return rows.filter(notification => !(notification.relatedType === "complaint" && notification.relatedId && legacyIds.has(notification.relatedId))).length;
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
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.read, false),
        sql`${notifications.createdAt} >= now() - (${NOTIFICATION_LIST_DAYS} * interval '1 day')`,
      ));
  }

  async savePushSubscription(userId: number, endpoint: string, p256dh: string, auth: string): Promise<PushSubscription> {
    // Upsert on the unique endpoint (a device re-subscribing or switching user).
    // No delete-then-insert: nothing is removed here.
    const [sub] = await db.insert(pushSubscriptions).values({ userId, endpoint, p256dh, auth })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh, auth } })
      .returning();
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
