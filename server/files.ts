import type { Express, Request, Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { files, orders, type User, type FileRecord } from "@shared/schema";
import cloudinary, { isCloudinaryConfigured } from "./cloudinary";
import { canAccessOrderCase, type CaseRole } from "@shared/case-access";

/**
 * Private uploads.
 *
 * New payment / complaint / feedback images are uploaded to Cloudinary with
 * `type: "authenticated"`: they can't be fetched without a signature. The app
 * stores "/api/files/<id>" and GET /api/files/:id checks the user may see the
 * order, then redirects to a download URL that expires after 10 minutes.
 *
 * Older records keep their public res.cloudinary.com URLs (read-only, untouched).
 */

export const SIGNED_URL_TTL_SECONDS = 10 * 60;
const FILE_REF = /^\/api\/files\/(\d+)$/;

export type FileKind = "payment" | "review" | "suggestion" | "complaint" | "complaint_explanation";

export function fileIdFromRef(ref: string | null | undefined): number | null {
  const m = FILE_REF.exec(String(ref || ""));
  return m ? Number(m[1]) : null;
}

export function isCloudinaryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "res.cloudinary.com" || url.hostname.endsWith(".cloudinary.com"));
  } catch {
    return false;
  }
}

export async function uploadPrivateImage(
  buffer: Buffer,
  opts: { kind: FileKind; folder: string; uploadedById: number; orderId?: number | null },
): Promise<string> {
  const result = await new Promise<any>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder,
        type: "authenticated",
        resource_type: "image",
        format: "jpg",
        transformation: [{ quality: "auto:good" }],
      },
      (error, res) => (error || !res ? reject(error ?? new Error("Cloudinary upload failed")) : resolve(res)),
    );
    stream.end(buffer);
  });
  const [row] = await db.insert(files).values({
    publicId: result.public_id,
    resourceType: result.resource_type || "image",
    deliveryType: "authenticated",
    format: result.format || "jpg",
    mimeType: "image/jpeg",
    bytes: result.bytes ?? buffer.length,
    kind: opts.kind,
    orderId: opts.orderId ?? null,
    uploadedById: opts.uploadedById,
  }).returning({ id: files.id });
  return `/api/files/${row.id}`;
}

export function signedDownloadUrl(file: Pick<FileRecord, "publicId" | "format" | "resourceType" | "deliveryType">, nowMs = Date.now()): string {
  return cloudinary.utils.private_download_url(file.publicId, file.format || "jpg", {
    resource_type: file.resourceType || "image",
    type: file.deliveryType || "authenticated",
    expires_at: Math.floor(nowMs / 1000) + SIGNED_URL_TTL_SECONDS,
    attachment: false,
  });
}

/**
 * A screenshot/evidence value submitted by a client is allowed if it is a legacy
 * public Cloudinary URL, or a /api/files/<id> the same user uploaded (admins: any).
 */
export async function isAllowedFileRef(value: string, user: User): Promise<boolean> {
  const id = fileIdFromRef(value);
  if (id == null) return isCloudinaryUrl(value);
  const [file] = await db.select({ uploadedById: files.uploadedById }).from(files).where(eq(files.id, id)).limit(1);
  return Boolean(file && (user.role === "admin" || file.uploadedById === user.id));
}

/** Orders whose records reference this file (payment, review, suggestion, complaint, evidence). */
async function referencingOrderIds(ref: string): Promise<number[]> {
  const result = await db.execute(sql`
    select order_id from payment_verifications where screenshot_url = ${ref}
    union select order_id from client_reviews where screenshot_url = ${ref}
    union select order_id from client_suggestions where screenshot_url = ${ref} or implementation_screenshot_url = ${ref}
    union select order_id from complaints where screenshot_url = ${ref} or resolution_screenshot_url = ${ref}
    union select c.order_id from complaint_evidence e join complaints c on c.id = e.complaint_id where e.url = ${ref}
    union select c.order_id from complaint_designer_evidence e join complaints c on c.id = e.complaint_id where e.url = ${ref}
  `);
  return (result.rows as any[]).map(r => Number(r.order_id)).filter(Number.isFinite);
}

export async function canUserAccessFile(user: User, file: FileRecord): Promise<boolean> {
  if (user.role === "admin" || file.uploadedById === user.id) return true;
  const orderIds = new Set<number>(await referencingOrderIds(`/api/files/${file.id}`));
  if (file.orderId) orderIds.add(file.orderId);
  for (const orderId of orderIds) {
    const [order] = await db.select({ assignedToId: orders.assignedToId }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (order && canAccessOrderCase(user.role as CaseRole, user.id, order.assignedToId)) return true;
  }
  return false;
}

export function registerFileRoutes(app: Express, requireAuth: (req: any, res: any, next: any) => void) {
  app.get("/api/files/:id", requireAuth, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid file id." });
    const [file] = await db.select().from(files).where(eq(files.id, id)).limit(1);
    if (!file) return res.sendStatus(404);
    if (!(await canUserAccessFile(req.user as User, file))) return res.sendStatus(403);
    if (!isCloudinaryConfigured()) return res.status(503).json({ message: "File storage is not configured." });
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, signedDownloadUrl(file));
  });
}
