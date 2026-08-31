import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const platformsCatalog = pgTable("platforms_catalog", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  hasCampaignFields: boolean("has_campaign_fields").default(false).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const servicesCatalog = pgTable("services_catalog", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const packageConfigs = pgTable("package_configs", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userRoles = ["admin", "support", "designer"] as const;
export const orderStatuses = ["pending_payment", "new", "working", "ready", "delivered", "canceled"] as const;
export const priorities = ["normal", "high", "urgent"] as const;
export const paymentVerificationStatuses = ["pending_confirmation", "approved", "disapproved"] as const;
export const paymentTypes = ["advance", "full", "remaining"] as const;
export const advancePaymentStatuses = ["pending", "approved", "disapproved"] as const;
export const clientTypes = ["national", "international"] as const;
export const activityTypes = [
  "status_change",
  "payment_change",
  "assignment",
  "note",
  "verification",
  "complaint_created",
  "complaint_status",
  "complaint_note",
  "complaint_resolution",
  "complaint_resolved",
] as const;
export const complaintCategories = [
  "communication_issue",
  "slow_response",
  "delivery_delay",
  "work_quality_issue",
  "instructions_not_followed",
  "revision_handling_issue",
  "incorrect_information",
  "unprofessional_behavior",
  "process_policy_violation",
  "unauthorized_commitment",
  "other",
] as const;
export const complaintStatuses = ["new", "under_review", "valid", "invalid", "resolved"] as const;

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role", { enum: userRoles }).notNull().default("designer"),
  name: text("name").notNull(),
  title: text("title"),
  avatar: text("avatar"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").unique(),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone"),
  clientEmail: text("client_email"),
  clientType: text("client_type", { enum: clientTypes }).notNull().default("national"),
  status: text("status", { enum: orderStatuses }).notNull().default("new"),
  priority: text("priority", { enum: priorities }).notNull().default("normal"),
  assignedToId: integer("assigned_to_id").references(() => users.id),
  readyDate: timestamp("ready_date"),
  paymentStatus: text("payment_status").default("pending"),
  advancePaymentStatus: text("advance_payment_status", { enum: advancePaymentStatuses }).default("pending"),
  intendedDesignerId: integer("intended_designer_id").references(() => users.id),
  totalPrice: integer("total_price").notNull().default(0),
  advanceAmount: integer("advance_amount").default(0),
  remainingAmount: integer("remaining_amount").default(0),
  discountAmount: integer("discount_amount").default(0),
  paymentMethod: text("payment_method"),
  paymentDate: timestamp("payment_date"),
  deliveredAt: timestamp("delivered_at"),
  platform: text("platform"),
  campaign: text("campaign"),
  adSet: text("ad_set"),
  creative: text("creative"),
  // Package keys come from the admin-managed package catalog, so this must remain
  // an unrestricted string rather than a fixed enum.
  packageType: text("package_type"),
  notes: text("notes"),
  internalNotes: text("internal_notes"),
  createdById: integer("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orderServices = pgTable("order_services", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id),
  serviceType: text("service_type").notNull(),
  quantity: integer("quantity").notNull().default(1),
  instructions: text("instructions"),
  status: text("status", { enum: orderStatuses }).notNull().default("new"),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  type: text("type").notNull(),
  title: text("title").notNull().default(""),
  message: text("message").notNull(),
  priority: text("priority").notNull().default("update"),
  read: boolean("read").default(false).notNull(),
  relatedId: integer("related_id"),
  relatedType: text("related_type"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id),
  actorId: integer("actor_id").references(() => users.id),
  activityType: text("activity_type", { enum: activityTypes }).notNull(),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  details: jsonb("details").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const paymentVerifications = pgTable("payment_verifications", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id),
  paymentType: text("payment_type", { enum: paymentTypes }).notNull(),
  amount: integer("amount").notNull(),
  screenshotUrl: text("screenshot_url"),
  screenshotData: text("screenshot_data"),
  screenshotMimeType: text("screenshot_mime_type"),
  submittedById: integer("submitted_by_id").notNull().references(() => users.id),
  status: text("status", { enum: paymentVerificationStatuses }).default("pending_confirmation"),
  reviewedById: integer("reviewed_by_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const complaints = pgTable("complaints", {
  id: serial("id").primaryKey(),
  complaintNumber: text("complaint_number").notNull().unique(),
  orderId: integer("order_id").notNull().references(() => orders.id),
  complaintAgainstUserId: integer("complaint_against_user_id").notNull().references(() => users.id),
  filedByUserId: integer("filed_by_user_id").notNull().references(() => users.id),
  category: text("category", { enum: complaintCategories }).notNull(),
  description: text("description").notNull(),
  status: text("status", { enum: complaintStatuses }).notNull().default("new"),
  adminNotes: text("admin_notes"),
  resolution: text("resolution"),
  resolvedByUserId: integer("resolved_by_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const supportDesignerAssignments = pgTable("support_designer_assignments", {
  id: serial("id").primaryKey(),
  supportUserId: integer("support_user_id").notNull().references(() => users.id),
  designerUserId: integer("designer_user_id").notNull().references(() => users.id),
  assignedAt: timestamp("assigned_at").defaultNow(),
});

export const monthlyFinance = pgTable("monthly_finance", {
  id: serial("id").primaryKey(),
  month: text("month").notNull().unique(),
  totalCollected: integer("total_collected").default(0),
  totalRemaining: integer("total_remaining").default(0),
  totalOrders: integer("total_orders").default(0),
  paidOrders: integer("paid_orders").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  orders: many(orders),
  notifications: many(notifications),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  assignee: one(users, {
    fields: [orders.assignedToId],
    references: [users.id],
  }),
  createdBy: one(users, {
    fields: [orders.createdById],
    references: [users.id],
  }),
  services: many(orderServices),
  activityLogs: many(activityLogs),
  paymentVerifications: many(paymentVerifications),
  complaints: many(complaints),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  order: one(orders, {
    fields: [activityLogs.orderId],
    references: [orders.id],
  }),
  actor: one(users, {
    fields: [activityLogs.actorId],
    references: [users.id],
  }),
}));

export const paymentVerificationsRelations = relations(paymentVerifications, ({ one }) => ({
  order: one(orders, {
    fields: [paymentVerifications.orderId],
    references: [orders.id],
  }),
  submittedBy: one(users, {
    fields: [paymentVerifications.submittedById],
    references: [users.id],
  }),
  reviewedBy: one(users, {
    fields: [paymentVerifications.reviewedById],
    references: [users.id],
  }),
}));

export const complaintsRelations = relations(complaints, ({ one }) => ({
  order: one(orders, {
    fields: [complaints.orderId],
    references: [orders.id],
  }),
  complaintAgainst: one(users, {
    fields: [complaints.complaintAgainstUserId],
    references: [users.id],
    relationName: "complaintAgainst",
  }),
  filedBy: one(users, {
    fields: [complaints.filedByUserId],
    references: [users.id],
    relationName: "complaintFiledBy",
  }),
  resolvedBy: one(users, {
    fields: [complaints.resolvedByUserId],
    references: [users.id],
    relationName: "complaintResolvedBy",
  }),
}));

export const orderServicesRelations = relations(orderServices, ({ one }) => ({
  order: one(orders, {
    fields: [orderServices.orderId],
    references: [orders.id],
  }),
}));

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, createdAt: true });
export const insertOrderServiceSchema = createInsertSchema(orderServices).omit({ id: true });
export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({ id: true, createdAt: true });
export const insertPaymentVerificationSchema = createInsertSchema(paymentVerifications).omit({ id: true, createdAt: true });
export const insertComplaintSchema = createInsertSchema(complaints).omit({
  id: true,
  complaintNumber: true,
  createdAt: true,
  updatedAt: true,
});
export const insertSupportDesignerAssignmentSchema = createInsertSchema(supportDesignerAssignments).omit({ id: true, assignedAt: true });
export const insertServicesCatalogSchema = createInsertSchema(servicesCatalog).omit({ id: true, createdAt: true });
export const insertPackageConfigSchema = createInsertSchema(packageConfigs).omit({ id: true, createdAt: true });
export const insertPlatformsCatalogSchema = createInsertSchema(platformsCatalog).omit({ id: true, createdAt: true });

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type OrderService = typeof orderServices.$inferSelect;
export type InsertOrderService = z.infer<typeof insertOrderServiceSchema>;
export type Notification = typeof notifications.$inferSelect;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type PaymentVerification = typeof paymentVerifications.$inferSelect;
export type InsertPaymentVerification = z.infer<typeof insertPaymentVerificationSchema>;
export type Complaint = typeof complaints.$inferSelect;
export type InsertComplaint = z.infer<typeof insertComplaintSchema>;
export type MonthlyFinance = typeof monthlyFinance.$inferSelect;
export type UserRole = (typeof userRoles)[number];

export type OrderWithServices = Order & {
  services: OrderService[];
  assignee?: User | null;
};

export type ActivityLogWithActor = ActivityLog & {
  actor?: User | null;
};

export type PaymentVerificationWithUsers = PaymentVerification & {
  submittedBy?: User | null;
  reviewedBy?: User | null;
};

export type SupportDesignerAssignment = typeof supportDesignerAssignments.$inferSelect;
export type InsertSupportDesignerAssignment = z.infer<typeof insertSupportDesignerAssignmentSchema>;
export type ServiceCatalogItem = typeof servicesCatalog.$inferSelect;
export type InsertServiceCatalogItem = z.infer<typeof insertServicesCatalogSchema>;
export type PackageConfig = typeof packageConfigs.$inferSelect;
export type InsertPackageConfig = z.infer<typeof insertPackageConfigSchema>;
export type PlatformCatalogItem = typeof platformsCatalog.$inferSelect;
export type InsertPlatformCatalogItem = z.infer<typeof insertPlatformsCatalogSchema>;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export type ComplaintUserSummary = Pick<User, "id" | "name" | "role" | "title" | "avatar">;
export type ComplaintResponse = {
  id: number;
  complaintNumber: string;
  orderId: number;
  orderNumber: string | null;
  clientName: string;
  complaintAgainst: ComplaintUserSummary;
  category: (typeof complaintCategories)[number];
  description: string;
  status: (typeof complaintStatuses)[number];
  filedBy?: ComplaintUserSummary;
  adminNotes?: string | null;
  resolution?: string | null;
  resolvedBy?: ComplaintUserSummary | null;
  resolvedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type ComplaintHistoryEntry = {
  id: number;
  action: string;
  previousValue: string | null;
  newValue: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date | null;
  actor?: ComplaintUserSummary;
};

export type ComplaintStats = {
  total: number;
  thisMonth: number;
  new: number;
  underReview: number;
  valid: number;
  invalid: number;
  resolved: number;
};
