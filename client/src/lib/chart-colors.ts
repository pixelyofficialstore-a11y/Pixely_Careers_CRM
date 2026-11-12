import { useEffect, useState } from "react";
import { useTheme } from "@/lib/theme";

/** Chart colours resolved from the brand CSS variables (SVG attributes can't use var()). */
export function useChartColors() {
  const { resolved } = useTheme();
  const read = () => {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => `hsl(${css.getPropertyValue(name).trim()})`;
    return {
      primary: v("--chart-1"),
      accent: v("--chart-2"),
      success: v("--chart-3"),
      warning: v("--chart-4"),
      gold: v("--chart-5"),
      danger: v("--danger"),
      grid: v("--border"),
      text: v("--text-secondary"),
      card: v("--card"),
    };
  };
  const [colors, setColors] = useState(read);
  useEffect(() => { setColors(read()); }, [resolved]);
  return colors;
}

export const rupees = (paisa: number | null | undefined) => `Rs ${Math.round((paisa || 0) / 100).toLocaleString("en-PK")}`;
export const compactRupees = (paisa: number) => {
  const r = paisa / 100;
  if (r >= 1_000_000) return `${(r / 1_000_000).toFixed(1)}M`;
  if (r >= 1_000) return `${Math.round(r / 1_000)}k`;
  return String(Math.round(r));
};
