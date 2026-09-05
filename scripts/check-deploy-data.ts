/**
 * check-deploy-data — post-deploy smoke test that the SERVED deployment actually has its data.
 *
 * Purpose-built for the Vercel serverless mirror, where per-route outputFileTracingExcludes
 * (lib/tracingExcludes.mjs) strips data/series/** and data/company/** out of the functions that
 * shouldn't need them. If that classification is ever wrong, a route silently renders EMPTY on Vercel
 * (loadSymbolSeries returns null on a missing file) while the NAS — which reads data/ off disk — stays
 * fine. Nothing else catches that. This probes a representative set of routes on the DEPLOY_CHECK_URL
 * origin and asserts each one's DATA is present, not just a 200.
 *
 * Leans hardest on series-backed routes: series exclusion is the high-risk case (no fallback), whereas
 * company exclusion self-heals (lib/companyCache live-fetches on a miss).
 *
 * Runs from .github/workflows/vercel-postdeploy-check.yml after a successful Vercel Production deploy
 * (and on a daily safety-net schedule). Pages ALERT_WEBHOOK_URL (lib/alertNotify) and exits 1 on any
 * confirmed failure; transient errors (cold start / 5xx / network) are retried before counting.
 *
 *   DEPLOY_CHECK_URL       base origin to probe, e.g. https://tape.vercel.app   (REQUIRED)
 *   DEPLOY_CHECK_SYMBOL    ticker to probe with (default AAPL — must exist in the universe)
 *   DEPLOY_CHECK_UNIVERSE  universe slug (default sp500)
 *   ALERT_WEBHOOK_URL      Slack/Discord/ntfy webhook (optional; just logs if unset)
 */
import { notifyAlert } from "../lib/alertNotify";
import { sleep } from "../lib/scriptKit";

const BASE = (process.env.DEPLOY_CHECK_URL || "").trim().replace(/\/+$/, "");
const SYM = (process.env.DEPLOY_CHECK_SYMBOL || "AAPL").toUpperCase();
const UNI = process.env.DEPLOY_CHECK_UNIVERSE || "sp500";

// A probe returns null when healthy, or a short failure reason. `transient:true` means "retry" (the
// origin was unreachable / 5xx / non-JSON) rather than a real data problem.
type Verdict = null | { detail: string; transient?: boolean };
interface Probe { name: string; path: string; run: (res: Response, text: string) => Verdict | Promise<Verdict>; }

function json(text: string): any { try { return JSON.parse(text); } catch { return undefined; } }
function firstArray(b: any): any[] | null {
  if (Array.isArray(b)) return b;
  for (const k of ["items", "headlines", "results", "rows", "data"]) if (Array.isArray(b?.[k])) return b[k];
  return null;
}

const PROBES: Probe[] = [
  // NB: deliberately NOT probing /api/health/data here — that endpoint gates on data FRESHNESS (age),
  // which on Vercel depends on deploy cadence, not on whether the tracing-excludes stripped a dir.
  // Freshness is site-health.yml's job (against the NAS). This check is purely about data PRESENCE.
  //
  // SERIES (direct): the strongest signal a series file is bundled in its function. 404/empty = stripped.
  { name: "series", path: `/api/series/${SYM}`, run: (res, t) => {
    if (res.status >= 500) return { detail: `HTTP ${res.status}`, transient: true };
    if (res.status === 404) return { detail: `404 — ${SYM} price series missing (series tracing-exclude may be wrong)` };
    const b = json(t); if (b === undefined) return { detail: `HTTP ${res.status}, non-JSON`, transient: true };
    return Array.isArray(b.daily) && b.daily.length > 50 ? null : { detail: `no daily series (${b.daily?.length ?? "none"} pts)` };
  } },
  // SERIES (computed): vol-cone returns {error:"no history"} at 200 when the series file is absent.
  { name: "vol-cone", path: `/api/vol-cone/${SYM}`, run: (res, t) => {
    if (res.status >= 500) return { detail: `HTTP ${res.status}`, transient: true };
    const b = json(t); if (b === undefined) return { detail: `HTTP ${res.status}, non-JSON`, transient: true };
    return Array.isArray(b.bands) && b.bands.length ? null : { detail: `no cone bands (${b.error || "empty"}) — series may be stripped` };
  } },
  // SERIES + COMPANY: the earnings-prep data payload draws on both.
  { name: "earnings-prep", path: `/api/earnings-prep/${SYM}?part=data`, run: (res, t) => {
    if (res.status >= 500) return { detail: `HTTP ${res.status}`, transient: true };
    const b = json(t); if (b === undefined) return { detail: `HTTP ${res.status}, non-JSON`, transient: true };
    if (b?.error) return { detail: `error: ${String(b.error).slice(0, 60)}` };
    if (b && "data" in b && b.data === null) return { detail: "data:null (quant compute produced nothing)" };
    return b && typeof b === "object" ? null : { detail: "empty body" };
  } },
  // A slimmed "neither" route — confirm the excludes didn't over-strip a route that never needed them.
  { name: "market-headlines", path: "/api/market-headlines", run: (res, t) => {
    if (res.status >= 500) return { detail: `HTTP ${res.status}`, transient: true };
    const b = json(t); if (b === undefined) return { detail: `HTTP ${res.status}, non-JSON`, transient: true };
    const arr = firstArray(b); return arr && arr.length ? null : { detail: "no headlines" };
  } },
  // Page smoke: the stock page (series + company heavy). notFound() → 404 if the name can't render.
  { name: "stock-page", path: `/u/${UNI}/stock/${SYM}`, run: (res, t) => {
    if (res.status >= 500) return { detail: `HTTP ${res.status}`, transient: true };
    if (!res.ok) return { detail: `HTTP ${res.status}` };
    return t.includes(SYM) && t.length > 3000 ? null : { detail: `page too thin (${t.length}b) or missing ${SYM}` };
  } },
  // The route that originally blew the 250MB limit: the sector-compare page needs the sector-ETF series
  // and drops any sector whose series is missing — so a stripped series shows up as absent ETF tickers.
  { name: "compare-page", path: `/u/${UNI}/compare`, run: (res, t) => {
    if (res.status >= 500) return { detail: `HTTP ${res.status}`, transient: true };
    if (!res.ok) return { detail: `HTTP ${res.status}` };
    const etfs = ["XLK", "XLV", "XLF", "XLE", "XLY", "XLP", "XLI"].filter((e) => t.includes(e)).length;
    return etfs >= 3 ? null : { detail: `only ${etfs} sector series rendered — ETF series may be stripped` };
  } },
];

async function attempt(p: Probe): Promise<Verdict> {
  let res: Response;
  try {
    res = await fetch(BASE + p.path, { signal: AbortSignal.timeout(30_000), headers: { "Accept-Encoding": "gzip, br" } });
  } catch (e: any) {
    return { detail: `fetch failed: ${String(e?.message || e).slice(0, 100)}`, transient: true };
  }
  const text = await res.text().catch(() => "");
  return p.run(res, text);
}

async function runProbe(p: Probe): Promise<{ name: string; detail: string } | null> {
  let v: Verdict = { detail: "not run", transient: true };
  for (let i = 1; i <= 3; i++) {
    v = await attempt(p);
    if (!v) { console.log(`✓ ${p.name}`); return null; }
    console.log(`${v.transient ? "…" : "✗"} ${p.name}: ${v.detail}${v.transient && i < 3 ? " (retrying)" : ""}`);
    if (!v.transient) break;      // a real data failure — no point retrying
    if (i < 3) await sleep(15_000); // transient — let a cold function warm up
  }
  return { name: p.name, detail: v!.detail };
}

async function main() {
  if (!BASE) {
    // Skip (not fail): the daily safety-net + manual runs need VERCEL_PROD_URL set. A deployment_status
    // run always supplies the URL, so an empty BASE here just means the optional var isn't configured.
    console.log("check-deploy-data: no DEPLOY_CHECK_URL (set the VERCEL_PROD_URL repo variable to enable scheduled checks) — skipping.");
    return;
  }
  console.log(`check-deploy-data: probing ${BASE} (symbol ${SYM}, universe ${UNI})`);
  const failures: { name: string; detail: string }[] = [];
  for (const p of PROBES) { const f = await runProbe(p); if (f) failures.push(f); }

  if (!failures.length) { console.log(`\nAll ${PROBES.length} probes healthy on ${BASE}.`); return; }
  const summary = failures.map((f) => `${f.name} (${f.detail})`).join(" · ");
  const seriesHit = failures.some((f) => ["series", "vol-cone", "compare-page", "earnings-prep", "stock-page"].includes(f.name));
  const msg = `DEPLOY DATA CHECK FAILED on ${BASE}: ${failures.length}/${PROBES.length} — ${summary}`
    + (seriesHit ? " — a data-backed route came back empty; suspect the outputFileTracingExcludes (lib/tracingExcludes.mjs) stripped a dir a route needs. Regenerate: node scripts/gen-tracing-excludes.mjs --write." : "");
  await notifyAlert(msg, "Tape deploy check");
  console.error(`\n${msg}`);
  // exitCode, not process.exit — avoid the fetch-then-exit libuv assertion (see check-site-health).
  process.exitCode = 1;
}

main().catch((e) => { console.error("check-deploy-data:", String(e?.message || e)); process.exitCode = 1; });
