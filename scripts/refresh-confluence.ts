/**
 * Confluence Engine refresh — fuses the app's INDEPENDENT bullish signals (cheap-vs-own-history,
 * super-investor 13F adds, Congress buys, analyst upgrades, call-heavy options flow, catalysts)
 * and ranks the names where several agree. GLM writes a thesis / risk / what-to-watch for the
 * top names. Decision-support only — no buy/sell/hold. Runs in the nightly FULL rebuild AFTER
 * refresh-data / refresh-valuation-history / refresh-13f / refresh-congress / refresh-flow /
 * refresh-catalysts (it reads their artifacts).
 *   npm run refresh-confluence
 */
import { promises as fs } from "fs";
import path from "path";
import { loadSnapshot } from "../lib/data";
import { loadValuationHistory } from "../lib/valuationHistory";
import { loadSuperInvestors } from "../lib/superinvestors";
import { loadCongress } from "../lib/congress";
import { loadCatalysts } from "../lib/catalysts";
import { getAnalystActions } from "../lib/analystActions";
import { getOptionsFlow } from "../lib/optionsFlow";
import { chatJSON, NO_ADVICE, llmConfigured, PRO_MODEL } from "../lib/llm";
import type { ConfluenceData, ConfluenceName, ConfluenceSignal, ConfluenceRead, SignalKind } from "../lib/confluence";
import { SIGNAL_ORDER } from "../lib/confluence";

const DATA = path.join(process.cwd(), "data");
const UNIVERSE = "russell3000"; // broadest US context snapshot (2.5k names ≈ the valuation set)
const BOARD_MAX = 60; // names kept on the board
const TOP_EXPLAIN = 16; // names GLM writes up (cost/quality control)

const MULT_LABEL: Record<string, string> = { pe: "P/E", evEbitda: "EV/EBITDA", ps: "P/S", pb: "P/B" };
const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round(v / 1e3)}K`);
const pct = (v: number | null | undefined, d = 0) => (v == null ? "?" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);

async function main() {
  const [snap, vh, si, cong, cats] = await Promise.all([
    loadSnapshot(UNIVERSE).catch(() => null),
    loadValuationHistory().catch(() => null),
    loadSuperInvestors().catch(() => null),
    loadCongress().catch(() => null),
    loadCatalysts().catch(() => ({} as Record<string, { why?: string }>)),
  ]);
  const flow = getOptionsFlow(); // synchronous
  const analyst = await getAnalystActions("sp500").catch(() => [] as any[]);
  // per-name companyStats snapshot (estimates + short interest) and the Form 4 buy scan
  const estimates = await fs.readFile(path.join(DATA, "estimates.json"), "utf8").then((s) => JSON.parse(s)).catch(() => null);
  const insiders = await fs.readFile(path.join(DATA, "insiders.json"), "utf8").then((s) => JSON.parse(s)).catch(() => null);

  // ── accumulate signals per ticker ──────────────────────────────────────────
  const sig = new Map<string, ConfluenceSignal[]>();
  const add = (sym: string, s: ConfluenceSignal) => {
    if (!sym) return;
    const a = sig.get(sym) || [];
    if (a.some((x) => x.kind === s.kind)) return; // one per kind
    a.push(s);
    sig.set(sym, a);
  };

  // 1) VALUE — cheap vs its own 10yr history (primary multiple, z ≤ −1 and ≥10% below median)
  for (const [sym, n] of Object.entries(vh?.names || {})) {
    const mk = n.eligible?.[0];
    const st = mk ? n.multiples?.[mk] : undefined;
    if (!mk || !st || st.z == null) continue;
    if (st.z <= -1 && st.discountPct <= -10) {
      add(sym, {
        kind: "value",
        label: "Cheap vs 10yr",
        detail: `${MULT_LABEL[mk] || mk} ${st.current.toFixed(1)} vs 10yr median ${st.median.toFixed(1)} (z ${st.z.toFixed(1)}, ${pct(st.discountPct)})`,
        weight: 2 + (st.z <= -1.5 ? 0.5 : 0),
      });
    }
  }

  // 2) SMART MONEY — super-investor 13F initiations / adds last quarter
  const adders = new Map<string, { mgrs: Set<string>; acts: string[] }>();
  const pushAdd = (ticker: string | null, mgr: string, act: string) => {
    if (!ticker) return;
    const e = adders.get(ticker) || { mgrs: new Set<string>(), acts: [] };
    e.mgrs.add(mgr);
    e.acts.push(act);
    adders.set(ticker, e);
  };
  for (const inv of si?.investors || []) {
    for (const b of inv.newBuys || []) pushAdd(b.ticker, inv.manager, `${inv.manager} initiated`);
    for (const a of inv.topAdds || []) pushAdd(a.ticker, inv.manager, `${inv.manager} added${a.deltaPct ? ` +${Math.round(a.deltaPct)}%` : ""}`);
  }
  for (const [sym, e] of adders) {
    add(sym, {
      kind: "smartmoney",
      label: e.mgrs.size > 1 ? `${e.mgrs.size} super-investors` : "Super-investor",
      detail: e.acts.slice(0, 3).join("; "),
      weight: 2 + (e.mgrs.size >= 2 ? 0.5 : 0),
    });
  }

  // 3) CONGRESS — net buyers over the last ~150 days (≥2 buys, buys > sells)
  const cbuy = new Map<string, { buys: number; sells: number; members: Set<string> }>();
  const cutoff = Date.now() - 150 * 86_400_000;
  for (const tr of cong?.trades || []) {
    if (!tr.ticker || Date.parse(tr.txDate) < cutoff) continue;
    const e = cbuy.get(tr.ticker) || { buys: 0, sells: 0, members: new Set<string>() };
    if (tr.type === "buy") e.buys++;
    else if (tr.type === "sell") e.sells++;
    e.members.add(tr.member);
    cbuy.set(tr.ticker, e);
  }
  for (const [sym, e] of cbuy) {
    if (e.buys >= 2 && e.buys > e.sells) {
      add(sym, { kind: "congress", label: "Congress buying", detail: `${e.buys} buys vs ${e.sells} sells · ${e.members.size} member${e.members.size > 1 ? "s" : ""} (150d)`, weight: 1.5 });
    }
  }

  // 4) ANALYST — a recent upgrade (large-cap coverage via the S&P 500 ratings feed)
  for (const a of analyst as any[]) {
    if (a?.action === "up") add(a.symbol, { kind: "analyst", label: "Upgraded", detail: `${a.fromGrade || "?"}→${a.toGrade || "?"} (${a.firm || "broker"})`, weight: 1 });
  }

  // 5) OPTIONS — unusually call-heavy flow (calls > 2× puts, ≥ $250k call premium)
  const opt = new Map<string, { call: number; put: number }>();
  for (const e of (flow?.entries || []).filter((x: any) => x.unusual)) {
    const a = opt.get(e.symbol) || { call: 0, put: 0 };
    if (e.type === "call") a.call += e.premium;
    else a.put += e.premium;
    opt.set(e.symbol, a);
  }
  for (const [sym, a] of opt) {
    if (a.call > a.put * 2 && a.call >= 250_000) {
      add(sym, { kind: "options", label: "Call-heavy flow", detail: `${money(a.call)} call premium vs ${money(a.put)} puts`, weight: 1 });
    }
  }

  // 6) CATALYST — a near-term catalyst on file (soft signal; the LLM judges direction)
  for (const [sym, c] of Object.entries(cats || {})) {
    if (c?.why) add(sym, { kind: "catalyst", label: "Catalyst", detail: c.why.slice(0, 120), weight: 0.5 });
  }

  // 7) REVISIONS — the Street quietly raising current-year EPS (90d drift ≥ +3% or strong net-up breadth)
  for (const [sym, es] of Object.entries((estimates?.names || {}) as Record<string, any>)) {
    const now = es?.cyNow, p90 = es?.cy90d;
    const drift = now != null && p90 != null && Math.abs(p90) >= 0.1 ? ((now - p90) / Math.abs(p90)) * 100 : null;
    const net = (es?.up30d ?? 0) - (es?.down30d ?? 0);
    if ((drift != null && drift >= 3) || net >= 6) {
      add(sym, { kind: "revisions", label: "Estimates rising", detail: `FY EPS ${drift != null ? pct(drift) : "?"} over 90d · ${es?.up30d ?? 0} up / ${es?.down30d ?? 0} down (30d)`, weight: 1.5 });
    }
  }

  // 8) INSIDER — open-market Form 4 buys (cluster = several distinct insiders, higher conviction)
  for (const [sym, nb] of Object.entries((insiders?.names || {}) as Record<string, any>)) {
    const buyers = nb?.buyers ?? 0;
    if (buyers >= 1) {
      add(sym, { kind: "insider", label: buyers > 1 ? `${buyers} insiders buying` : "Insider buying", detail: `${nb?.totalValue != null ? money(nb.totalValue) : "shares"} bought by ${buyers} insider${buyers > 1 ? "s" : ""}, latest ${nb?.lastBuy}`, weight: 2 + (buyers >= 2 ? 0.5 : 0) });
    }
  }

  // 9) SQUEEZE — a crowded short (≥10% of float) = fuel IF the stacked bull signals play out (contrarian amplifier)
  for (const [sym, es] of Object.entries((estimates?.names || {}) as Record<string, any>)) {
    const pf = es?.shortPctFloat;
    if (pf != null && pf >= 0.1) {
      add(sym, { kind: "squeeze", label: "Squeeze fuel", detail: `${(pf * 100).toFixed(0)}% of float short${es?.daysToCover ? `, ${es.daysToCover.toFixed(1)}d to cover` : ""}`, weight: 1 });
    }
  }

  // ── build the ranked board (require ≥2 distinct signal kinds = real confluence) ──
  const ctx = new Map((snap?.stocks || []).map((s) => [s.symbol, s] as const));
  const names: ConfluenceName[] = [];
  for (const [sym, signals] of sig) {
    const kinds = SIGNAL_ORDER.filter((k) => signals.some((s) => s.kind === k));
    if (kinds.length < 2) continue;
    const c = ctx.get(sym);
    const score = signals.reduce((n, s) => n + s.weight, 0);
    names.push({
      symbol: sym,
      name: c?.name || sym,
      sector: c?.sector || null,
      marketCap: c?.marketCap ?? null,
      price: c?.price ?? null,
      ret1w: c?.returns?.["1w"] ?? null,
      ret3m: c?.returns?.["3m"] ?? null,
      retYtd: c?.returns?.["ytd"] ?? null,
      pctFromHigh: c?.pctFromHigh ?? null,
      score: Math.round(score * 10) / 10,
      kinds,
      signals: signals.sort((a, b) => SIGNAL_ORDER.indexOf(a.kind) - SIGNAL_ORDER.indexOf(b.kind)),
      read: null,
    });
  }
  names.sort((a, b) => b.score - a.score || b.kinds.length - a.kinds.length || (b.marketCap ?? 0) - (a.marketCap ?? 0));
  const board = names.slice(0, BOARD_MAX);

  if (!board.length) {
    console.log("confluence: no multi-signal names found — skipping write.");
    return;
  }

  // ── GLM writes a thesis / risk / watch for the top names ──
  if (await llmConfigured()) {
    const toExplain = board.slice(0, TOP_EXPLAIN);
    const SYSTEM =
      "You are a senior buy-side analyst. Each name below carries SEVERAL INDEPENDENT bullish signals that happen to agree (value, smart-money 13F buying, open-market insider buying, Congress buying, rising analyst EPS estimates, an analyst upgrade, call-heavy options flow, a crowded short = squeeze potential, a catalyst). For each name write the SECOND LAYER: (thesis) the bull case these signals TOGETHER imply and the mechanism that ties them — not a restatement of the chips; (risk) the strongest bear case or what would make this a value trap / a head-fake; (watch) the concrete thing that would confirm or refute the setup (an earnings print, a guide, a deal close, follow-through buying). " +
      "Ground every claim in the supplied signals + context — never invent a number or a reason. Two to three crisp sentences total across the three fields each. Be specific to the company, not generic. " +
      NO_ADVICE;
    const SCHEMA = 'Return ONLY JSON: {"reads":[{"symbol": string, "thesis": string, "risk": string, "watch": string}]}';
    const lines = toExplain.map((n) => {
      const c = `${n.symbol} (${n.name}) · ${n.sector || "?"} · ${n.marketCap ? money(n.marketCap) : "?"} · ${pct(n.retYtd)} YTD, ${pct(n.pctFromHigh)} vs 52w-high`;
      const s = n.signals.map((x) => `[${x.kind}] ${x.detail}`).join(" | ");
      return `${c}\n   signals: ${s}`;
    });
    const user = `${SCHEMA}\n\nNAMES (each with its stacked signals + context):\n${lines.join("\n")}`;
    // maxTokens must cover the model's reasoning AND the output for all ~16 names — Gemini's reasoning
    // tokens count against the cap, so a tight 6000 returned EMPTY (the whole budget went to thinking).
    // Cap the reasoning (effort low) and give ample output room.
    const out = await chatJSON<{ reads: (ConfluenceRead & { symbol: string })[] }>(SYSTEM, user, { maxTokens: 16000, model: PRO_MODEL, reasoningEffort: "low" });
    const bySym = new Map((out?.reads || []).filter((r) => r?.symbol).map((r) => [String(r.symbol).toUpperCase(), r] as const));
    for (const n of board) {
      const r = bySym.get(n.symbol.toUpperCase());
      if (r && (r.thesis || r.risk || r.watch)) n.read = { thesis: (r.thesis || "").trim(), risk: (r.risk || "").trim(), watch: (r.watch || "").trim() };
    }
  } else {
    console.warn("confluence: OPENROUTER_API_KEY not set — writing board without write-ups.");
  }

  const counts = SIGNAL_ORDER.reduce((acc, k) => { acc[k] = board.filter((n) => n.kinds.includes(k)).length; return acc; }, {} as Record<SignalKind, number>);
  const data: ConfluenceData = {
    generatedAt: new Date().toISOString(),
    universe: UNIVERSE,
    asOf: snap?.generatedAt || null,
    names: board,
    counts,
  };
  await fs.writeFile(path.join(DATA, "confluence.json"), JSON.stringify(data));
  const explained = board.filter((n) => n.read).length;
  console.log(`confluence: wrote ${board.length} names (${explained} explained) · signal coverage ${JSON.stringify(counts)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
