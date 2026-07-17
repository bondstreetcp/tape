/**
 * Filing semantic index — the nightly build (NAS overnight-compute #3). Embeds the overnight-filings
 * desk notes with a local CPU model (bge-small-en-v1.5, 384-d) and accumulates the vectors into a
 * durable archive, then precomputes each current-window note's nearest neighbours so the /overnight
 * board can show a "Related filings" list with ZERO runtime embedding.
 *
 * Why accumulate: overnight-filings.json is a rolling ~36-60h window OVERWRITTEN nightly with no
 * history, so this job upserts tonight's vectors into its own persistent store (data/filing-index.json)
 * BEFORE the window is overwritten — turning the ephemeral feed into a growing, searchable archive.
 *
 * Compute-over-owned-data, no external fetches (the embed model caches locally on first use). Math is
 * pure + unit-tested in lib/filingIndex; the embedder is server/tooling-only in lib/embedLocal (never
 * the app bundle). Writes through writeFeedGuarded → degrades to STALE, never EMPTY.
 */
import { promises as fs } from "fs";
import path from "path";
import {
  buildEmbedText, encodeVec, decodeVec, topKRelated, mergeIndexAccumulate, metaOf,
  type FilingVec, type FilingIndex,
} from "../lib/filingIndex";
import { embedMany, EMBED_MODEL, EMBED_DIM } from "../lib/embedLocal";
import { writeFeedGuarded } from "../lib/feedGuard";
import { loadOvernightFilings } from "../lib/overnightFilings";

const DATA = path.join(process.cwd(), "data");
const INDEX_FILE = path.join(DATA, "filing-index.json");
const KEEP = Number(process.env.INDEX_KEEP || 10000);      // rows retained (newest by filedAt) — ~single-digit MB
const REL_K = Number(process.env.INDEX_REL_K || 6);         // neighbours per note
const REL_MIN = Number(process.env.INDEX_REL_MIN || 0.5);   // min cosine to count as "related"

async function main() {
  const data = await loadOvernightFilings();
  if (!data || !data.items?.length) {
    console.error("filing-index: no overnight-filings window on disk — keeping the prior index (degrade to STALE, never EMPTY).");
    process.exit(1);
  }

  // Prior accumulating store (internal state; absent on the very first run). Discard it if it was
  // built under a DIFFERENT model/dim — those vectors live in another space and would produce
  // meaningless cosines against today's, silently poisoning related[]. Rebuild fresh in that case.
  let prior: FilingVec[] = [];
  try {
    const p = JSON.parse(await fs.readFile(INDEX_FILE, "utf8")) as FilingIndex;
    if (p.model === EMBED_MODEL && p.dim === EMBED_DIM) prior = p.rows || [];
    else if (p.rows?.length) console.warn(`filing-index: prior index is ${p.model}/${p.dim}d ≠ ${EMBED_MODEL}/${EMBED_DIM}d — discarding it, rebuilding from this window.`);
  } catch { prior = []; }

  // Window notes with non-empty embeddable text (a NONE-gated/administrative note yields "" → skipped).
  const windowItems = data.items.filter((it) => buildEmbedText(it).length > 0);
  const texts = windowItems.map((it) => buildEmbedText(it));
  console.log(`filing-index: ${windowItems.length}/${data.items.length} window notes have text · prior archive ${prior.length} rows · embedding…`);
  const t0 = Date.now();
  const vecs = await embedMany(texts, (d, n) => { if (d === n || d % 50 === 0) console.log(`  embedded ${d}/${n}`); });
  if (vecs.length !== windowItems.length) { // invariant: embedMany returns one vector per input
    console.error(`filing-index: embed produced ${vecs.length}/${windowItems.length} vectors — keeping the prior index (degrade to STALE).`);
    process.exit(1);
  }
  // Vector-sanity gate — the REAL backstop (count parity is necessary but not sufficient). A silently
  // broken embedder can return the right COUNT of DEGENERATE vectors (all-zero, non-finite, or one
  // constant repeated), which would poison every window row's related[] and progressively the archive.
  // Healthy vectors are L2-normalized (norm ≈ 1); reject and keep the prior archive if the batch looks
  // degenerate.
  const badNorm = vecs.filter((v) => { let s = 0; for (const x of v) { if (!Number.isFinite(x)) return true; s += x * x; } return Math.sqrt(s) < 0.5; }).length;
  const allIdentical = vecs.length > 2 && vecs.every((v) => v.every((x, i) => Math.abs(x - vecs[0][i]) < 1e-6));
  if (badNorm > vecs.length * 0.2 || allIdentical) {
    console.error(`filing-index: fresh embeddings look DEGENERATE (${badNorm}/${vecs.length} bad-norm${allIdentical ? ", all-identical" : ""}) — keeping the prior index (degrade to STALE, never EMPTY).`);
    process.exit(1);
  }
  console.log(`filing-index: embedded ${vecs.length} notes in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const freshRows: FilingVec[] = windowItems.map((it, i) => {
    const { b, s } = encodeVec(vecs[i]);
    return { ...metaOf({ accession: it.accession, ticker: it.ticker, form: it.form, filedAt: it.filedAt, headline: it.headline, url: it.url }), v: b, s, related: [] };
  });

  // Accumulate (fresh wins on a re-embed), keep the newest KEEP.
  const merged = mergeIndexAccumulate(prior, freshRows, KEEP);

  // Decode every surviving vector once → nearest-neighbour candidates. Compute related[] for the
  // CURRENT window only (the rows the board renders) against the whole archive; clear stale related on
  // everything else so the file carries neighbours for ~one window's worth of rows, not all of them.
  const windowAcc = new Set(windowItems.map((it) => it.accession));
  // A co-filed accession (a joint 425/S-4) appears under multiple tickers in the window but collapses
  // to ONE index row. Exclude EVERY co-filer's ticker from that row's related[], so the single list is
  // correctly cross-sectional no matter which co-filer's card renders it.
  const tickersByAcc = new Map<string, Set<string>>();
  for (const it of data.items) {
    if (!tickersByAcc.has(it.accession)) tickersByAcc.set(it.accession, new Set());
    tickersByAcc.get(it.accession)!.add(it.ticker);
  }
  const candidates = merged.map((r) => ({ meta: metaOf(r), vec: decodeVec(r.v, r.s) }));
  const vecByAcc = new Map(merged.map((r, i) => [r.accession, candidates[i].vec]));
  let withRelated = 0;
  for (const r of merged) {
    if (windowAcc.has(r.accession)) {
      r.related = topKRelated(vecByAcc.get(r.accession)!, candidates, { k: REL_K, minScore: REL_MIN, excludeAccession: r.accession, excludeTicker: tickersByAcc.get(r.accession) ?? r.ticker });
      if (r.related.length) withRelated++;
    } else {
      r.related = [];
    }
  }

  const index: FilingIndex = { generatedAt: new Date().toISOString(), model: EMBED_MODEL, dim: EMBED_DIM, rows: merged };
  const w = await writeFeedGuarded("filing-index.json", index);
  if (!w.written) {
    console.error(`filing-index: WRITE BLOCKED — ${w.reason}. Built ${merged.length} rows; keeping the prior index (degrade to STALE, never EMPTY).`);
    process.exit(1);
  }
  console.log(`filing-index: wrote ${merged.length} rows · ${withRelated}/${windowItems.length} window notes have ≥1 related [${w.reason}]`);
  for (const r of merged.filter((x) => x.related.length).slice(0, 6)) {
    console.log(`  ${r.ticker.padEnd(5)} ${r.form.padEnd(5)} ${r.headline.slice(0, 52)}`);
    for (const rel of r.related.slice(0, 2)) console.log(`     ${rel.score.toFixed(2)} ${rel.ticker} ${rel.form} · ${rel.headline.slice(0, 46)}`);
  }
}

main().catch((e) => { console.error("filing-index:", String(e?.message || e)); process.exit(1); });
