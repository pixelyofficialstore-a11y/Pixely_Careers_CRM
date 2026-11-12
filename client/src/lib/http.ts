/**
 * One place for browser → API plumbing:
 *  - CSRF: every same-origin, state-changing /api request carries the
 *    x-csrf-token header (double-submit of the pixely_csrf cookie).
 *  - Errors: the server answers { error: { code, message } }. Older screens read
 *    body.message / body.error as strings, so error bodies are flattened to
 *    { message, error, code, ...extras } before page code sees them.
 *  - A 403 PASSWORD_CHANGE_REQUIRED sends the user to the change-password screen.
 */

const CSRF_COOKIE = "pixely_csrf";
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function readCsrfToken(): string {
  const match = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : "";
}

function isApiUrl(input: RequestInfo | URL): boolean {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith("/api");
  } catch {
    return false;
  }
}

async function flattenError(res: Response): Promise<Response> {
  const type = res.headers.get("content-type") || "";
  if (!type.includes("application/json")) return res;
  let body: any;
  try {
    body = await res.clone().json();
  } catch {
    return res;
  }
  const err = body?.error;
  if (!err || typeof err !== "object" || typeof err.message !== "string") return res;
  const { code, message, ...extras } = err;
  if (code === "PASSWORD_CHANGE_REQUIRED") window.dispatchEvent(new CustomEvent("pixely:password-change-required"));
  const flat = { ...extras, code, message, error: message };
  return new Response(JSON.stringify(flat), { status: res.status, statusText: res.statusText, headers: res.headers });
}

let installed = false;

export function installApiFetch() {
  if (installed) return;
  installed = true;
  const nativeFetch = window.fetch.bind(window);

  const send = (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (SAFE.has(method)) return nativeFetch(input, init);
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const token = readCsrfToken();
    if (token && !headers.has("x-csrf-token")) headers.set("x-csrf-token", token);
    return nativeFetch(input, { ...init, headers, credentials: init?.credentials ?? "include" });
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isApiUrl(input)) return nativeFetch(input, init);
    // No CSRF cookie yet (first visit): any GET sets it, then send the request.
    if (!readCsrfToken()) await nativeFetch("/api/user", { credentials: "include" }).catch(() => undefined);
    let res = await send(input, init);
    // Cookie rotated/expired: the 403 response set a fresh cookie, retry once.
    if (res.status === 403 && !SAFE.has((init?.method || "GET").toUpperCase())) {
      const peek = await res.clone().json().catch(() => null);
      if (peek?.error?.code === "CSRF_INVALID") res = await send(input, init);
    }
    return res.ok ? res : flattenError(res);
  };
}

/** Exports are built in the browser; record each one in the server's security log. */
export function recordExport(what: string, format: "csv" | "xlsx" | "pdf" | "json", rows?: number) {
  return fetch("/api/audit-events/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ what, format, ...(rows != null ? { rows } : {}) }),
  }).catch(() => undefined);
}
