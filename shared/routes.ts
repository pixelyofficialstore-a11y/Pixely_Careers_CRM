import { z } from "zod";
import {
  insertUserSchema,
  insertOrderSchema,
  users,
  orders,
  notifications,
  complaintCategories,
  complaintStatuses,
  type ComplaintResponse,
  type ComplaintHistoryEntry,
  type ComplaintStats,
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
        complaintAgainstUserId: z.number().int().positive().optional(),
        category: z.enum(complaintCategories),
        description: z.string().trim().min(1, "Description is required").max(5000),
      }),
      responses: {
        201: z.custom<ComplaintResponse>(),
        400: errorSchemas.validation,
        403: errorSchemas.forbidden,
      },
    },
    update: {
      method: "PATCH" as const,
      path: "/api/complaints/:id",
      input: z.object({
        status: z.enum(complaintStatuses).optional(),
        adminNotes: z.string().trim().max(5000).nullable().optional(),
        resolution: z.string().trim().max(5000).nullable().optional(),
        confirmDecision: z.boolean().optional(),
      }),
      responses: {
        200: z.custom<ComplaintResponse>(),
        400: errorSchemas.validation,
        403: errorSchemas.forbidden,
        404: errorSchemas.notFound,
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
