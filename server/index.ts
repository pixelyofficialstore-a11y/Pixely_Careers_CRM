import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./seed";
import { startCleanupJob } from "./cleanup";
import { runMigrations } from "./migrate";
import { pool, requestContext } from "./db";
import path from "path";
import fs from "fs";

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

const app = express();
const httpServer = createServer(app);

// Tag every request so slow-query logs show which route ran the SQL.
app.use((req, _res, next) => requestContext.run({ route: `${req.method} ${req.path}` }, next));

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (reqPath.startsWith("/api")) {
      let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
      // Only error bodies are logged (truncated). Serialising every successful
      // response (e.g. the full orders list) cost CPU on each request and
      // flooded the Railway logs.
      if (capturedJsonResponse && res.statusCode >= 400) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse).slice(0, 500)}`;
      }
      if (duration > 1000) logLine += " [slow]";

      log(logLine);
    }
  });

  next();
});

// Health check — always responds immediately
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

const port = parseInt(process.env.PORT || "5000", 10);

if (process.env.NODE_ENV === "production") {
  // In production: serve static assets right away (CSS/JS/images).
  // express.static only serves actual files, so /api/* is unaffected.
  // The SPA catch-all (/*.html) is registered AFTER API routes below.
  const distPath = path.resolve(__dirname, "public");
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    log("static assets registered");
  } else {
    console.warn("[startup] dist/public not found — frontend will not be served");
  }
}

// Start listening immediately so Railway's healthcheck gets a fast 200.
// API routes and SPA catch-all are registered asynchronously below.
httpServer.listen(
  { port, host: "0.0.0.0", ...(process.platform !== "win32" ? { reusePort: true } : {}) },
  () => { log(`serving on port ${port}`); },
);

(async () => {
  // Run schema migrations before anything else touches the DB
  await runMigrations();
  await seedDatabase();
  // Disabled for local dev against the live Supabase DB — startCleanupJob() deletes
  // notifications/payment_verifications older than 5 days. Do not re-enable without
  // explicit confirmation; this must never run unintentionally against real data.
  // startCleanupJob();

  // Register all API routes
  await registerRoutes(httpServer, app);

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const user = (req as any).user as { id?: number; username?: string; role?: string } | undefined;
    // One structured line per failure so it can be found in the Railway logs.
    console.error(
      `[api-error] ${req.method} ${req.originalUrl} status=${status} user=${user ? `${user.id}:${user.username}(${user.role})` : "anonymous"} error=${err?.code ? `[${err.code}] ` : ""}${err?.message || err}`,
    );
    if (status >= 500 && err?.stack) console.error(err.stack);

    if (res.headersSent) {
      return next(err);
    }

    // Never leak SQL/internal details to the browser for 5xx errors.
    const message = status >= 500
      ? "Server error - the action may not have completed. Please refresh and check before retrying."
      : (err.message || "Request failed");
    return res.status(status).json({ message, error: message });
  });

  if (process.env.NODE_ENV === "production") {
    // Register SPA catch-all AFTER API routes so /api/* isn't intercepted
    const distPath = path.resolve(__dirname, "public");
    if (fs.existsSync(distPath)) {
      app.use("/{*path}", (_req, res) => {
        res.sendFile(path.resolve(distPath, "index.html"));
      });
    }
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }
})();
