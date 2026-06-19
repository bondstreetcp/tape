// Distinct line colors for the multi-line industry comparison chart.
export const LINE_PALETTE = [
  "#60a5fa", // blue
  "#f472b6", // pink
  "#34d399", // emerald
  "#fbbf24", // amber
  "#a78bfa", // violet
  "#fb923c", // orange
  "#22d3ee", // cyan
  "#f87171", // red
  "#4ade80", // green
  "#e879f9", // fuchsia
  "#facc15", // yellow
  "#38bdf8", // sky
  "#fca5a5", // rose
  "#c084fc", // purple
  "#2dd4bf", // teal
  "#fdba74", // light orange
  "#93c5fd", // light blue
  "#f9a8d4", // light pink
  "#86efac", // light green
  "#fde047", // light yellow
];

export function colorFor(i: number): string {
  return LINE_PALETTE[i % LINE_PALETTE.length];
}

/** The sector ETF reference line is drawn distinctly (bold, near-white). */
export const ETF_LINE_COLOR = "#e6e9f0";
