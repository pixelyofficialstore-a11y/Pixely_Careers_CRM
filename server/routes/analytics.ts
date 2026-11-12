/** Dashboard metrics, analytics and complaint stats (numbers come from server/metrics.ts). */
import type { Express } from "express";
import { storage } from "../storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { type User } from "@shared/schema";
import { adminHome, supportHome, designerHome } from "../homeDashboard";
import { getDashboardMetrics, getMonthlySeries, businessMonthRange, getDesignerAnalytics, getDesignerOrders, getMarketingAnalytics, getSupportAnalytics } from "../metrics";
import { requireAuth, requireRole } from "./shared";

export function registerAnalyticsRoutes(app: Express) {
  // server/metrics.ts is the single source of dashboard numbers.
  app.get("/api/metrics/dashboard", requireAuth, async (req, res) => {
    const user = req.user as User;
    const [metrics, complaints] = await Promise.all([
      getDashboardMetrics(user),
      storage.getComplaintStats(user.role, user.id, {}),
    ]);
    res.json({ ...metrics, complaints });
  });

  // Analytics page: SQL aggregates only (admin).
  const analyticsMonth = z.object({ year: z.coerce.number().int().min(2020).max(2100), month: z.coerce.number().int().min(1).max(12) });
  const analyticsRange = (q: unknown) => {
    const p = analyticsMonth.extend({ period: z.enum(["all", "month"]).default("month") }).strict().parse(q);
    return p.period === "all" ? null : businessMonthRange(p.year, p.month);
  };
  app.get("/api/analytics/designers", requireRole(["admin"]), async (req, res) => {
    res.json(await getDesignerAnalytics(analyticsRange(req.query)));
  });
  app.get("/api/analytics/designers/:id/orders", requireRole(["admin"]), async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json(await getDesignerOrders(id, analyticsRange(req.query)));
  });
  app.get("/api/analytics/marketing", requireRole(["admin"]), async (req, res) => {
    const q = analyticsMonth.strict().parse(req.query);
    res.json(await getMarketingAnalytics(q.year, q.month));
  });
  app.get("/api/analytics/support", requireRole(["admin"]), async (req, res) => {
    const q = analyticsMonth.extend({ day: z.coerce.number().int().min(1).max(31) }).strict().parse(req.query);
    res.json(await getSupportAnalytics(q.year, q.month, q.day));
  });

  // Phase 4: per-role home dashboard.
  app.get("/api/dashboard/home", requireAuth, async (req, res) => {
    const user = req.user as User;
    const data = user.role === "admin" ? await adminHome(user) : user.role === "support" ? await supportHome(user) : await designerHome(user);
    res.json(data);
  });

  app.get("/api/metrics/monthly", requireRole(["admin"]), async (req, res) => {
    const { months } = z.object({ months: z.coerce.number().int().min(1).max(24).default(12) }).strict().parse(req.query);
    res.json(await getMonthlySeries(months));
  });
  // Complaint statistics (filters: month/year/designerId). Order and money
  // numbers come from /api/metrics/* (server/metrics.ts).
  app.get(api.stats.dashboard.path, requireAuth, async (req, res) => {
    const user = req.user as User;
    const month = typeof req.query.month === "string" && /^(?:[1-9]|1[0-2])$/.test(req.query.month)
      ? Number(req.query.month) : undefined;
    const year = typeof req.query.year === "string" && /^\d{4}$/.test(req.query.year)
      ? Number(req.query.year) : undefined;
    const designerId = typeof req.query.designerId === "string" && /^\d+$/.test(req.query.designerId)
      ? Number(req.query.designerId) : undefined;
    res.json({ complaints: await storage.getComplaintStats(user.role, user.id, { month, year, designerId }) });
  });
}
