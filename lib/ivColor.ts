/**
 * Shared sequential cool→warm IV color scale (blue-200 → amber-200 → red-600). Used by both the 2D
 * vol-surface heatmap and the 3D surface so the two views read identically. t ∈ [0,1] (low→high IV).
 */
const clampByte = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((x) => clampByte(x).toString(16).padStart(2, "0")).join("");
const STOPS = [
  [191, 219, 254],
  [253, 230, 138],
  [220, 38, 38],
];

export function ivColor(t: number): string {
  const tt = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const seg = tt < 0.5 ? 0 : 1;
  const lt = tt < 0.5 ? tt / 0.5 : (tt - 0.5) / 0.5;
  const a = STOPS[seg],
    b = STOPS[seg + 1];
  return hex(a[0] + (b[0] - a[0]) * lt, a[1] + (b[1] - a[1]) * lt, a[2] + (b[2] - a[2]) * lt);
}

// ABSOLUTE-IV color scale over a fixed annualized-IV range, so a low-vol name (e.g. a staple ~15%)
// reads cool/low and a high-vol name (~45%) reads warm/high — instead of each surface being normalized
// to its OWN min/max, which made every stock's surface look identical. Values outside the band clamp.
export const IV_ABS_LO = 10, IV_ABS_HI = 65; // % annualized
export const ivAbsT = (ivPct: number) => (ivPct - IV_ABS_LO) / (IV_ABS_HI - IV_ABS_LO);
export const ivColorAbs = (ivPct: number) => ivColor(ivAbsT(ivPct));
