/**
 * Filing semantic index — PURE, fs-free, ONNX-free helpers for the local-CPU embedding index over the
 * overnight-filings desk notes (NAS overnight-compute #3). The actual embedding (bge-small-en-v1.5)
 * happens ONLY in scripts/refresh-filing-index.ts via lib/embedLocal (server/tooling-only, never the
 * app bundle); this module owns the corpus→text shaping, the vector codec, cosine + nearest-neighbour
 * search, and the accumulate-then-prune merge that turns the ephemeral nightly window into a durable
 * archive. All of it is deterministic and unit-tested — the app never runs an embedding, it only reads
 * the precomputed `related[]` this produces.
 *
 * Vectors are stored int8-quantized with a per-vector scale (base64): a 384-d unit embedding is ~0.6KB
 * this way vs ~3KB as JSON floats, keeping a year of filings to single-digit MB on the R2 tarball. The
 * quantization error is well under the cosine resolution we act on (verified in the codec test).
 */

// ── Types ────────────────────────────────────────────────────────────────────────────────────────
/** The denormalized metadata carried on every index row (and every related-neighbour entry) so the
 *  ISR page can render a "Related filings" list with zero lookups. */
export interface FilingMeta {
  accession: string;
  ticker: string;
  form: string;
  filedAt: string; // ISO
  headline: string;
  url: string; // EDGAR filing-index page
}

/** A nearest neighbour with its cosine similarity to the query filing. */
export interface RelatedFiling extends FilingMeta {
  score: number; // cosine, 0..1 (rounded 4dp)
}

/** One filing in the accumulating store: its metadata, its int8-quantized vector (`v` base64 + `s`
 *  scale), and the precomputed neighbours (populated only for rows in the current window; [] else). */
export interface FilingVec extends FilingMeta {
  v: string; // base64 of an Int8Array(384)
  s: number; // per-vector dequant scale (v[i] = int8[i]/127 * s)
  related: RelatedFiling[];
}

export interface FilingIndex {
  generatedAt: string;
  model: string; // e.g. "bge-small-en-v1.5"
  dim: number; // 384
  rows: FilingVec[];
}

/** Copy just the metadata fields off a richer row (drops the vector + related). */
export const metaOf = (r: FilingMeta): FilingMeta => ({
  accession: r.accession, ticker: r.ticker, form: r.form, filedAt: r.filedAt, headline: r.headline, url: r.url,
});

// ── Corpus → embeddable text ─────────────────────────────────────────────────────────────────────
/** Concatenate a desk note into one clean string to embed: headline + what-changed bullets + the
 *  takeaway + (only if present) the JSON of the stated key metrics. A NONE-gated / empty note yields
 *  "" so the caller can skip it (never embed boilerplate). */
export function buildEmbedText(item: {
  headline?: string;
  whatChanged?: string[];
  decisionTakeaway?: string;
  keyMetrics?: Record<string, unknown>;
}): string {
  const parts: string[] = [];
  if (item.headline && item.headline !== "NONE") parts.push(item.headline);
  for (const w of item.whatChanged || []) if (w && w.trim()) parts.push(w.trim());
  if (item.decisionTakeaway && item.decisionTakeaway.trim()) parts.push(item.decisionTakeaway.trim());
  let text = parts.join(" ").replace(/\s+/g, " ").trim();
  const km = item.keyMetrics || {};
  if (Object.keys(km).length) text = (text ? text + " " : "") + JSON.stringify(km);
  return text.trim();
}

// ── int8 vector codec ────────────────────────────────────────────────────────────────────────────
/** Quantize a float embedding to int8 with a per-vector scale (max-abs), base64-encoded. Per-vector
 *  scaling uses the full int8 range regardless of the embedding's magnitude, so the rounding error is
 *  ≤ s/127 per component — negligible for cosine at bge-small scale. */
export function encodeVec(v: ArrayLike<number>): { b: string; s: number } {
  let max = 0;
  for (let i = 0; i < v.length; i++) { const a = Math.abs(v[i]); if (a > max) max = a; }
  const s = max || 1;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round((v[i] / s) * 127)));
  return { b: Buffer.from(q.buffer, q.byteOffset, q.byteLength).toString("base64"), s };
}

/** Inverse of encodeVec → a Float32Array. */
export function decodeVec(b: string, s: number): Float32Array {
  const buf = Buffer.from(b, "base64");
  const q = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = (q[i] / 127) * s;
  return out;
}

// ── Similarity + nearest neighbours ──────────────────────────────────────────────────────────────
/** True cosine similarity (robust to non-unit inputs, e.g. dequantized vectors). Unequal lengths are a
 *  hard mismatch → 0, never a misleading prefix cosine (guards a stale-dim vector from a model change
 *  scoring against a new-dim query). */
export function cosineSim(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export interface TopKOpts {
  k?: number;
  minScore?: number;
  excludeAccession?: string; // always the query filing itself
  // Ticker(s) to exclude, to surface OTHER companies' filings (cross-sectional "related"). Pass a SET
  // for a co-filed accession so ALL of its co-registrants are excluded, not just one.
  excludeTicker?: string | Iterable<string>;
}

/** Top-k nearest neighbours by cosine, deterministically ordered (score desc, then newest, then
 *  accession). Excludes the query filing (and optionally its ticker[s]), dedupes by accession, and
 *  drops anything below minScore. Candidates carry decoded (float) vectors. */
export function topKRelated(
  queryVec: ArrayLike<number>,
  candidates: { meta: FilingMeta; vec: ArrayLike<number> }[],
  opts: TopKOpts = {},
): RelatedFiling[] {
  const { k = 5, minScore = 0.5, excludeAccession, excludeTicker } = opts;
  const exTickers = excludeTicker == null ? null : typeof excludeTicker === "string" ? new Set([excludeTicker]) : new Set(excludeTicker);
  const scored: RelatedFiling[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const acc = c.meta.accession;
    if (acc === excludeAccession || seen.has(acc)) continue;
    if (exTickers && exTickers.has(c.meta.ticker)) continue;
    const score = cosineSim(queryVec, c.vec);
    if (score < minScore) continue;
    seen.add(acc); // claim the accession only once a row actually QUALIFIES (a sub-threshold dup must
    scored.push({ ...metaOf(c.meta), score: +score.toFixed(4) }); // not suppress a later qualifying one)
  }
  scored.sort((a, b) => b.score - a.score || b.filedAt.localeCompare(a.filedAt) || a.accession.localeCompare(b.accession));
  return scored.slice(0, k);
}

// ── Accumulate-then-prune ────────────────────────────────────────────────────────────────────────
/** Merge tonight's freshly-embedded rows into the prior store, keyed by accession (fresh wins on a
 *  re-embed), then keep the newest `keep` by filedAt. This is what turns the rolling overnight-filings
 *  window (overwritten nightly, no history) into a durable archive without unbounded growth. */
export function mergeIndexAccumulate(prior: FilingVec[], fresh: FilingVec[], keep: number): FilingVec[] {
  const byAcc = new Map<string, FilingVec>();
  for (const r of prior) if (r?.accession) byAcc.set(r.accession, r);
  for (const r of fresh) if (r?.accession) byAcc.set(r.accession, r); // fresh wins on a duplicate accession
  const all = [...byAcc.values()];
  all.sort((a, b) => (b.filedAt || "").localeCompare(a.filedAt || "") || a.accession.localeCompare(b.accession));
  return keep > 0 ? all.slice(0, keep) : all;
}
