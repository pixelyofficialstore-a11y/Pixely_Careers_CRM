/** Complaints: list, create, admin decisions, designer explanations and history. */
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { type User, type InsertActivityLog } from "@shared/schema";
import multer from "multer";
import { isCloudinaryConfigured } from "../cloudinary";
import { emitRealtime } from "../sse";
import { uploadPrivateImage } from "../files";
import { isSupportedComplaintTarget, projectCaseActivity, type CaseRole } from "@shared/case-access";
import { dispatchNotification, dispatchNotifications, statusLabel, requireAuth, requireRole, fileRefOk, allFileRefsOk, normalizeImage, optionalOrderId } from "./shared";

export function registerComplaintRoutes(app: Express) {
  app.get(api.complaints.list.path, requireAuth, async (req, res) => {
    const user = req.user as User;
    const filters = {
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      category: typeof req.query.category === "string" ? req.query.category : undefined,
      designerId: typeof req.query.designerId === "string" && /^\d+$/.test(req.query.designerId) ? Number(req.query.designerId) : undefined,
      month: typeof req.query.month === "string" && /^(?:[1-9]|1[0-2])$/.test(req.query.month) ? Number(req.query.month) : undefined,
      year: typeof req.query.year === "string" && /^\d{4}$/.test(req.query.year) ? Number(req.query.year) : undefined,
    };
    let complaints = await storage.getComplaints(user.role, user.id, filters);
    if (req.query.outcome === "refund") complaints = complaints.filter(c => c.resolutionOutcome === "refund");
    // Paginated when ?page= is given (Complaints page, 50/page).
    if (typeof req.query.page === "string") {
      const page = Math.max(1, Math.min(100_000, Number.parseInt(req.query.page, 10) || 1));
      const pageSize = Math.max(1, Math.min(100, Number.parseInt(String(req.query.pageSize ?? "50"), 10) || 50));
      return res.json({ rows: complaints.slice((page - 1) * pageSize, page * pageSize), total: complaints.length, page, pageSize });
    }
    res.json(complaints);
  });

  app.get(api.complaints.actionableCount.path, requireAuth, async (req, res) => {
    const user = req.user as User;
    const count = await storage.getActionableComplaintCount(user.role, user.id);
    res.json({ count });
  });

  app.get(api.complaints.get.path, requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const user = req.user as User;
    const complaint = await storage.getComplaintForUser(id, user.role, user.id);
    if (!complaint) return res.sendStatus(404);
    res.json(complaint);
  });

  const complaintImageUpload = () => multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 5 },
    fileFilter: (_req, file, cb) => {
      if (["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Only PNG, JPEG, and WebP images are allowed."));
      }
    },
  }).array("screenshots", 5);

  const uploadComplaintImages = (req: Request, res: Response, callback: (files: Express.Multer.File[]) => Promise<void>) => {
    complaintImageUpload()(req, res, async (err) => {
      if (err) return res.status(400).json({ message: err.message });
      const files = (req.files || []) as Express.Multer.File[];
      if (files.length === 0) return res.status(400).json({ message: "At least one screenshot is required." });
      if (!isCloudinaryConfigured()) {
        return res.status(503).json({ message: "Complaint uploads require Cloudinary configuration." });
      }
      try {
        await callback(files);
      } catch {
        return res.status(502).json({ message: "Unable to upload the complaint screenshot." });
      }
    });
  };

  app.post("/api/complaints/upload", requireRole(["admin", "support"]), (req, res) => {
    uploadComplaintImages(req, res, async files => {
      const evidence = await Promise.all(files.map(async file => ({
        url: await uploadPrivateImage(await normalizeImage(file.buffer), { kind: "complaint", folder: "pixelcrm/complaints", uploadedById: (req.user as User).id, orderId: optionalOrderId(req.body.orderId) }),
        fileName: file.originalname,
        fileSize: file.size,
      })));
      res.json({ evidence, screenshotUrl: evidence[0]?.url });
    });
  });

  app.post("/api/complaints/designer-explanation/upload", requireRole(["designer"]), (req, res) => {
    uploadComplaintImages(req, res, async files => {
      const evidence = await Promise.all(files.map(async file => ({
        url: await uploadPrivateImage(await normalizeImage(file.buffer), { kind: "complaint_explanation", folder: "pixelcrm/complaint-explanations", uploadedById: (req.user as User).id, orderId: optionalOrderId(req.body.orderId) }),
        fileName: file.originalname,
        fileSize: file.size,
      })));
      res.json({ evidence });
    });
  });

  app.post(api.complaints.create.path, requireRole(["admin", "support"]), async (req, res) => {
    try {
      const requestedTargetType = req.body?.complaintTargetType
        ?? req.body?.complaint_target_type
        ?? req.body?.target_type
        ?? req.body?.targetType;
      if (requestedTargetType === "client") {
        return res.status(400).json({ message: "Client-target complaints are no longer supported." });
      }
      const input = api.complaints.create.input.parse(req.body);
      const user = req.user as User;
      const order = await storage.getOrder(input.orderId);
      if (!order) return res.status(400).json({ message: "The selected order could not be found." });

      const targetId = order.assignedToId;
      if (!targetId) {
        return res.status(400).json({
          message: "This order has no assigned designer. Assign a designer before raising a complaint.",
        });
      }
      if (input.complaintAgainstUserId && input.complaintAgainstUserId !== targetId) {
        return res.status(400).json({
          message: "A complaint can only target the designer currently assigned to this order.",
        });
      }
      const targetDesigner = await storage.getUser(targetId);
      if (!targetDesigner || targetDesigner.role !== "designer") {
        return res.status(400).json({ message: "The complaint must target a valid assigned designer." });
      }

      const categoryConfigs = await storage.getComplaintCategoryConfigs();
      const selectedCategory = categoryConfigs.find(category => category.key === input.category);
      if (!selectedCategory || !selectedCategory.isActive) {
        return res.status(400).json({ message: "Select an active complaint category." });
      }

      const evidence = input.evidence || (input.screenshotUrl ? [{
        url: input.screenshotUrl,
        fileName: "Complaint evidence",
        fileSize: 0,
      }] : []);
      if (input.screenshotUrl && !(await fileRefOk(input.screenshotUrl, req))) {
        return res.status(400).json({ message: "Screenshot must be an image uploaded in the CRM." });
      }
      if (evidence.length > 5 || !(await allFileRefsOk(evidence.map(item => item.url), req))) {
        return res.status(400).json({ message: "Complaint evidence must contain up to five images uploaded in the CRM." });
      }

      const complaint = await storage.createComplaint({
        orderId: input.orderId,
        complaintTargetType: "designer",
        complaintAgainstUserId: targetId,
        filedByUserId: user.id,
        category: input.category,
        description: input.description.trim(),
        status: "new",
        adminNotes: null,
        resolution: null,
        resolutionOutcome: null,
        screenshotUrl: input.screenshotUrl || evidence[0]?.url || null,
        resolvedByUserId: null,
        resolvedAt: null,
      }, user.id, evidence);

      const admins = await storage.getAdmins();
      const event = user.role === "support"
        ? "complaint_created_by_support"
        : "complaint_created_by_admin";
      await dispatchNotifications(
        admins.map(admin => admin.id),
        {
          event,
          type: "complaint",
          title: "New Complaint",
          message: user.role === "support"
            ? "New complaint received from Support. Review required."
            : "New complaint recorded by Admin. Review required.",
          priority: "action_required",
          relatedId: complaint.id,
          relatedType: "complaint",
          sourceEventId: complaint.id,
        },
        user.role === "admin" ? [user.id] : [],
      );
      emitRealtime(user.id, ["complaints", "stats"]);

      const response = await storage.getComplaintForUser(complaint.id, user.role, user.id);
      res.status(201).json(response);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.issues[0]?.message || "Invalid complaint details" });
      }
      throw err;
    }
  });

  app.patch(api.complaints.update.path, requireRole(["admin"]), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const input = api.complaints.update.input.parse(req.body);
      const existing = await storage.getComplaintRecord(id);
      if (!existing) return res.sendStatus(404);
      if (!isSupportedComplaintTarget(existing.complaintTargetType)) return res.sendStatus(404);
      const adminNote = input.adminNote?.trim() || input.adminNotes?.trim() || "";
      if (input.status === undefined && !adminNote && input.resolution === undefined && input.resolutionScreenshotUrl === undefined && input.dismissalReason === undefined) {
        return res.status(400).json({ message: "Provide a status, admin note, or decision details." });
      }
      const actor = req.user as User;
      if (
        adminNote &&
        input.status === undefined &&
        input.resolution === undefined &&
        input.resolutionOutcome === undefined &&
        input.resolutionScreenshotUrl === undefined &&
        input.dismissalReason === undefined
      ) {
        await storage.addComplaintNote(id, adminNote, actor.id);
        const response = await storage.getComplaintForUser(id, "admin", actor.id);
        return res.json(response);
      }

      const status = input.status;
      const transitionAllowed =
        status === undefined ||
        status === existing.status ||
        (existing.status === "new" && (status === "confirmed" || status === "dismissed")) ||
        (existing.status === "confirmed" && (status === "resolved" || status === "refunded"));
      if (!transitionAllowed) {
        return res.status(400).json({
          message: `Cannot move a complaint from ${statusLabel(existing.status)} to ${statusLabel(status)}.`,
        });
      }

      if (status !== undefined && status !== existing.status && input.confirmDecision !== true) {
        return res.status(400).json({ message: "Confirm the complaint decision before saving it." });
      }
      if (status === "dismissed" && (!input.dismissalReason?.trim())) {
        return res.status(400).json({ message: "A reason for dismissal is required." });
      }
      if ((status === "resolved" || status === "refunded") && existing.status !== "confirmed") {
        return res.status(400).json({ message: "Only confirmed complaints can be closed." });
      }
      if ((status === "resolved" || status === "refunded") && (!input.resolution?.trim() && !existing.resolution?.trim())) {
        return res.status(400).json({ message: "Please add the resolution details before closing this complaint." });
      }
      if (status === "refunded" && input.refundConfirmed !== true) {
        return res.status(400).json({ message: "Confirm that the client refund has been completed." });
      }
      if (input.resolutionScreenshotUrl && !(await fileRefOk(input.resolutionScreenshotUrl, req))) return res.status(400).json({ message: "Resolution evidence must be an image uploaded in the CRM." });
      if (
        input.resolution !== undefined &&
        input.resolution !== existing.resolution &&
        existing.status !== "confirmed" &&
        status !== "resolved" && status !== "refunded"
      ) {
        return res.status(400).json({ message: "A resolution can only be recorded for a confirmed complaint." });
      }
      if (
        (existing.status === "resolved" || existing.status === "refunded" || existing.status === "dismissed") &&
        (
          (input.resolution !== undefined && input.resolution !== existing.resolution) ||
          (input.resolutionOutcome !== undefined && input.resolutionOutcome !== existing.resolutionOutcome)
        )
      ) {
        return res.status(400).json({ message: "The resolution and outcome are locked once a complaint is closed." });
      }

      const historyEvents: InsertActivityLog[] = [];
      if (status !== undefined && status !== existing.status) {
        historyEvents.push({
          orderId: existing.orderId,
          actorId: actor.id,
          activityType: status === "resolved" || status === "refunded" ? "complaint_resolved" : "complaint_status",
          previousValue: existing.status,
          newValue: status,
          details: {
            complaintId: existing.id,
            complaintNumber: existing.complaintNumber,
            ...(status === "resolved" || status === "refunded" ? { resolution: input.resolution?.trim() || existing.resolution, resolutionOutcome: status === "refunded" ? "refund" : input.resolutionOutcome } : {}),
          },
        });
      }
      if (input.resolution !== undefined && (input.resolution?.trim() || null) !== existing.resolution) {
        historyEvents.push({
          orderId: existing.orderId,
          actorId: actor.id,
          activityType: "complaint_resolution",
          previousValue: existing.resolution,
          newValue: input.resolution?.trim() || null,
          details: {
            complaintId: existing.id,
            complaintNumber: existing.complaintNumber,
          },
        });
      }
      if (input.resolutionOutcome !== undefined && input.resolutionOutcome !== existing.resolutionOutcome) {
        historyEvents.push({
          orderId: existing.orderId, actorId: actor.id, activityType: "complaint_resolution",
          previousValue: existing.resolutionOutcome, newValue: input.resolutionOutcome,
          details: { complaintId: existing.id, complaintNumber: existing.complaintNumber },
        });
      }
      if (historyEvents.length === 0) {
        return res.status(400).json({ message: "No complaint changes were provided." });
      }

      const updated = await storage.updateComplaint(id, existing.status, {
        ...(status !== undefined ? { status } : {}),
        ...(input.resolution !== undefined ? { resolution: input.resolution?.trim() || null } : {}),
        ...(input.resolutionOutcome !== undefined ? { resolutionOutcome: input.resolutionOutcome } : {}),
        ...(input.resolutionScreenshotUrl !== undefined ? { resolutionScreenshotUrl: input.resolutionScreenshotUrl } : {}),
        ...(status === "dismissed" && status !== existing.status ? { dismissalReason: input.dismissalReason!.trim(), dismissedByUserId: actor.id, dismissedAt: new Date() } : {}),
        ...((status === "resolved" || status === "refunded") && status !== existing.status
          ? { resolvedByUserId: actor.id, resolvedAt: new Date() }
          : {}),
        ...(status === "refunded" ? { resolutionOutcome: "refund" } : {}),
      }, historyEvents, status === "refunded" && status !== existing.status ? {
        reason: `Refunded after complaint ${existing.complaintNumber}: ${input.resolution?.trim() || existing.resolution || "Client refund"}`,
        advanceRefunded: true,
        actorId: actor.id,
        complaintId: existing.id,
        complaintNumber: existing.complaintNumber,
      } : undefined);
      if (!updated) {
        return res.status(409).json({
          message: "This complaint changed while you were reviewing it. Reload and try again.",
        });
      }
      if (adminNote) {
        await storage.addComplaintNote(id, adminNote, actor.id);
      }
      if (status !== undefined && status !== existing.status) {

        const targetOrder = await storage.getOrder(existing.orderId);
        if (
          existing.status === "new" &&
          status === "confirmed" &&
          existing.complaintTargetType === "designer" &&
          existing.complaintAgainstUserId
        ) {
          await dispatchNotification({
            event: "complaint_confirmed",
            recipientId: existing.complaintAgainstUserId,
            recipientRole: "designer",
            type: "complaint",
            title: "Complaint Confirmed",
            message: "Complaint regarding your order has been confirmed. Please review and take required action.",
            priority: "update",
            relatedId: existing.id,
            relatedType: "complaint",
            sourceEventId: `${existing.id}:new-confirmed`,
          });
        }
        emitRealtime(existing.filedByUserId, ["complaints", "stats"]);
        if (existing.complaintTargetType === "designer" && existing.complaintAgainstUserId) {
          emitRealtime(existing.complaintAgainstUserId, ["complaints", "stats"]);
        }
      }

      const response = await storage.getComplaintForUser(id, "admin", actor.id);
      res.json(response);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.issues[0]?.message || "Invalid complaint update" });
      }
      if (err instanceof Error && err.message === "Unable to cancel the related order") {
        return res.status(409).json({ message: "The related order was already canceled. Reload this complaint before continuing." });
      }
      throw err;
    }
  });

  app.patch(api.complaints.designerExplanation.path, requireRole(["designer"]), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const input = api.complaints.designerExplanation.input.parse(req.body);
      const actor = req.user as User;
      const existing = await storage.getComplaintRecord(id);
      if (!existing || existing.complaintTargetType !== "designer") return res.sendStatus(404);
      if (existing.complaintAgainstUserId !== actor.id) return res.sendStatus(403);
      const evidence = input.evidence || [];
      if (!(await allFileRefsOk(evidence.map(item => item.url), req))) {
        return res.status(400).json({ message: "Explanation evidence must contain images uploaded in the CRM." });
      }
      const updated = await storage.saveDesignerExplanation(id, actor.id, input.explanation, evidence);
      if (!updated) return res.sendStatus(404);

      const admins = await storage.getAdmins();
      await dispatchNotifications(
        admins.map(admin => admin.id),
        {
          event: "complaint_designer_explanation",
          type: "complaint",
          title: "Designer Explanation Received",
          message: "A designer has explained their side of a complaint. Review the response and evidence.",
          priority: "update",
          relatedId: id,
          relatedType: "complaint",
          sourceEventId: `${id}:designer-explanation`,
        },
        [actor.id],
      );
      emitRealtime(actor.id, ["complaints", "stats"]);
      emitRealtime(existing.filedByUserId, ["complaints", "stats"]);
      admins.forEach(admin => emitRealtime(admin.id, ["complaints", "stats"]));

      const response = await storage.getComplaintForUser(id, "designer", actor.id);
      res.json(response);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.issues[0]?.message || "Invalid designer explanation." });
      }
      if (err instanceof Error && (
        err.message === "A designer explanation has already been recorded for this complaint." ||
        err.message === "Designer explanations are closed for this complaint."
      )) {
        return res.status(409).json({ message: err.message });
      }
      throw err;
    }
  });

  app.get(api.complaints.history.path, requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const user = req.user as User;
    const complaint = await storage.getComplaintForUser(id, user.role, user.id);
    if (!complaint) return res.sendStatus(404);
    const history = await storage.getComplaintHistory(id);
    // Reporter and management identities are restricted to Admin. Other roles
    // receive the case events without actor metadata or internal note content.
    res.json(projectCaseActivity(
      history.map(entry => ({ ...entry, activityType: entry.action })),
      user.role as CaseRole,
    ).map(({ activityType: _activityType, ...entry }) => entry));
  });
}
