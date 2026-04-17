import { 
  users, orders, notifications, orderServices, paymentVerifications, supportDesignerAssignments,
  servicesCatalog, packageConfigs, platformsCatalog, pushSubscriptions,
  type User, type InsertUser, type Order, type InsertOrder,
  type OrderService, type InsertOrderService, type OrderWithServices,
  type PaymentVerification, type InsertPaymentVerification, type PaymentVerificationWithUsers,
  type Notification, type SupportDesignerAssignment,
  type ServiceCatalogItem, type InsertServiceCatalogItem,
  type PackageConfig, type InsertPackageConfig,
  type PlatformCatalogItem, type InsertPlatformCatalogItem,
  type PushSubscription,
} from "@shared/schema";
import { db } from "./db";
import { eq, ne, desc, sql, and, isNotNull, inArray, asc } from "drizzle-orm";

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
  getOrderServices(orderId: number): Promise<OrderService[]>;
  createOrderService(service: InsertOrderService): Promise<OrderService>;
  generateOrderNumber(): Promise<string>;

  getNotifications(userId: number): Promise<Notification[]>;
  markNotificationRead(id: number): Promise<Notification>;
  createNotification(userId: number, type: string, title: string, message: string, priority: string, relatedId?: number, relatedType?: string): Promise<Notification>;

  getStats(): Promise<any>;

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

  getAdmins(): Promise<User[]>;
  getUnreadNotificationCount(userId: number): Promise<number>;
  markAllNotificationsRead(userId: number): Promise<void>;

  savePushSubscription(userId: number, endpoint: string, p256dh: string, auth: string): Promise<PushSubscription>;
  deletePushSubscription(endpoint: string): Promise<void>;
  getPushSubscriptionsForUser(userId: number): Promise<PushSubscription[]>;
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
      orderList = await db.select().from(orders).where(and(eq(orders.createdById, userId), ne(orders.status, "pending_payment"))).orderBy(desc(orders.createdAt));
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

  async getOrderServices(orderId: number): Promise<OrderService[]> {
    return await db.select().from(orderServices).where(eq(orderServices.orderId, orderId));
  }

  async createOrderService(service: InsertOrderService): Promise<OrderService> {
    const [newService] = await db.insert(orderServices).values(service).returning();
    return newService;
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

  async markNotificationRead(id: number): Promise<Notification> {
    const [notification] = await db.update(notifications)
      .set({ read: true })
      .where(eq(notifications.id, id))
      .returning();
    return notification;
  }

  async createNotification(userId: number, type: string, title: string, message: string, priority: string, relatedId?: number, relatedType?: string): Promise<Notification> {
    const [notification] = await db.insert(notifications).values({
      userId,
      type,
      title,
      message,
      priority,
      relatedId,
      relatedType,
    }).returning();
    return notification;
  }

  async getStats(): Promise<any> {
    const allOrdersRaw = await db.select().from(orders);
    const allOrders = allOrdersRaw.filter(o => o.advancePaymentStatus === 'approved');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayOrders = allOrders.filter(o => new Date(o.createdAt!) >= today);
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);
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

    const totalRevenue = allOrders.reduce((acc, curr) => acc + (curr.advanceAmount || 0), 0);
    const pendingPayments = allOrders.reduce((acc, curr) => acc + (curr.remainingAmount || 0), 0);

    return {
      orders: orderStats,
      finance: {
        totalRevenue,
        monthlyRevenue: monthlyOrders.reduce((acc, curr) => acc + (curr.advanceAmount || 0), 0),
        pendingPayments,
      },
    };
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
