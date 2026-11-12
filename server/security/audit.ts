import type { Request } from "express";
import { desc, eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import { auditEvents, users } from "@shared/schema";

/** Every action recorded in audit_events. */
export const AUDIT_ACTIONS = [
  "login_success",
  "login_failed",
  "login_locked",
  "logout",
  "password_changed",
  "password_reset_by_admin",
  "totp_enabled",
  "totp_disabled",
  "user_created",
  "user_updated",
  "user_role_changed",
  "user_deactivated",
  "user_reactivated",
  "order_deleted",
  "order_canceled",
  "payment_approved",
  "payment_disapproved",
  "export",
  "settings_changed",
  "order_pay_later_approved",
  "refund_approved",
  "refund_rejected",
  "refund_paid",
] as const;
export type AuditAction = typeof AUDIT_ACTIONS[number];

type AuditInput = {
  action: AuditAction;
  actor?: { id: number; role?: string | null } | null;
  targetType?: string;
  targetId?: string | number | null;
  success?: boolean;
  details?: Record<string, unknown>;
  req?: Request;
};

/**
 * Appends one audit row. Never throws: a logging failure must not break the
 * action being logged, but it is reported loudly.
 */
export async function logAudit(input: AuditInput): Promise<void> {
  try {
    const req = input.req;
    await db.insert(auditEvents).values({
      action: input.action,
      actorId: input.actor?.id ?? null,
      actorRole: input.actor?.role ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId == null ? null : String(input.targetId),
      success: input.success ?? true,
      ip: req ? (req.ip || null) : null,
      userAgent: req ? (req.get("user-agent") || "").slice(0, 300) || null : null,
      details: input.details ?? null,
    });
  } catch (err: any) {
    console.error(`[audit] FAILED to record ${input.action}:`, err?.message || err);
  }
}

export async function listAuditEvents(opts: { page: number; pageSize: number; action?: string; actorId?: number }) {
  const where = and(
    opts.action ? eq(auditEvents.action, opts.action) : undefined,
    opts.actorId ? eq(auditEvents.actorId, opts.actorId) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id: auditEvents.id,
      createdAt: auditEvents.createdAt,
      action: auditEvents.action,
      actorId: auditEvents.actorId,
      actorRole: auditEvents.actorRole,
      actorName: users.name,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      success: auditEvents.success,
      ip: auditEvents.ip,
      userAgent: auditEvents.userAgent,
      details: auditEvents.details,
    })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(where)
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(auditEvents).where(where),
  ]);
  return { rows, total, page: opts.page, pageSize: opts.pageSize };
}
