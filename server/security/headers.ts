import type { Express, Request, Response, NextFunction } from "express";
import helmet from "helmet";

const isProd = process.env.NODE_ENV === "production";

/**
 * Security headers + "never index this app".
 *
 * CSP allows only this origin, Cloudinary (images and signed downloads) and the
 * Meta Graph API. In development the CSP is skipped because Vite's HMR client
 * needs inline scripts and a websocket.
 */
export function applySecurityHeaders(app: Express) {
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: isProd
        ? {
            useDefaults: false,
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              // Radix/recharts/sonner inject <style> tags at runtime.
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com", "https://api.cloudinary.com"],
              fontSrc: ["'self'", "data:"],
              connectSrc: ["'self'", "https://graph.facebook.com"],
              mediaSrc: ["'self'"],
              workerSrc: ["'self'"],
              manifestSrc: ["'self'"],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
              frameAncestors: ["'none'"],
              upgradeInsecureRequests: [],
            },
          }
        : false,
      strictTransportSecurity: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
      frameguard: { action: "deny" },
      noSniff: true,
      referrerPolicy: { policy: "no-referrer" },
      crossOriginEmbedderPolicy: false, // Cloudinary images are cross-origin
      crossOriginResourcePolicy: { policy: "same-origin" },
    }),
  );

  // Never indexed: header on every response + robots.txt.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    next();
  });
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send("User-agent: *\nDisallow: /\n");
  });
  app.get("/sitemap.xml", (_req, res) => res.sendStatus(404));

  // API responses are per-user and must never be cached by shared caches.
  app.use("/api", (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
}
