/** Client reviews and suggestions. */
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { type User, type InsertClientSuggestion } from "@shared/schema";
import multer from "multer";
import { isCloudinaryConfigured } from "../cloudinary";
import { uploadPrivateImage } from "../files";
import { projectSuggestionForRole, type CaseRole } from "@shared/case-access";
import { dispatchNotifications, safeUserSummary, requireAuth, requireRole, fileRefOk, normalizeImage, optionalOrderId, canAccessOrder } from "./shared";

/** Optional ?page=&pageSize= envelope for list endpoints (50/page default). */
export const pageArgs = (req: Request) => {
  if (typeof req.query.page !== "string") return null;
  const page = Math.max(1, Math.min(100_000, Number.parseInt(req.query.page, 10) || 1));
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(String(req.query.pageSize ?? "50"), 10) || 50));
  return { page, pageSize, start: (page - 1) * pageSize, end: page * pageSize };
};
/** Project (join orders/users) only the rows on the requested page unless a search needs every row. */
export const sendFeedbackList = async (req: Request, res: Response, rows: any[], kind: "review" | "suggestion", role: string, haystack: (r: any) => unknown[]) => {
  const search = feedbackFilters(req).search;
  const p = pageArgs(req);
  if (!search) {
    const slice = p ? rows.slice(p.start, p.end) : rows;
    const projected = await feedbackProjection(slice, kind, role);
    return res.json(p ? { rows: projected, total: rows.length, page: p.page, pageSize: p.pageSize } : projected);
  }
  const matched = (await feedbackProjection(rows, kind, role)).filter((r: any) => haystack(r).some(v => String(v || "").toLowerCase().includes(search)));
  return res.json(p ? { rows: matched.slice(p.start, p.end), total: matched.length, page: p.page, pageSize: p.pageSize } : matched);
};
export const feedbackProjection = async (items: any[], kind: "review" | "suggestion", role: string) => {
  // Batched: one query for orders, one for services, one for notes (was one getOrder per item).
  const [allUsers, ordersById, notesBySuggestion] = await Promise.all([
    storage.getUsers(),
    storage.getOrdersWithServicesByIds(Array.from(new Set(items.map(item => item.orderId)))),
    kind === "suggestion" && role === "admin" ? storage.getSuggestionNotesFor(items.map(item => item.id)) : Promise.resolve(new Map()),
  ]);
  const userById = new Map(allUsers.map(person => [person.id, person]));
  return Promise.all(items.map(async (item) => {
    const order = ordersById.get(item.orderId);
    const summary = (id: number | null | undefined) => id ? safeUserSummary(userById.get(id)) : null;
    if (kind === "review") {
      return { ...item, orderNumber: order?.orderNumber || null, clientName: order?.clientName || "", order: order ? { packageType: order.packageType, services: order.services, paymentStatus: order.paymentStatus, status: order.status } : undefined, reviewForDesigner: summary(item.reviewForDesignerId), createdBy: summary(item.createdById) };
    }
    const { category: _legacyCategory, ...suggestionFields } = item;
    const suggestion = projectSuggestionForRole(suggestionFields, role as CaseRole);
    return {
      ...suggestion,
      ...(role === "admin" ? { adminNotes: undefined } : {}),
      adminNotesLog: role === "admin" ? (notesBySuggestion.get(item.id) ?? []) : undefined,
      orderNumber: order?.orderNumber || null,
      clientName: order?.clientName || "",
      order: order ? { packageType: order.packageType, services: order.services, status: order.status } : undefined,
      relatedDesigner: summary(item.relatedDesignerId),
      createdBy: summary(item.createdById),
      implementedBy: summary(item.implementedByUserId),
      rejectedBy: summary(item.rejectedByUserId),
    };
  }));
};
export const feedbackFilters = (req: Request) => ({
  search: typeof req.query.search === "string" ? req.query.search.toLowerCase() : "",
  month: typeof req.query.month === "string" ? Number(req.query.month) : undefined,
  year: typeof req.query.year === "string" ? Number(req.query.year) : undefined,
  designerId: typeof req.query.designerId === "string" ? Number(req.query.designerId) : undefined,
  status: typeof req.query.status === "string" ? req.query.status : undefined,
});
export const filterFeedback = (items: any[], filters: ReturnType<typeof feedbackFilters>, kind: "review" | "suggestion") => items.filter(item => {
  const created = item.createdAt ? new Date(item.createdAt) : null;
  if (filters.month && created?.getMonth() !== filters.month - 1) return false;
  if (filters.year && created?.getFullYear() !== filters.year) return false;
  if (filters.designerId && (kind === "review" ? item.reviewForDesignerId : item.relatedDesignerId) !== filters.designerId) return false;
  if (filters.status && kind === "suggestion" && item.status !== filters.status) return false;
  return true;
});


export function registerFeedbackRoutes(app: Express) {
  const feedbackUpload = multer({
    storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)),
  }).single("screenshot");
  app.post("/api/feedback/upload", requireRole(["admin", "support", "designer"]), (req, res) => {
    feedbackUpload(req, res, async err => {
      if (err) return res.status(400).json({ message: "Invalid image upload." });
      if (!req.file) return res.status(400).json({ message: "An image is required." });
      if (!isCloudinaryConfigured()) return res.status(503).json({ message: "Feedback uploads require Cloudinary configuration." });
      try {
        const kind = req.body.folder === "suggestions" ? "suggestion" : req.body.folder === "complaints" ? "complaint" : "review";
        const folder = kind === "suggestion" ? "pixelcrm/suggestions" : kind === "complaint" ? "pixelcrm/complaints" : "pixelcrm/reviews";
        let image: Buffer;
        try { image = await normalizeImage(req.file.buffer); } catch { return res.status(400).json({ message: "That file is not a valid image." }); }
        const screenshotUrl = await uploadPrivateImage(image, { kind, folder, uploadedById: (req.user as User).id, orderId: optionalOrderId(req.body.orderId) });
        return res.json({ screenshotUrl });
      } catch { return res.status(502).json({ message: "Unable to upload feedback image." }); }
    });
  });

  app.get(api.feedback.reviews.list.path, requireAuth, async (req, res) => {
    const user = req.user as User;
    const orderId = typeof req.query.orderId === "string" && /^\d+$/.test(req.query.orderId) ? Number(req.query.orderId) : undefined;
    const rows = filterFeedback(await storage.getClientReviews(user.role, user.id, orderId), feedbackFilters(req), "review");
    await sendFeedbackList(req, res, rows, "review", user.role, (r: any) => [r.reviewNumber, r.clientName, r.feedbackText, r.orderNumber, r.reviewForDesigner?.name]);
  });
  app.get("/api/orders/:id/client-reviews", requireAuth, async (req, res) => {
    const orderId = Number(req.params.id); const user = req.user as User;
    const order = await canAccessOrder(user, orderId);
    if (!order) return res.sendStatus(order === null ? 403 : 404);
    res.json(await feedbackProjection(await storage.getClientReviews(user.role, user.id, orderId), "review", user.role));
  });
  app.post(api.feedback.reviews.create.path, requireAuth, async (req, res) => {
    try {
      const input = api.feedback.reviews.create.input.parse(req.body);
      const user = req.user as User; const order = await canAccessOrder(user, input.orderId);
      if (!order) return res.sendStatus(order === null ? 403 : 404);
      if (input.screenshotUrl && !(await fileRefOk(input.screenshotUrl, req))) return res.status(400).json({ message: "Screenshot must be an image uploaded in the CRM." });
      if (await storage.getClientReviewByOrder(input.orderId)) return res.status(409).json({ message: "This order already has a client review." });
       const review = await storage.createClientReview({ ...input, reviewForDesignerId: order.assignedToId ?? null, createdById: user.id });
       await storage.createActivityLog({ orderId: input.orderId, actorId: user.id, activityType: "review_created", newValue: review.reviewNumber, details: { reviewId: review.id, reviewNumber: review.reviewNumber } });
        const reviewAdmins = await storage.getAdmins();
        await dispatchNotifications(
          reviewAdmins.map(admin => admin.id),
          {
            event: "review_created",
            type: "review",
            title: "New Client Review",
            message: "New client review received. Review feedback in CRM.",
            priority: "update",
            relatedId: review.id,
            relatedType: "review",
            sourceEventId: review.id,
          },
        );
      res.status(201).json((await feedbackProjection([review], "review", user.role))[0]);
    } catch (err) { if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || "Invalid review." }); return res.status(500).json({ message: "Unable to create client review." }); }
  });
  app.patch(api.feedback.reviews.update.path, requireAuth, async (req, res) => {
    try {
      const input = api.feedback.reviews.update.input.parse(req.body); const id = Number(req.params.id);
      const existing = (await storage.getClientReviews("admin", 0)).find(row => row.id === id);
      if (!existing) return res.sendStatus(404);
      const user = req.user as User; const order = await canAccessOrder(user, existing.orderId);
      if (!order) return res.sendStatus(order === null ? 403 : 404);
      if (input.screenshotUrl && !(await fileRefOk(input.screenshotUrl, req))) return res.status(400).json({ message: "Screenshot must be an image uploaded in the CRM." });
       const reviewChanges = input;
       const review = await storage.updateClientReview(id, reviewChanges);
      const changedFields = Object.keys(reviewChanges).filter(field => (reviewChanges as any)[field] !== (existing as any)[field]);
      if (changedFields.length) {
        await storage.createActivityLog({ orderId: existing.orderId, actorId: user.id, activityType: "review_updated", details: { reviewId: id, fields: changedFields } });
      }
      for (const [field, label] of [["whatsappFeedbackReceived", "whatsapp"], ["facebookReviewReceived", "facebook"], ["videoReviewReceived", "video"]] as const) {
        if (input[field] === true && existing[field] === false) {
          await storage.createActivityLog({ orderId: existing.orderId, actorId: user.id, activityType: "review_updated", newValue: label, details: { reviewId: id, channelReceived: label } });
        }
      }
      res.json((await feedbackProjection([review], "review", user.role))[0]);
    } catch (err) { if (err instanceof z.ZodError) return res.status(400).json({ message: "Invalid review." }); return res.status(500).json({ message: "Unable to update client review." }); }
  });
  app.get(api.feedback.suggestions.list.path, requireAuth, async (req, res) => {
    const user = req.user as User; const orderId = typeof req.query.orderId === "string" && /^\d+$/.test(req.query.orderId) ? Number(req.query.orderId) : undefined;
    const rows = filterFeedback(await storage.getClientSuggestions(user.role, user.id, orderId), feedbackFilters(req), "suggestion");
    await sendFeedbackList(req, res, rows, "suggestion", user.role, (r: any) => [r.suggestionNumber, r.clientName, r.suggestionText, r.orderNumber, r.relatedDesigner?.name]);
  });
  app.get("/api/orders/:id/client-suggestions", requireAuth, async (req, res) => {
    const orderId = Number(req.params.id); const user = req.user as User;
    const order = await canAccessOrder(user, orderId);
    if (!order) return res.sendStatus(order === null ? 403 : 404);
    res.json(await feedbackProjection(await storage.getClientSuggestions(user.role, user.id, orderId), "suggestion", user.role));
  });
  app.get("/api/feedback/stats", requireAuth, async (req, res) => {
    const user = req.user as User;
    const [reviewRows, suggestionRows] = await Promise.all([
      storage.getClientReviews(user.role, user.id),
      storage.getClientSuggestions(user.role, user.id),
    ]);
    const filters = feedbackFilters(req);
    const visibleReviews = user.role === "support" ? reviewRows.filter(review => review.createdById === user.id) : reviewRows;
    const visibleSuggestions = user.role === "support" ? suggestionRows.filter(suggestion => suggestion.createdById === user.id) : suggestionRows;
    const reviews = filterFeedback(visibleReviews, filters, "review");
    const suggestions = filterFeedback(visibleSuggestions, filters, "suggestion");
    const rated = reviews.filter(review => review.rating !== null);
    res.json({
      reviews: { all: reviews.length, averageRating: rated.length ? rated.reduce((sum, review) => sum + (review.rating || 0), 0) / rated.length : null, whatsapp: reviews.filter(r => r.whatsappFeedbackReceived).length, facebook: reviews.filter(r => r.facebookReviewReceived).length, video: reviews.filter(r => r.videoReviewReceived).length },
      suggestions: { all: suggestions.length, new: suggestions.filter(s => s.status === "new").length, implemented: suggestions.filter(s => s.status === "implemented").length, rejected: suggestions.filter(s => s.status === "rejected").length },
    });
  });
  app.post(api.feedback.suggestions.create.path, requireAuth, async (req, res) => {
    try {
      const input = api.feedback.suggestions.create.input.parse(req.body); const user = req.user as User; const order = await canAccessOrder(user, input.orderId);
      if (!order) return res.sendStatus(order === null ? 403 : 404);
      if (input.screenshotUrl && !(await fileRefOk(input.screenshotUrl, req))) return res.status(400).json({ message: "Screenshot must be an image uploaded in the CRM." });
      const suggestion = await storage.createClientSuggestion({ ...input, category: "other", relatedDesignerId: order.assignedToId ?? null, createdById: user.id, reviewedByUserId: null, reviewedAt: null, adminNotes: null });
      await storage.createActivityLog({ orderId: input.orderId, actorId: user.id, activityType: "suggestion_created", newValue: suggestion.suggestionNumber, details: { suggestionId: suggestion.id } });
       const suggestionAdmins = await storage.getAdmins();
       await dispatchNotifications(
         suggestionAdmins.map(admin => admin.id),
         {
           event: "suggestion_created",
           type: "suggestion",
           title: "New Suggestion",
           message: "New team suggestion submitted. Review and evaluate.",
           priority: "update",
           relatedId: suggestion.id,
           relatedType: "suggestion",
           sourceEventId: suggestion.id,
         },
       );
      res.status(201).json((await feedbackProjection([suggestion], "suggestion", user.role))[0]);
    } catch (err) { if (err instanceof z.ZodError) return res.status(400).json({ message: "Invalid suggestion." }); return res.status(500).json({ message: "Unable to create client suggestion." }); }
  });
  app.patch(api.feedback.suggestions.update.path, requireAuth, async (req, res) => {
    try {
      const input = api.feedback.suggestions.update.input.parse(req.body); const id = Number(req.params.id); const existing = await storage.getClientSuggestion(id);
      if (!existing) return res.sendStatus(404);
      const user = req.user as User; const order = await canAccessOrder(user, existing.orderId);
      if (!order) return res.sendStatus(order === null ? 403 : 404);
      if (user.role !== "admin") return res.status(403).json({ message: "Only admins can make suggestion decisions or add internal notes." });
      if (input.status !== undefined && input.status !== existing.status) {
        if (existing.status !== "new" || !["implemented", "rejected"].includes(input.status) || input.confirmDecision !== true) {
          return res.status(400).json({ message: "Suggestions can only move from New to Implemented or Rejected after confirmation." });
        }
        if (input.status === "implemented" && !input.implementationDetails?.trim()) return res.status(400).json({ message: "Implementation details are required." });
        if (input.status === "rejected" && !input.rejectionReason?.trim()) return res.status(400).json({ message: "A reason for rejection is required." });
      }
      if (input.implementationScreenshotUrl && !(await fileRefOk(input.implementationScreenshotUrl, req))) return res.status(400).json({ message: "Implementation evidence must be an image uploaded in the CRM." });
      const { confirmDecision: _confirmDecision, adminNote, ...submittedChanges } = input;
      const now = new Date();
      const suggestionChanges: Partial<InsertClientSuggestion> = input.status === "implemented" ? {
        status: "implemented", implementationDetails: input.implementationDetails, implementationScreenshotUrl: input.implementationScreenshotUrl ?? null,
        implementedByUserId: user.id, implementedAt: now, reviewedByUserId: user.id, reviewedAt: now,
      } : input.status === "rejected" ? {
        status: "rejected", rejectionReason: input.rejectionReason, rejectedByUserId: user.id, rejectedAt: now,
        reviewedByUserId: user.id, reviewedAt: now,
      } : {};
      const suggestion = Object.keys(suggestionChanges).length ? await storage.updateClientSuggestion(id, suggestionChanges) : existing;
      if (input.status !== undefined && input.status !== existing.status) {
        await storage.createActivityLog({
          orderId: existing.orderId, actorId: user.id, activityType: "suggestion_status",
          previousValue: existing.status, newValue: input.status, details: {
            suggestionId: id, suggestionNumber: existing.suggestionNumber,
            ...(input.status === "implemented" ? { implementationDetails: input.implementationDetails } : { rejectionReason: input.rejectionReason }),
          },
        });
      }
      if (adminNote) {
        await storage.addSuggestionNote(id, adminNote, user.id);
        await storage.createActivityLog({
          orderId: existing.orderId, actorId: user.id, activityType: "suggestion_updated",
          details: { suggestionId: id, suggestionNumber: existing.suggestionNumber, event: "admin_note_added" },
        });
      }
      res.json((await feedbackProjection([suggestion], "suggestion", user.role))[0]);
    } catch (err) { if (err instanceof z.ZodError) return res.status(400).json({ message: "Invalid suggestion." }); return res.status(500).json({ message: "Unable to update client suggestion." }); }
  });
}
