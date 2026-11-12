/** Designer assignments and the catalogs (platforms, complaint categories, services, packages). */
import type { Express } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { type User } from "@shared/schema";
import { requireAuth, requireRole } from "./shared";

export function registerSettingsRoutes(app: Express) {
  app.get("/api/designer-assignments", requireAuth, async (req, res) => {
    const user = req.user as User;
    if (user.role === "admin") {
      const assignments = await storage.getAllDesignerAssignments();
      res.json(assignments);
    } else if (user.role === "support") {
      const assignments = await storage.getDesignerAssignments(user.id);
      res.json(assignments);
    } else {
      res.json([]);
    }
  });

  app.get("/api/designer-assignments/:supportUserId", requireRole(["admin"]), async (req, res) => {
    const supportUserId = Number(req.params.supportUserId);
    const assignments = await storage.getDesignerAssignments(supportUserId);
    res.json(assignments);
  });

  app.put("/api/designer-assignments/:supportUserId", requireRole(["admin"]), async (req, res) => {
    const supportUserId = Number(req.params.supportUserId);
    const parsed = z.object({ designerIds: z.array(z.number().int().positive()).max(200) }).safeParse(req.body);
    if (!Number.isInteger(supportUserId) || supportUserId <= 0) return res.status(400).json({ message: "Invalid support user." });
    if (!parsed.success) return res.status(400).json({ message: "designerIds must be a list of user ids." });
    const designerIds = Array.from(new Set(parsed.data.designerIds));

    await storage.setDesignerAssignments(supportUserId, designerIds);
    const assignments = await storage.getDesignerAssignments(supportUserId);
    res.json(assignments);
  });
  app.get("/api/platforms-catalog", requireAuth, async (req, res) => {
    const items = await storage.getPlatformsCatalog();
    res.json(items);
  });

  app.post("/api/platforms-catalog", requireRole(["admin"]), async (req, res) => {
    try {
      const { name, isActive, hasCampaignFields, sortOrder } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "Platform name is required" });
      }
      const item = await storage.createPlatformCatalogItem({
        name: name.trim(),
        isActive: isActive !== false,
        hasCampaignFields: !!hasCampaignFields,
        sortOrder: sortOrder || 0,
      });
      res.status(201).json(item);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(400).json({ message: "A platform with that name already exists" });
      }
      throw err;
    }
  });

  app.patch("/api/platforms-catalog/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    try {
      const updated = await storage.updatePlatformCatalogItem(id, req.body);
      res.json(updated);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(400).json({ message: "A platform with that name already exists" });
      }
      throw err;
    }
  });

  app.delete("/api/platforms-catalog/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    await storage.deletePlatformCatalogItem(id);
    res.json({ success: true });
  });

  app.get("/api/complaint-categories", requireAuth, async (_req, res) => {
    res.json(await storage.getComplaintCategoryConfigs());
  });

  app.post("/api/complaint-categories", requireRole(["admin"]), async (req, res) => {
    try {
      const label = typeof req.body.label === "string" ? req.body.label.trim() : "";
      const requestedKey = typeof req.body.key === "string" ? req.body.key.trim() : label;
      const key = requestedKey.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      if (!label || !key) return res.status(400).json({ message: "Category name is required" });
      const item = await storage.createComplaintCategoryConfig({
        key,
        label,
        isActive: req.body.isActive !== false,
        sortOrder: Number.isInteger(req.body.sortOrder) ? req.body.sortOrder : 0,
      });
      res.status(201).json(item);
    } catch (err: any) {
      if (err?.code === "23505") return res.status(400).json({ message: "That complaint category already exists" });
      throw err;
    }
  });

  app.patch("/api/complaint-categories/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    const updates: Record<string, unknown> = {};
    if (typeof req.body.label === "string" && req.body.label.trim()) updates.label = req.body.label.trim();
    if (typeof req.body.isActive === "boolean") updates.isActive = req.body.isActive;
    if (Number.isInteger(req.body.sortOrder)) updates.sortOrder = req.body.sortOrder;
    const updated = await storage.updateComplaintCategoryConfig(id, updates);
    if (!updated) return res.sendStatus(404);
    res.json(updated);
  });

  app.delete("/api/complaint-categories/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    const categories = await storage.getComplaintCategoryConfigs();
    const category = categories.find(item => item.id === id);
    if (!category) return res.sendStatus(404);
    const existingComplaints = await storage.getComplaints("admin", (req.user as User).id, { category: category.key });
    if (existingComplaints.length > 0) {
      return res.status(409).json({ message: "This category is used by complaint history. Disable it instead." });
    }
    await storage.deleteComplaintCategoryConfig(id);
    res.json({ success: true });
  });

  app.get("/api/services-catalog", requireAuth, async (req, res) => {
    const items = await storage.getServicesCatalog();
    res.json(items);
  });

  app.post("/api/services-catalog", requireRole(["admin"]), async (req, res) => {
    try {
      const { name, isActive, sortOrder } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "Service name is required" });
      }
      const item = await storage.createServiceCatalogItem({
        name: name.trim(),
        isActive: isActive !== false,
        sortOrder: sortOrder || 0,
      });
      res.status(201).json(item);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(400).json({ message: "A service with that name already exists" });
      }
      throw err;
    }
  });

  app.patch("/api/services-catalog/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    try {
      const updated = await storage.updateServiceCatalogItem(id, req.body);
      res.json(updated);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(400).json({ message: "A service with that name already exists" });
      }
      throw err;
    }
  });

  app.delete("/api/services-catalog/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    await storage.deleteServiceCatalogItem(id);
    res.json({ success: true });
  });

  app.get("/api/package-configs", requireAuth, async (req, res) => {
    const pkgs = await storage.getPackageConfigs();
    res.json(pkgs);
  });

  app.post("/api/package-configs", requireRole(["admin"]), async (req, res) => {
    try {
      const { key, label, isActive, sortOrder } = req.body;
      if (!key || typeof key !== "string" || !key.trim()) {
        return res.status(400).json({ message: "Package key is required" });
      }
      if (!label || typeof label !== "string" || !label.trim()) {
        return res.status(400).json({ message: "Package label is required" });
      }
      const slugKey = key.trim().toLowerCase().replace(/\s+/g, "_");
      const pkg = await storage.createPackageConfig({
        key: slugKey,
        label: label.trim(),
        isActive: isActive !== false,
        sortOrder: sortOrder || 0,
      });
      res.status(201).json(pkg);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(400).json({ message: "A package with that key already exists" });
      }
      throw err;
    }
  });

  app.patch("/api/package-configs/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    try {
      const updates = { ...req.body };
      if (updates.key) {
        updates.key = updates.key.trim().toLowerCase().replace(/\s+/g, "_");
      }
      const updated = await storage.updatePackageConfig(id, updates);
      res.json(updated);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(400).json({ message: "A package with that key already exists" });
      }
      throw err;
    }
  });

  app.delete("/api/package-configs/:id", requireRole(["admin"]), async (req, res) => {
    const id = Number(req.params.id);
    await storage.deletePackageConfig(id);
    res.json({ success: true });
  });
}
