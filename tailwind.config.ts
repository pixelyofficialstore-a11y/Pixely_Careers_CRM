import type { Config } from "tailwindcss";

/** Tailwind palette names → theme-aware CSS variables (see scripts/gen-theme-css.mjs). */
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const ramp = (name: string) => Object.fromEntries(SHADES.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]));
const ink = ramp("ink"), brand = ramp("primary"), ok = ramp("success"), warn = ramp("warning"), bad = ramp("danger");

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: ".5625rem", /* 9px */
        md: ".375rem", /* 6px */
        sm: ".1875rem", /* 3px */
      },
      colors: {
        // Legacy palette classes follow the theme.
        slate: ink, gray: ink, zinc: ink, neutral: ink,
        cyan: brand, blue: brand, sky: brand, indigo: brand,
        emerald: ok, green: ok, teal: ok,
        amber: warn, yellow: warn, orange: warn,
        rose: bad, red: bad,
        white: "rgb(var(--ink-50) / <alpha-value>)",
        "on-color": "hsl(var(--primary-foreground) / <alpha-value>)",
        ink, brand,
        "brand-cyan": "hsl(var(--brand-cyan) / <alpha-value>)",
        gold: "hsl(var(--gold) / <alpha-value>)",
        success: "hsl(var(--success) / <alpha-value>)",
        warning: "hsl(var(--warning) / <alpha-value>)",
        danger: "hsl(var(--danger) / <alpha-value>)",
        "page-tint": "hsl(var(--page-tint) / <alpha-value>)",
        // Flat / base colors (regular buttons)
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--chart-1) / <alpha-value>)",
          "2": "hsl(var(--chart-2) / <alpha-value>)",
          "3": "hsl(var(--chart-3) / <alpha-value>)",
          "4": "hsl(var(--chart-4) / <alpha-value>)",
          "5": "hsl(var(--chart-5) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "var(--sidebar-accent-border)"
        },
        status: {
          online: "rgb(34 197 94)",
          away: "rgb(245 158 11)",
          busy: "rgb(239 68 68)",
          offline: "rgb(156 163 175)",
        },
        whatsapp: {
          "bg-dark": "hsl(var(--whatsapp-bg-dark) / <alpha-value>)",
          "bg-panel": "hsl(var(--whatsapp-bg-panel) / <alpha-value>)",
          "bg-chat": "hsl(var(--whatsapp-bg-chat) / <alpha-value>)",
          "bg-input": "hsl(var(--whatsapp-bg-input) / <alpha-value>)",
          green: "hsl(var(--whatsapp-green) / <alpha-value>)",
          "green-dark": "hsl(var(--whatsapp-green-dark) / <alpha-value>)",
          teal: "hsl(var(--whatsapp-teal) / <alpha-value>)",
          "bubble-out": "hsl(var(--whatsapp-bubble-out) / <alpha-value>)",
          "bubble-in": "hsl(var(--whatsapp-bubble-in) / <alpha-value>)",
          header: "hsl(var(--whatsapp-header) / <alpha-value>)",
          hover: "hsl(var(--whatsapp-hover) / <alpha-value>)",
          active: "hsl(var(--whatsapp-active) / <alpha-value>)",
          "text-primary": "hsl(var(--whatsapp-text-primary) / <alpha-value>)",
          "text-secondary": "hsl(var(--whatsapp-text-secondary) / <alpha-value>)",
          icon: "hsl(var(--whatsapp-icon) / <alpha-value>)",
          divider: "hsl(var(--whatsapp-divider) / <alpha-value>)",
          unread: "hsl(var(--whatsapp-unread) / <alpha-value>)",
        },
        tag: {
          new: "hsl(var(--tag-new) / <alpha-value>)",
          working: "hsl(var(--tag-working) / <alpha-value>)",
          pending: "hsl(var(--tag-pending) / <alpha-value>)",
          issues: "hsl(var(--tag-issues) / <alpha-value>)",
          satisfied: "hsl(var(--tag-satisfied) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      height: { control: "var(--control-h)" },
      minHeight: { control: "var(--control-h)", touch: "44px" },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 180ms ease-out both",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
