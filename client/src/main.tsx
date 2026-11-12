import { createRoot } from "react-dom/client";
import "@fontsource-variable/dm-sans";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import { installApiFetch } from "./lib/http";
import App from "./App";
import "./index.css";

// CSRF header + error-shape handling for every /api request (before any query runs).
installApiFetch();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(<App />);
