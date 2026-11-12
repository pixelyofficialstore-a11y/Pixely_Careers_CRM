/**
 * Generates client/src/theme.css: the brand tokens for light + dark.
 *
 *   node scripts/gen-theme-css.mjs
 *
 * The app's older screens use Tailwind palette classes (slate / cyan / emerald …).
 * Instead of hardcoding those colours, tailwind.config.ts points every one of them
 * at a CSS variable defined here, so each class follows the active theme:
 *   slate            → "ink" ramp (950 = page, 900 = surface, 800 = border … 100 = text)
 *   cyan / blue / sky→ brand primary
 *   emerald / green  → success,  amber / yellow / orange → warning,  rose / red → danger
 * In light mode the light shades (100–400, used for text on dark) turn dark so text
 * stays readable on white.
 */
import fs from "node:fs";

const hex = (h) => { const n = parseInt(h.slice(1), 16); return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`; };
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const ramps = {
  ink: {
    dark:  ["#FFFFFF", "#F1F4FA", "#DDE3F0", "#C5CDE0", "#A9B3CC", "#7A85A3", "#44537A", "#2A3A66", "#1C2A50", "#0A1636", "#010C28"],
    light: ["#010C28", "#010C28", "#161E34", "#343D52", "#5B6478", "#6B7489", "#969EB0", "#D3D8E4", "#E6E9F0", "#F6F8FC", "#FFFFFF"],
  },
  primary: {
    dark:  ["#EEF3FF", "#D6E2FF", "#B2C8FF", "#8AABFF", "#6A92FF", "#4576FF", "#0048FF", "#01219C", "#011A6E", "#011446", "#010C28"],
    light: ["#EEF3FF", "#01219C", "#01219C", "#0038CC", "#0048FF", "#0048FF", "#0040E0", "#01219C", "#C7D6FF", "#E3EBFF", "#F2F6FF"],
  },
  success: {
    dark:  ["#F0FDF4", "#DCFCE7", "#BBF7D0", "#86EFAC", "#4ADE80", "#22C55E", "#16A34A", "#15803D", "#166534", "#14532D", "#052E16"],
    light: ["#F0FDF4", "#15803D", "#15803D", "#15803D", "#16A34A", "#16A34A", "#16A34A", "#15803D", "#BBF7D0", "#DCFCE7", "#F0FDF4"],
  },
  warning: {
    dark:  ["#FFFBEB", "#FEF3C7", "#FDE68A", "#FCD34D", "#FBBF24", "#F59E0B", "#D97706", "#B45309", "#92400E", "#78350F", "#451A03"],
    light: ["#FFFBEB", "#B45309", "#B45309", "#B45309", "#D97706", "#D97706", "#D97706", "#B45309", "#FDE68A", "#FEF3C7", "#FFFBEB"],
  },
  danger: {
    dark:  ["#FEF2F2", "#FEE2E2", "#FECACA", "#FCA5A5", "#F87171", "#EF4444", "#DC2626", "#B91C1C", "#991B1B", "#7F1D1D", "#450A0A"],
    light: ["#FEF2F2", "#B91C1C", "#B91C1C", "#B91C1C", "#DC2626", "#DC2626", "#DC2626", "#B91C1C", "#FECACA", "#FEE2E2", "#FEF2F2"],
  },
};

const vars = (mode) => Object.entries(ramps).flatMap(([name, r]) => r[mode].map((h, i) => `  --${name}-${SHADES[i]}: ${hex(h)};`)).join("\n");

// shadcn-style semantic tokens (HSL channels).
const semantic = {
  light: {
    "background": "0 0% 100%", "foreground": "223 95% 8%",
    "page-tint": "220 50% 98%", "sidebar-bg": "220 50% 98%",
    "card": "0 0% 100%", "card-foreground": "223 95% 8%", "card-border": "222 25% 92%",
    "popover": "0 0% 100%", "popover-foreground": "223 95% 8%", "popover-border": "222 25% 92%",
    "primary": "223 100% 50%", "primary-foreground": "0 0% 100%", "primary-hover": "228 99% 31%",
    "secondary": "220 50% 96%", "secondary-foreground": "223 95% 8%",
    "muted": "220 50% 96%", "muted-foreground": "221 14% 41%",
    "accent": "223 100% 96%", "accent-foreground": "228 99% 31%",
    "brand-cyan": "184 100% 50%", "gold": "39 45% 61%",
    "success": "142 76% 36%", "warning": "32 95% 44%", "danger": "0 72% 51%",
    "destructive": "0 72% 51%", "destructive-foreground": "0 0% 100%",
    "border": "222 25% 92%", "input": "222 22% 86%", "ring": "223 100% 50%",
    "text-primary": "223 95% 8%", "text-secondary": "221 14% 41%", "text-muted": "221 12% 48%",
    "surface-1": "0 0% 100%", "surface-2": "220 50% 98%", "surface-3": "220 45% 95%",
    "border-hover": "223 60% 80%", "accent-primary": "223 100% 50%",
    "chart-1": "223 100% 50%", "chart-2": "184 100% 42%", "chart-3": "142 76% 36%", "chart-4": "32 95% 44%", "chart-5": "39 45% 61%",
    "shadow": "223 60% 20%",
  },
  dark: {
    "background": "223 95% 8%", "foreground": "0 0% 100%",
    "page-tint": "224 79% 11%", "sidebar-bg": "224 79% 11%",
    "card": "224 69% 13%", "card-foreground": "0 0% 100%", "card-border": "224 48% 21%",
    "popover": "224 69% 13%", "popover-foreground": "0 0% 100%", "popover-border": "224 48% 21%",
    "primary": "224 100% 64%", "primary-foreground": "0 0% 100%", "primary-hover": "223 100% 50%",
    "secondary": "224 50% 18%", "secondary-foreground": "0 0% 100%",
    "muted": "224 50% 18%", "muted-foreground": "223 26% 73%",
    "accent": "224 60% 20%", "accent-foreground": "224 100% 82%",
    "brand-cyan": "184 100% 50%", "gold": "39 45% 61%",
    "success": "142 69% 58%", "warning": "43 96% 56%", "danger": "0 91% 71%",
    "destructive": "0 84% 60%", "destructive-foreground": "0 0% 100%",
    "border": "224 48% 21%", "input": "224 42% 26%", "ring": "224 100% 64%",
    "text-primary": "0 0% 100%", "text-secondary": "223 26% 73%", "text-muted": "223 18% 56%",
    "surface-1": "224 69% 13%", "surface-2": "224 60% 16%", "surface-3": "224 52% 19%",
    "border-hover": "224 60% 36%", "accent-primary": "224 100% 64%",
    "chart-1": "224 100% 64%", "chart-2": "184 100% 50%", "chart-3": "142 69% 58%", "chart-4": "43 96% 56%", "chart-5": "39 45% 61%",
    "shadow": "230 80% 2%",
  },
};
const sem = (mode) => Object.entries(semantic[mode]).map(([k, v]) => `  --${k}: ${v};`).join("\n");

const css = `/* GENERATED by scripts/gen-theme-css.mjs — edit the script, not this file. */
:root {
  color-scheme: light;
${sem("light")}
${vars("light")}
}

.dark {
  color-scheme: dark;
${sem("dark")}
${vars("dark")}
}
`;
fs.writeFileSync("client/src/theme.css", css);
console.log("✔ client/src/theme.css");
