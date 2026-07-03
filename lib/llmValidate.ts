/**
 * Canonical validators for LLM output (data-integrity, phase 2).
 *
 * The 2026-07-03 audit fixed 38 findings by hand, each re-deriving the same handful of checks inline:
 * ground a "verbatim" quote against the source, bound a number to a plausible scale, coerce a date /
 * enum, whitelist LLM-emitted tickers against the known input set. Those checks lived as copy-pasted
 * one-liners, so a NEW script inherited none of them and could reintroduce a closed bug class.
 *
 * This module is their single, TESTED home (see tests/llmValidate.test.ts). Pure + fs-free so it's
 * usable from both scripts and route handlers. Doctrine: code verifies, models propose — use these to
 * verify. Prefer them over a fresh inline regex when adding LLM-backed features.
 */

/** Normalize free text for grounding comparisons: collapse whitespace, drop $ and commas, lowercase.
 *  (The exact transform proven in refresh-sss / refresh-guidance quote grounding.) */
export function normText(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").replace(/[,$]/g, "").toLowerCase().trim();
}

/**
 * Return the quote only if it actually appears (normalized) in the source text — else null. Guards
 * against an LLM "verbatim quote" it actually paraphrased or invented. Compares the first 80 normalized
 * chars (long quotes drift at the tail). Quotes shorter than `minLen` can't be meaningfully grounded.
 */
export function groundedQuote(quote: unknown, source: string, minLen = 8): string | null {
  if (typeof quote !== "string") return null;
  const nq = normText(quote);
  if (nq.length < minLen) return null;
  return normText(source).includes(nq.slice(0, 80)) ? quote.trim() : null;
}

/**
 * Coerce to a finite number and enforce a plausible band — else null. Strips $ and commas from strings.
 * `absMax` bounds |v| (a symmetric sanity cap); `min`/`max` bound the value directly. A number outside
 * the band is treated as a misread (e.g. a margin% pulled into an EPS field, a $-value where $M was meant).
 */
export function boundedNumber(v: unknown, opts: { min?: number; max?: number; absMax?: number } = {}): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[,$]/g, "")) : NaN;
  if (!Number.isFinite(n)) return null;
  if (opts.absMax != null && Math.abs(n) > opts.absMax) return null;
  if (opts.min != null && n < opts.min) return null;
  if (opts.max != null && n > opts.max) return null;
  return n;
}

/** Validate an ISO date string → 'YYYY-MM-DD' (must be a REAL calendar date) — else null. Catches an
 *  LLM date like '2026-13-45' that passes a bare regex but is NaN, and a non-string / empty value. */
export function isoDateOnly(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const d = v.slice(0, 10);
  return Number.isFinite(Date.parse(d)) ? d : null;
}

/** Coerce a value to one of `allowed`, else `fallback`. For enum fields a model occasionally embellishes
 *  (a confidence of "very high", a docType outside the schema) — the badge/branch must see a known value. */
export function coerceEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Uppercase + charset-scrub a single ticker to the plausible symbol charset — '' if unusable. Does NOT
 *  validate the symbol exists (that needs a Yahoo/known-set check); it only sanitizes the string. */
export function cleanTicker(v: unknown): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 6);
}

/**
 * Keep only the tickers present in `known` — a hallucinated symbol would render as a wrong-company
 * /stock/ link. `known` should carry UPPERCASE symbols (a Set is used as-is; an array is uppercased).
 * De-duplicated, order preserved.
 */
export function whitelistTickers(tickers: unknown, known: Set<string> | string[]): string[] {
  const set = known instanceof Set ? known : new Set(known.map((k) => String(k).toUpperCase()));
  const out: string[] = [];
  for (const t of Array.isArray(tickers) ? tickers : []) {
    const c = cleanTicker(t);
    if (c && set.has(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Safe string coercion: trimmed string, or '' for anything non-string. Prevents the `(x||"").trim()`
 *  crash class where a model returns a number/object for a text field and `.trim()` throws. */
export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
