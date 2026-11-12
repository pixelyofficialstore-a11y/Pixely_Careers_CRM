import type { Request, Response, NextFunction } from "express";

/**
 * One error format for every /api response:  { error: { code, message } }
 *
 * Existing handlers still call res.status(4xx).json({ message }) / ({ error: "..." })
 * or res.sendStatus(4xx). This middleware rewrites those bodies at the edge, so
 * every route gets the same shape without touching each handler.
 */

const DEFAULT_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "UNPROCESSABLE",
  423: "LOCKED",
  429: "RATE_LIMITED",
  502: "UPSTREAM_ERROR",
  503: "UNAVAILABLE",
};

const DEFAULT_MESSAGES: Record<number, string> = {
  400: "The request was invalid.",
  401: "Please sign in.",
  403: "You don't have permission to do that.",
  404: "Not found.",
  409: "This conflicts with the current state. Refresh and try again.",
  429: "Too many requests. Please wait and try again.",
};

export const SERVER_ERROR_MESSAGE =
  "Server error - the action may not have completed. Please refresh and check before retrying.";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function errorCodeFor(status: number): string {
  return DEFAULT_CODES[status] ?? (status >= 500 ? "SERVER_ERROR" : "ERROR");
}

export function errorBody(status: number, message?: string, code?: string, extra?: Record<string, unknown>) {
  const safeMessage = status >= 500 ? SERVER_ERROR_MESSAGE : (message || DEFAULT_MESSAGES[status] || "Request failed.");
  return { error: { code: code || errorCodeFor(status), message: safeMessage, ...(extra || {}) } };
}

/** Converts any legacy error body into { error: { code, message, ...extras } }. */
export function normalizeErrorBody(status: number, body: unknown) {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const b = body as Record<string, any>;
    // Already normalized.
    if (b.error && typeof b.error === "object" && typeof b.error.message === "string") {
      return status >= 500 ? errorBody(status, undefined, b.error.code) : body;
    }
    const message = typeof b.message === "string" ? b.message : typeof b.error === "string" ? b.error : undefined;
    const { message: _m, error: _e, code, ...extras } = b;
    return errorBody(status, message, typeof code === "string" ? code : undefined, status >= 500 ? undefined : extras);
  }
  if (typeof body === "string" && body.trim()) return errorBody(status, body);
  return errorBody(status);
}

export function apiErrorFormat(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api")) return next();

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 400) return originalJson(normalizeErrorBody(res.statusCode, body));
    return originalJson(body);
  }) as Response["json"];

  const originalSendStatus = res.sendStatus.bind(res);
  res.sendStatus = ((status: number) => {
    if (status >= 400) return res.status(status).json(errorBody(status));
    return originalSendStatus(status);
  }) as Response["sendStatus"];

  next();
}
