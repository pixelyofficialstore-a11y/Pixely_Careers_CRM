/**
 * HTTP setup (session, passport, CSRF, rate limits, write hooks) and route
 * registration. The routes themselves live in server/routes/*.ts.
 */
import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { type User } from "@shared/schema";
import { pool } from "./db";
import { broadcastRealtime, scopesForPath } from "./sse";
import { comparePasswords } from "./security/passwords";
import { logAudit } from "./security/audit";
import { csrfProtection } from "./security/csrf";
import { apiLimiter, uploadLimiterMiddleware } from "./security/rateLimit";
import { registerFileRoutes } from "./files";
import { invalidateMetrics } from "./metrics";
import { requireAuth } from "./routes/shared";
import { registerAuthRoutes } from "./routes/auth";
import { registerNotificationRoutes } from "./routes/notifications";
import { registerUserRoutes } from "./routes/users";
import { registerSettingsRoutes } from "./routes/settings";
import { registerOrderRoutes } from "./routes/orders";
import { registerAnalyticsRoutes } from "./routes/analytics";
import { registerFeedbackRoutes } from "./routes/feedback";
import { registerComplaintRoutes } from "./routes/complaints";
import { registerPaymentRoutes } from "./routes/payments";
import { registerRefundRoutes } from "./routes/refunds";
import { startOverdueNotifier } from "./overdueJob";
import { registerWebsiteRequestNotifications } from "./routes/website-requests";

const PgSession = connectPgSimple(session);

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  // The table already exists; the app role has no DDL rights.
  const sessionStore = new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: false,
    // Tests run against a rolled-back transaction: no background session pruning.
    ...(process.env.CRM_DISABLE_BACKGROUND === "1" ? { pruneSessionInterval: false as const } : {}),
  });
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be set (at least 32 characters). Refusing to start.");
  }

  app.use(
    session({
      store: sessionStore,
      name: "connect.sid",
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true, // each request pushes expiry 7 days out
      cookie: {
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        httpOnly: true,
        maxAge: SESSION_MAX_AGE_MS,
      },
    })
  );

  // With rolling sessions connect-pg-simple runs an UPDATE on every request
  // just to push the expiry forward. The cookie lasts 7 days, so refreshing the
  // stored expiry at most every 10 minutes per session is plenty.
  const SESSION_TOUCH_INTERVAL_MS = 10 * 60 * 1000;
  const sessionTouchedAt = new Map<string, number>();
  const originalTouch = sessionStore.touch.bind(sessionStore);
  sessionStore.touch = ((sid: string, sess: any, cb?: (err?: any) => void) => {
    const now = Date.now();
    if (now - (sessionTouchedAt.get(sid) || 0) < SESSION_TOUCH_INTERVAL_MS) return cb?.();
    if (sessionTouchedAt.size > 5000) sessionTouchedAt.clear();
    sessionTouchedAt.set(sid, now);
    originalTouch(sid, sess, cb);
  }) as typeof sessionStore.touch;

  app.use(passport.initialize());
  app.use(passport.session());

  // CSRF (double-submit) + rate limits run after the session so limits are per user.
  app.use(csrfProtection);
  app.use("/api", apiLimiter);
  app.use(uploadLimiterMiddleware);

  // Reject non-numeric :id params early (zod-equivalent check for every route).
  app.param("id", (req, res, next, value) => {
    if (!/^\d{1,10}$/.test(String(value))) return res.status(400).json({ message: "Invalid id." });
    next();
  });

  // A user whose password was reset by an admin must set a new one first.
  const PASSWORD_CHANGE_ALLOWED = new Set(["/api/user", "/api/logout", "/api/user/password", "/api/notifications/stream"]);
  app.use("/api", (req, res, next) => {
    const user = req.user as User | undefined;
    if (user?.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(req.originalUrl.split("?")[0])) {
      return res.status(403).json({ code: "PASSWORD_CHANGE_REQUIRED", message: "Please set a new password to continue." });
    }
    next();
  });

  // Metrics are cached for 30s; any successful write drops the cache
  // so new orders/payments show up on the next dashboard load.
  app.use("/api", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.on("finish", () => {
        if (res.statusCode >= 400) return;
        invalidateMetrics();
        // Live updates for every open CRM tab (replaces client polling).
        const scopes = scopesForPath(req.originalUrl.split("?")[0]);
        if (scopes.length) broadcastRealtime(scopes);
      });
    }
    next();
  });

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user || !(await comparePasswords(password, user.password))) {
          return done(null, false);
        }
        // Block disabled/inactive accounts even with a correct password.
        if (!user.isActive) {
          return done(null, false, { message: "account_disabled" });
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user, done) => done(null, (user as User).id));
  passport.deserializeUser(async (req: any, id: unknown, done: (err: any, user?: any) => void) => {
    try {
      const user = await storage.getUser(id as number);
      // If the account was disabled after the session was created, treat it as
      // logged out so protected routes reject the request on the next call.
      if (!user || !user.isActive) {
        return done(null, false);
      }
      // Password change/reset or deactivation invalidates every older session
      // (instead of deleting session rows). Sessions from before this feature
      // have no loginAt and count as "old".
      if (user.sessionsValidAfter) {
        const loginAt = Number(req.session?.loginAt || 0);
        if (loginAt < new Date(user.sessionsValidAfter).getTime()) return done(null, false);
      }
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  registerAuthRoutes(app);

  // Settings changes (catalogs, packages, categories, designer assignments) go to the audit log.
  const SETTINGS_PATHS = /^\/api\/(platforms-catalog|complaint-categories|services-catalog|package-configs|designer-assignments)(\/|$)/;
  app.use((req, res, next) => {
    if (req.method === "GET" || !SETTINGS_PATHS.test(req.path)) return next();
    res.on("finish", () => {
      const actor = req.user as User | undefined;
      if (!actor || res.statusCode >= 400) return;
      void logAudit({
        action: "settings_changed",
        actor,
        targetType: req.path.split("/")[2],
        targetId: req.path.split("/")[3] || null,
        details: { method: req.method },
        req,
      });
    });
    next();
  });

  // Route modules. Order matters only inside a module (e.g. /api/orders/lookup
  // before /api/orders/:id); paths in different modules never overlap.
  registerNotificationRoutes(app);
  registerUserRoutes(app);
  registerSettingsRoutes(app);
  registerOrderRoutes(app);
  registerAnalyticsRoutes(app);
  registerFeedbackRoutes(app);
  registerComplaintRoutes(app);
  registerPaymentRoutes(app);
  registerRefundRoutes(app);
  registerFileRoutes(app, requireAuth);
  registerWebsiteRequestNotifications(app);
  startOverdueNotifier();

  return httpServer;
}
