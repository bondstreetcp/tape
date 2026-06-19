// Technical-indicator math. All functions take a chronological close array and
// return arrays aligned to it (null during the warm-up period).

export function sma(v: number[], p: number): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= p) sum -= v[i - p];
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}

export function ema(v: number[], p: number): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  const k = 2 / (p + 1);
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < v.length; i++) {
    if (prev === null) {
      seed += v[i];
      if (i === p - 1) {
        prev = seed / p;
        out[i] = prev;
      }
      continue;
    }
    prev = (v[i] - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

function emaNullable(v: (number | null)[], p: number): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  const k = 2 / (p + 1);
  let prev: number | null = null;
  let seed = 0;
  let count = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x === null) continue;
    if (prev === null) {
      seed += x;
      count++;
      if (count === p) {
        prev = seed / p;
        out[i] = prev;
      }
      continue;
    }
    prev = (x - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

export interface Macd {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
}

export function macd(v: number[], fast = 12, slow = 26, signalP = 9): Macd {
  const f = ema(v, fast);
  const s = ema(v, slow);
  const line = v.map((_, i) =>
    f[i] != null && s[i] != null ? (f[i] as number) - (s[i] as number) : null,
  );
  const signal = emaNullable(line, signalP);
  const hist = line.map((x, i) =>
    x != null && signal[i] != null ? x - (signal[i] as number) : null,
  );
  return { macd: line, signal, hist };
}

export function rsi(v: number[], p = 14): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  if (v.length <= p) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= p; i++) {
    const d = v[i] - v[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / p;
  let avgLoss = loss / p;
  out[p] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = p + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    avgGain = (avgGain * (p - 1) + (d > 0 ? d : 0)) / p;
    avgLoss = (avgLoss * (p - 1) + (d < 0 ? -d : 0)) / p;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface Bollinger {
  mid: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

export function bollinger(v: number[], p = 20, mult = 2): Bollinger {
  const mid = sma(v, p);
  const upper: (number | null)[] = new Array(v.length).fill(null);
  const lower: (number | null)[] = new Array(v.length).fill(null);
  for (let i = p - 1; i < v.length; i++) {
    let sum = 0;
    for (let j = i - p + 1; j <= i; j++) sum += v[j];
    const mean = sum / p;
    let varSum = 0;
    for (let j = i - p + 1; j <= i; j++) varSum += (v[j] - mean) ** 2;
    const sd = Math.sqrt(varSum / p);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { mid, upper, lower };
}

// ---- UI metadata: which indicators exist and how they're drawn ----

export type OverlayId =
  | "sma20"
  | "sma50"
  | "sma200"
  | "ema12"
  | "ema26"
  | "bb";
export type PanelId = "macd" | "rsi";
export type IndicatorId = OverlayId | PanelId;

export const OVERLAYS: { id: OverlayId; label: string; color: string }[] = [
  { id: "sma20", label: "SMA 20", color: "#38bdf8" },
  { id: "sma50", label: "SMA 50", color: "#fbbf24" },
  { id: "sma200", label: "SMA 200", color: "#f472b6" },
  { id: "ema12", label: "EMA 12", color: "#4ade80" },
  { id: "ema26", label: "EMA 26", color: "#c084fc" },
  { id: "bb", label: "Bollinger (20,2)", color: "#8b93a7" },
];

export const PANELS: { id: PanelId; label: string }[] = [
  { id: "macd", label: "MACD (12,26,9)" },
  { id: "rsi", label: "RSI (14)" },
];

/** Compute the overlay arrays requested, from a close series. */
export function computeOverlay(id: OverlayId, closes: number[]) {
  switch (id) {
    case "sma20":
      return { lines: [{ data: sma(closes, 20), color: "#38bdf8" }] };
    case "sma50":
      return { lines: [{ data: sma(closes, 50), color: "#fbbf24" }] };
    case "sma200":
      return { lines: [{ data: sma(closes, 200), color: "#f472b6" }] };
    case "ema12":
      return { lines: [{ data: ema(closes, 12), color: "#4ade80" }] };
    case "ema26":
      return { lines: [{ data: ema(closes, 26), color: "#c084fc" }] };
    case "bb": {
      const b = bollinger(closes, 20, 2);
      return {
        lines: [
          { data: b.upper, color: "#8b93a7" },
          { data: b.lower, color: "#8b93a7" },
        ],
      };
    }
  }
}
