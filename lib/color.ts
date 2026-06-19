import { COLOR_CLAMP, type TimeframeKey } from "./timeframes";

const NEG = { r: 0xef, g: 0x44, b: 0x44 }; // red-500
const POS = { r: 0x22, g: 0xc5, b: 0x5e }; // green-500
const MID = { r: 0x26, g: 0x2b, b: 0x36 }; // neutral panel gray

const lerp = (a: number, b: number, u: number) => Math.round(a + (b - a) * u);

/** Diverging red→gray→green color for a return %, scaled to the timeframe. */
export function returnColor(pct: number | null | undefined, tf: TimeframeKey): string {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "#1a1f2e";
  const clamp = COLOR_CLAMP[tf] || 10;
  const t = Math.max(-1, Math.min(1, pct / clamp));
  const target = t < 0 ? NEG : POS;
  const u = Math.abs(t);
  // ease so small moves still read as gray-ish, large moves saturate
  const e = Math.pow(u, 0.8);
  const r = lerp(MID.r, target.r, e);
  const g = lerp(MID.g, target.g, e);
  const b = lerp(MID.b, target.b, e);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Plain up/down/flat text color. */
export function trendColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "#8b93a7";
  if (pct > 0.001) return "#22c55e";
  if (pct < -0.001) return "#ef4444";
  return "#8b93a7";
}
