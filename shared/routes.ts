import { z } from "zod";
import {
  insertUserSchema,
  insertOrderSchema,
  users,
  orders,
  notifications,
  complaintCategories,
  complaintStatuses,
  complaintResolutionOutcomes,
  suggestionStatuses,
  type ComplaintResponse,
  type ComplaintHistoryEntry,
  type ComplaintStats,
  type ClientCaseReport,
} from "./schema";

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
  unauthorized: z.object({
    message: z.string(),
  }),
  forbidden: z.object({
    message: z.string(),
  }),
};

export const api = {
  auth: {
    login: {
      method: "POST" as const,
      path: "/api/login",
      input: z.object({
        username: z.string(),
        password: z.string(),
      }),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: errorSchemas.unauthorized,
        403: errorSchemas.forbidden,
      },
    },
    logout: {
      method: "POST" as const,
      path: "/api/logout",
      responses: {
        200: z.object({ message: z.string() }),
      },
    },
    me: {
      method: "GET" as const,
      path: "/api/user",
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: errorSchemas.unauthorized,
      },
    },
  },
  users: {
    list: {
      method: "GET" as const,
      path: "/api/users",
      responses: {
        200: z.array(z.custom<typeof users.$inferSelect>()),
      },
    },
    create: {
      method: "POST" as const,
      path: "/api/users",
      input: insertUserSchema,
      responses: {
        201: z.custom<typeof users.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: "PATCH" as const,
      path: "/api/users/:id",
      input: insertUserSchema.partial(),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
  orders: {
    list: {
      method: "GET" as const,
      path: "/api/orders",
      responses: {
        200: z.array(z.custom<typeof orders.$inferSelect & { assignee?: typeof users.$inferSelect | null }>()),
      },
    },
    get: {
      method: "GET" as const,
      path: "/api/orders/:id",
      responses: {
        200: z.custom<typeof orders.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: "POST" as const,
      path: "/api/orders",
      input: insertOrderSchema,
      responses: {
        201: z.custom<typeof orders.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: "PATCH" as const,
      path: "/api/orders/:id",
      input: insertOrderSchema.partial(),
      responses: {
        200: z.custom<typeof orders.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    remove: {
      method: "DELETE" as const,
      path: "/api/orders/:id",
      responses: {
        200: z.object({ success: z.boolean() }),
        403: errorSchemas.forbidden,
        404: errorSchemas.notFound,
      },
    },
    clientCaseReport: {
      method: "GET" as const,
      path: "/api/orders/:id/client-case-report",
      responses: {
        200: z.custom<ClientCaseReport>(),
        403: errorSchemas.forbidden,
        404: errorSchemas.notFound,
      },
    },
  },
  notifications: {
    list: {
      method: "GET" as const,
      path: "/api/notifications",
      responses: {
        200: z.array(z.custom<typeof notifications.$inferSelect>()),
      },
    },
    markRead: {
      method: "PATCH" as const,
      path: "/api/notifications/:id/read",
      responses: {
        200: z.custom<typeof notifications.$inferSelect>(),
      },
    },
  },
  complaints: {
    list: {
      method: "GET" as const,
      path: "/api/complaints",
      responses: {
        200: z.array(z.custom<ComplaintResponse>()),
      },
    },
    get: {
      method: "GET" as const,
      path: "/api/complaints/:id",
      responses: {
        200: z.custom<ComplaintResponse>(),
        404: errorSchemas.notFound,
        403: errorSchemas.forbidden,
      },
    },
    create: {
      method: "POST" as const,
      path: "/api/complaints",
      input: z.object({
        orderId: z.number().int().positive(),
        // Kept as an optional compatibility field, but new complaints may
        // only explicitly identify the supported team-member target.
        complaintTargetType: z.literal("designer").optional(),
        target_type: z.literal("designer").optional(),
        targetType: z.literal("designer").optional(),
        complaint_target_type: z.literal("designer").optional(),
        complaintAgainstUserId: z.number().int().positive().optional(),
        category: z.string().trim().min(1, "Category is required").max(100),
        description: z.string().trim().min(1, "Description is required").max(5000),
        screenshotUrl: z.string().url().optional(),
        evidence: z.array(z.object({
          url: z.string().url(),
          fileName: z.string().trim().min(1).max(255),
          fileSize: z.number().int().nonnegative().max(5 * 1024 * 1024),
        })).max(5).optional(),
      }),
      responses: {
        201: z.custom<ComplaintResponse>(),
        400: errorSchemas.validation,
        403: errorSchemas.forbidden,
      },
    },
    actionableCount: {
      method: "GET" as const,
      path: "/api/complaints/actionable-count",
      responses: { 200: z.object({ count: z.number().int().nonnegative() }) },
    },
    update: {
      method: "PATCH" as const,
      path: "/api/complaints/:id",
      input: z.object({
        status: z.enum(complaintStatuses).optional(),
        adminNote: z.string().trim().min(1).max(5000).optional(),
        adminNotes: z.string().trim().max(5000).nullable().optional(),
        resolution: z.string().trim().max(5000).nullable().optional(),
        resolutionOutcome: z.enum(complaintResolutionOutcomes).nullable().optional(),
        resolutionScreenshotUrl: z.string().url().nullable().optional(),
        dismissalReason: z.string().trim().max(5000).nullable().optional(),
        refundConfirmed: z.boolean().optional(),
        confirmDecision: z.boolean().optional(),
      }),
      responses: {
        200: z.custom<ComplaintResponse>(),
        400: errorSchemas.validation,
        403: errorSchemas.forbidden,
        404: errorSchemas.notFound,
      },
    },
    designerExplanation: {
      method: "PATCH" as const,
      path: "/api/complaints/:id/designer-explanation",
      input: z.object({
        explanation: z.string().trim().min(1, "Please explain your side.").max(5000),
        evidence: z.array(z.object({
          url: z.string().url(),
          fileName: z.string().trim().min(1).max(255),
          fileSize: z.number().int().nonnegative().max(5 * 1024 * 1024),
        })).max(5).optional(),
      }),
      responses: {
        200: z.custom<ComplaintResponse>(),
        400: errorSchemas.validation,
        403: errorSchemas.forbidden,
        404: errorSchemas.notFound,
        409: errorSchemas.conflict,
      },
    },
    history: {
      method: "GET" as const,
      path: "/api/complaints/:id/history",
      responses: {
        200: z.array(z.custom<ComplaintHistoryEntry>()),
        403: errorSchemas.forbidden,
      },
    },
  },
  orderComplaints: {
    list: {
      method: "GET" as const,
      path: "/api/orders/:id/complaints",
      responses: {
        200: z.array(z.custom<ComplaintResponse>()),
      },
    },
  },
  feedback: {
    reviews: {
      list: { method: "GET" as const, path: "/api/feedback/reviews", responses: { 200: z.array(z.any()) } },
      create: { method: "POST" as const, path: "/api/feedback/reviews", input: z.object({ orderId: z.number().int().positive(), rating: z.number().int().min(1).max(5).nullable(), feedbackText: z.string().trim().max(5000), whatsappFeedbackReceived: z.boolean(), facebookReviewReceived: z.boolean(), videoReviewReceived: z.boolean(), publicReviewLink: z.string().url().nullable(), marketingPermission: z.enum(["yes", "no", "not_asked"]), screenshotUrl: z.string().url().nullable() }), responses: { 201: z.any(), 400: errorSchemas.validation } },
      update: { method: "PATCH" as const, path: "/api/feedback/reviews/:id", input: z.object({ rating: z.number().int().min(1).max(5).nullable().optional(), feedbackText: z.string().trim().max(5000).optional(), whatsappFeedbackReceived: z.boolean().optional(), facebookReviewReceived: z.boolean().optional(), videoReviewReceived: z.boolean().optional(), publicReviewLink: z.string().url().nullable().optional(), marketingPermission: z.enum(["yes", "no", "not_asked"]).optional(), screenshotUrl: z.string().url().nullable().optional() }), responses: { 200: z.any() } },
    },
    suggestions: {
      list: { method: "GET" as const, path: "/api/feedback/suggestions", responses: { 200: z.array(z.any()) } },
       create: { method: "POST" as const, path: "/api/feedback/suggestions", input: z.object({ orderId: z.number().int().positive(), suggestionText: z.string().trim().min(1).max(5000), screenshotUrl: z.string().url().nullable() }), responses: { 201: z.any() } },
      update: { method: "PATCH" as const, path: "/api/feedback/suggestions/:id", input: z.object({
        status: z.enum(suggestionStatuses).optional(),
        adminNote: z.string().trim().min(1).max(5000).optional(),
        implementationDetails: z.string().trim().min(1).max(5000).optional(),
        implementationScreenshotUrl: z.string().url().nullable().optional(),
        rejectionReason: z.string().trim().min(1).max(5000).optional(),
        confirmDecision: z.boolean().optional(),
      }), responses: { 200: z.any() } },
    },
  },
  stats: {
    dashboard: {
      method: "GET" as const,
      path: "/api/stats",
      responses: {
        200: z.object({
          orders: z.object({
            total: z.number(),
            pending: z.number(),
            working: z.number(),
            ready: z.number(),
            delivered: z.number(),
          }),
          finance: z.object({
            totalRevenue: z.number().optional(),
            monthlyRevenue: z.number().optional(),
            pendingPayments: z.number().optional(),
            todayCashFlow: z.object({
              advance: z.number(),
              remaining: z.number(),
              total: z.number(),
            }).optional(),
            monthlyCashFlow: z.object({
              inflow: z.number(),
              refunds: z.number(),
              net: z.number(),
            }).optional(),
          }).optional(),
          complaints: z.custom<ComplaintStats>(),
        }),
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
