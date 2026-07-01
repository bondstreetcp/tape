/**
 * Alert evaluator — checks every active alert_rule against the data Tape already collects and inserts
 * deduped alert_events (the in-app bell). Service-role Postgres via RESEARCH_DATABASE_URL (bypasses
 * RLS so it can write for any user). Idempotent: unique(user_id, dedup_key) + ON CONFLICT DO NOTHING,
 * so re-running never double-fires. Run nightly + intraday. `npm run eval-alerts`.
 *
 *   price    — snapshot price / 1-day move vs a level or ±%
 *   event    — a NEW material 8-K (overnight-filings) / activist campaign / insider cluster on a name
 *   earnings — N days before a name's next earnings date
 *   signal   — cheap vs 10yr history (valuation-history z≤−1) / RS breakout / short-squeeze risk
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

// Load .env.local for local runs (CI injects env directly).
try {
  const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* CI env */
}

const DATA = join(process.cwd(), "data");
const DAY = 86_400_000;
const today = new Date().toISOString().slice(0, 10);
const loadJSON = (p: string): any => {
  try {
    return JSON.parse(readFileSync(join(DATA, p), "utf8"));
  } catch {
    return null;
  }
};
const num = (x: any): number | null => (typeof x === "number" && isFinite(x) ? x : null);

interface Quote { universe: string; price: number | null; ret1d: number | null; ret3m: number | null; pctFromHigh: number | null; earningsDate: string | null; name: string }

function buildQuotes(): Map<string, Quote> {
  const m = new Map<string, Quote>();
  for (const dir of readdirSync(DATA, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const snap = loadJSON(join(dir.name, "snapshot.json"));
    for (const r of snap?.stocks ?? []) {
      if (!r?.symbol) continue;
      const prev = m.get(r.symbol);
      if (prev && prev.price != null) continue; // first universe with a price wins
      m.set(r.symbol, {
        universe: dir.name,
        price: num(r.price),
        ret1d: num(r.returns?.["1d"]),
        ret3m: num(r.returns?.["3m"]),
        pctFromHigh: num(r.pctFromHigh),
        earningsDate: typeof r.earningsDate === "string" ? r.earningsDate : null,
        name: r.name || r.symbol,
      });
    }
  }
  return m;
}

const groupBy = <T,>(arr: T[], key: (x: T) => string | undefined): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = key(x);
    if (!k) continue;
    (m.get(k) ?? m.set(k, []).get(k)!).push(x);
  }
  return m;
};

interface Rule { id: string; user_id: string; symbol: string | null; kind: string; params: any; created_at: string }
interface Ev { user_id: string; rule_id: string; symbol: string | null; kind: string; title: string; body: string | null; href: string | null; dedup_key: string }

async function main() {
  const DB = process.env.RESEARCH_DATABASE_URL;
  if (!DB) {
    console.log("RESEARCH_DATABASE_URL not set — skipping alert evaluation.");
    return;
  }
  const sql = postgres(DB, { max: 1, idle_timeout: 20, connect_timeout: 15, prepare: false });

  try {
    const rules = (await sql`select id, user_id, symbol, kind, params, created_at from alert_rules where active`) as unknown as Rule[];
    if (!rules.length) {
      console.log("No active alert rules.");
      return;
    }
    const wlRows = (await sql`select user_id, symbol from watchlist`) as unknown as { user_id: string; symbol: string }[];
    const watchOf = new Map<string, string[]>();
    for (const w of wlRows) (watchOf.get(w.user_id) ?? watchOf.set(w.user_id, []).get(w.user_id)!).push(w.symbol);

    const quotes = buildQuotes();
    const filingBy = groupBy<any>(loadJSON("overnight-filings.json")?.items ?? [], (f) => f.ticker);
    const campaignBy = groupBy<any>(loadJSON("campaigns.json")?.campaigns ?? [], (c) => c.ticker);
    const insiders = loadJSON("insiders.json")?.names ?? {};
    const valuation = loadJSON("valuation-history.json")?.names ?? {};
    const estimates = loadJSON("estimates.json")?.names ?? {};

    const events: Ev[] = [];
    const push = (r: Rule, symbol: string | null, dedup: string, title: string, body: string | null, href: string | null) =>
      events.push({ user_id: r.user_id, rule_id: r.id, symbol, kind: r.kind, title, body: body?.slice(0, 400) ?? null, href, dedup_key: `${r.id}:${dedup}` });
    const stockHref = (sym: string) => {
      const q = quotes.get(sym);
      return q ? `/u/${q.universe}/stock/${sym}` : null;
    };
    const createdMs = (r: Rule) => Date.parse(r.created_at) || 0;

    for (const r of rules) {
     try {
      const syms = r.symbol ? [r.symbol] : watchOf.get(r.user_id) ?? [];
      const p = r.params || {};

      for (const sym of syms) {
        if (r.kind === "price") {
          const q = quotes.get(sym);
          if (!q || q.price == null) continue;
          if (typeof p.above === "number" && q.price >= p.above)
            push(r, sym, `above:${p.above}`, `${sym} crossed above $${p.above}`, `Last $${q.price.toFixed(2)}.`, stockHref(sym));
          else if (typeof p.below === "number" && q.price <= p.below)
            push(r, sym, `below:${p.below}`, `${sym} crossed below $${p.below}`, `Last $${q.price.toFixed(2)}.`, stockHref(sym));
          else if (typeof p.pct === "number" && q.ret1d != null && Math.abs(q.ret1d) >= p.pct)
            push(r, sym, `pct:${p.pct}:${today}`, `${sym} moved ${q.ret1d >= 0 ? "+" : ""}${q.ret1d.toFixed(1)}% today`, `Your ±${p.pct}% threshold.`, stockHref(sym));
        } else if (r.kind === "earnings") {
          const q = quotes.get(sym);
          if (!q?.earningsDate) continue;
          const days = (Date.parse(q.earningsDate) - Date.now()) / DAY;
          const before = Number(p.daysBefore ?? 3);
          if (days >= 0 && days <= before)
            push(r, sym, `earn:${q.earningsDate}`, `${sym} reports in ${Math.max(0, Math.round(days))}d`, `Next earnings ${q.earningsDate}.`, stockHref(sym));
        } else if (r.kind === "event") {
          const types: string[] = Array.isArray(p.types) ? p.types : ["filing", "campaign", "insider"];
          const after = createdMs(r);
          if (types.includes("filing"))
            for (const f of filingBy.get(sym) ?? []) {
              if ((Date.parse(f.filedAt) || 0) < after) continue; // only events after the rule was made
              push(r, sym, `filing:${f.accession}`, `${sym}: ${f.form} filed`, f.headline || f.whatChanged || null, f.url || stockHref(sym));
            }
          if (types.includes("campaign"))
            for (const c of campaignBy.get(sym) ?? []) {
              if ((Date.parse(c.date) || 0) < after) continue;
              push(r, sym, `camp:${c.id}`, `${sym}: ${c.type || "activist campaign"}`, c.summary || c.ask || null, c.url || stockHref(sym));
            }
          if (types.includes("insider")) {
            const ins = insiders[sym];
            if (ins?.clusterBuy || ins?.buyers >= 3) push(r, sym, `insider:${ins.asOf || today}`, `${sym}: insider cluster buying`, ins.summary || null, stockHref(sym));
          }
        } else if (r.kind === "signal") {
          if (p.signal === "cheap10y") {
            const v = valuation[sym];
            const cheap = v && (v.eligible ?? []).find((k: string) => (v.multiples?.[k]?.z ?? 0) <= -1);
            if (cheap) push(r, sym, `sig:cheap10y`, `${sym} cheap vs its 10yr history`, `${cheap.toUpperCase()} ${v.multiples[cheap].discountPct}% vs median (z ${v.multiples[cheap].z}).`, stockHref(sym));
          } else if (p.signal === "short_squeeze") {
            const e = estimates[sym];
            if (e && num(e.shortPctFloat) != null && e.shortPctFloat >= 0.1 && (e.daysToCover ?? 0) >= 5)
              push(r, sym, `sig:squeeze`, `${sym} short-squeeze setup`, `${(e.shortPctFloat * 100).toFixed(1)}% of float short, ${e.daysToCover?.toFixed(1)}d to cover.`, stockHref(sym));
          } else if (p.signal === "rs_breakout") {
            const q = quotes.get(sym);
            if (q && q.pctFromHigh != null && q.pctFromHigh >= -2 && (q.ret3m ?? 0) >= 10)
              push(r, sym, `sig:rsb:${today}`, `${sym} breaking out`, `Within ${Math.abs(q.pctFromHigh).toFixed(1)}% of its 52-wk high, +${q.ret3m!.toFixed(0)}% in 3mo.`, stockHref(sym));
          }
        }
      }
     } catch (e: any) {
       console.warn(`rule ${r.id} skipped: ${String(e?.message || e).slice(0, 120)}`);
     }
    }

    console.log(`evaluated ${rules.length} rules → ${events.length} candidate events`);
    if (events.length) {
      const inserted = await sql`insert into alert_events ${sql(events, "user_id", "rule_id", "symbol", "kind", "title", "body", "href", "dedup_key")} on conflict (user_id, dedup_key) do nothing returning id`;
      console.log(`inserted ${inserted.length} new alerts (rest were duplicates).`);
    }
  } catch (e: any) {
    console.error("alert eval failed:", String(e?.message || e).slice(0, 300));
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
