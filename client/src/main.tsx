import { createRoot } from "react-dom/client";
import "@fontsource-variable/dm-sans";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import { installApiFetch } from "./lib/http";
import App from "./App";
import "./index.css";

// CSRF header + error-shape handling for every /api request (before any query runs).
installApiFetch();

// PWA: the install event can fire before React mounts; keep it for <InstallPrompt>.
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  (window as any).__pxInstallPrompt = e;
  window.dispatchEvent(new Event("px-install-ready"));
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
  // Notification click while the app is open: route in place (no reload).
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data;
    if (data?.type !== "NAVIGATE" || typeof data.url !== "string" || !data.url.startsWith("/")) return;
    window.history.pushState(null, "", data.url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

createRoot(document.getElementById("root")!).render(<App />);
