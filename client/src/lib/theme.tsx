import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";

/** Light (default) / Dark / System. Saved per user on this device (px-theme:<userId>)
 *  and mirrored to px-theme so /theme-init.js can apply it before first paint. */
export type ThemePref = "light" | "dark" | "system";

const GLOBAL_KEY = "px-theme";
const userKey = (id: number | string) => `px-theme:${id}`;
const isPref = (v: unknown): v is ThemePref => v === "light" || v === "dark" || v === "system";

const systemDark = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && systemDark());
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#010C28" : "#FFFFFF");
  return dark;
}

function read(key: string): ThemePref | null {
  try { const v = localStorage.getItem(key); return isPref(v) ? v : null; } catch { return null; }
}
function write(key: string, v: ThemePref) {
  try { localStorage.setItem(key, v); } catch { /* ignore */ }
}

type Ctx = { pref: ThemePref; resolved: "light" | "dark"; setPref: (p: ThemePref) => void };
const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ userId, children }: { userId?: number | null; children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(() => read(GLOBAL_KEY) ?? "light");
  const [resolved, setResolved] = useState<"light" | "dark">(() => (document.documentElement.classList.contains("dark") ? "dark" : "light"));

  // Switching user (login) loads that user's choice on this device.
  useEffect(() => {
    if (userId == null) return;
    const saved = read(userKey(userId));
    if (saved) { setPrefState(saved); write(GLOBAL_KEY, saved); }
  }, [userId]);

  useEffect(() => {
    setResolved(apply(pref) ? "dark" : "light");
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(apply("system") ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    write(GLOBAL_KEY, p);
    if (userId != null) write(userKey(userId), p);
  }, [userId]);

  return <ThemeContext.Provider value={{ pref, resolved, setPref }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme outside ThemeProvider");
  return ctx;
}
