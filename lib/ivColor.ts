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
