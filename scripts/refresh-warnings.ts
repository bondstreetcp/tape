/**
 * Warning Signs refresh — the BEARISH twin of the Confluence Engine. Fuses the app's INDEPENDENT
 * negative signals (rich-vs-own-history, EPS estimate CUTS, super-investor EXITS/trims, a guidance cut,
 * a sell-side downgrade, put-heavy options flow) and ranks the names where several agree — the value-trap
 * / short-candidate flags. GLM writes the bear case / what would invalidate it / what to watch for the
 * top names. Decision-support only. Runs in the nightly FULL rebuild AFTER the feeds it reads.
 *   npm run refresh-warnings
 */
import { promises as fs } from "fs";
import path from "path";
import { loadSnapshot } from "../lib/data";
import { loadValuationHistory } from "../lib/valuationHistory";
import { loadSuperInvestors } from "../lib/superinvestors";
import { buildSmartMoneySell } from "../lib/smartMoneySell";
import { getAnalystActions } from "../lib/analystActions";
import { getOptionsFlow } from "../lib/optionsFlow";
import { chatJSON, NO_ADVICE, llmConfigured, PRO_MODEL } from "../lib/llm";
import type { WarningsData, WarningName, WarningSignal, WarningRead, WarningKind } from "../lib/warnings";
import { WARNING_ORDER } from "../lib/warnings";

const DATA = path.join(process.cwd(), "data");
const UNIVERSE = "russell3000";
const BOARD_MAX = 60;
const TOP_EXPLAIN = 16;
const MULT_LABEL: Record<string, string> = { pe: "P/E", evEbitda: "EV/EBITDA", ps: "P/S", pb: "P/B" };
const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round(v / 1e3)}K`);
const pct = (v: number | null | undefined, d = 0) => (v == null ? "?" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);

async function main() {
  const [snap, vh, si] = await Promise.all([loadSnapshot(UNIVERSE).catch(() => null), loadValuationHistory().catch(() => null), loadSuperInvestors().catch(() => null)]);
  const flow = getOptionsFlow();
  const analyst = await getAnalystActions("sp500").catch(() => [] as any[]);
  const estimates = await fs.readFile(path.join(DATA, "estimates.json"), "utf8").then((s) => JSON.parse(s)).catch(() => null);
  const guidance = await fs.readFile(path.join(DATA, "guidance-board.json"), "utf8").then((s) => JSON.parse(s)).catch(() => null);

  const sig = new Map<string, WarningSignal[]>();
  const add = (sym: string, s: WarningSignal) => {
    if (!sym) return;
    const a = sig.get(sym) || [];
    if (a.some((x) => x.kind === s.kind)) return; // one per kind
    a.push(s);
    sig.set(sym, a);
  };

  // 1) EXPENSIVE — rich vs its own 10yr history (primary multiple, z ≥ +1 and ≥10% above median)
  for (const [sym, n] of Object.entries((vh?.names || {}) as Record<string, any>)) {
    const mk = n.eligible?.[0];
    const st = mk ? n.multiples?.[mk] : undefined;
    if (!mk || !st || st.z == null) continue;
    if (st.z >= 1 && st.discountPct >= 10) {
      add(sym, { kind: "expensive", label: "Rich vs 10yr", detail: `${MULT_LABEL[mk] || mk} ${st.current.toFixed(1)} vs 10yr median ${st.median.toFixed(1)} (z +${st.z.toFixed(1)}, ${pct(st.discountPct)})`, weight: 2 + (st.z >= 1.5 ? 0.5 : 0) });
    }
  }

  // 2) ESTIMATE CUTS — the Street lowering current-year EPS (90d drift ≤ −3% or net-down breadth)
  for (const [sym, es] of Object.entries((estimates?.names || {}) as Record<string, any>)) {
    const now = es?.cyNow, p90 = es?.cy90d;
    const drift = now != null && p90 != null && Math.abs(p90) >= 0.1 ? ((now - p90) / Math.abs(p90)) * 100 : null;
    const net = (es?.up30d ?? 0) - (es?.down30d ?? 0);
    if ((drift != null && drift <= -3) || net <= -6) {
      add(sym, { kind: "estcuts", label: "Estimates falling", detail: `FY EPS ${drift != null ? pct(drift) : "?"} over 90d · ${es?.up30d ?? 0} up / ${es?.down30d ?? 0} down (30d)`, weight: 1.5 });
    }
  }

  // 3) SMART-MONEY EXIT — 2+ super-investors sold out / trimmed last quarter (reuse the distribution board)
  const ctx = new Map((snap?.stocks || []).map((s) => [s.symbol, s] as const));
  for (const d of buildSmartMoneySell(si, ctx)) {
    add(d.symbol, {
      kind: "distribution",
      label: d.exitedN >= 2 ? `${d.exitedN} exited` : "Super-investors selling",
      detail: `${d.exitedN} exited / ${d.trimmedN} trimmed — ${d.sellers.slice(0, 3).map((s) => s.manager).join(", ")}`,
      weight: 2 + (d.exitedN >= 3 ? 0.5 : 0),
    });
  }

  // 4) GUIDANCE CUT — management lowered its own forward outlook
  for (const r of (guidance?.rows || []) as any[]) {
    if (r?.symbol && r?.action === "cut") add(r.symbol, { kind: "guidancecut", label: "Guidance cut", detail: "Management cut its own forward outlook", weight: 2 });
  }

  // 5) DOWNGRADE — a recent sell-side downgrade (large-cap coverage via the S&P 500 ratings feed)
  for (const a of analyst as any[]) {
    if (a?.action === "down") add(a.symbol, { kind: "downgrade", label: "Downgraded", detail: `${a.fromGrade || "?"}→${a.toGrade || "?"} (${a.firm || "broker"})`, weight: 1 });
  }

  // 6) PUT-HEAVY FLOW — unusually put-heavy options flow (puts > 2× calls, ≥ $250k put premium)
  const opt = new Map<string, { call: number; put: number }>();
  for (const e of (flow?.entries || []).filter((x: any) => x.unusual)) {
    const a = opt.get(e.symbol) || { call: 0, put: 0 };
    if (e.type === "put") a.put += e.premium; else a.call += e.premium;
    opt.set(e.symbol, a);
  }
  for (const [sym, a] of opt) {
    if (a.put > a.call * 2 && a.put >= 250_000) add(sym, { kind: "putflow", label: "Put-heavy flow", detail: `${money(a.put)} put premium vs ${money(a.call)} calls`, weight: 1 });
  }

  // ── build the ranked board (require ≥2 distinct signal kinds) ──
  const names: WarningName[] = [];
  for (const [sym, signals] of sig) {
    const kinds = WARNING_ORDER.filter((k) => signals.some((s) => s.kind === k));
    if (kinds.length < 2) continue;
    const c = ctx.get(sym);
    const score = signals.reduce((n, s) => n + s.weight, 0);
    names.push({
      symbol: sym, name: c?.name || sym, sector: c?.sector || null, marketCap: c?.marketCap ?? null, price: c?.price ?? null,
      ret1w: c?.returns?.["1w"] ?? null, ret3m: c?.returns?.["3m"] ?? null, retYtd: c?.returns?.["ytd"] ?? null, pctFromHigh: c?.pctFromHigh ?? null,
      score: Math.round(score * 10) / 10, kinds, signals: signals.sort((a, b) => WARNING_ORDER.indexOf(a.kind) - WARNING_ORDER.indexOf(b.kind)), read: null,
    });
  }
  names.sort((a, b) => b.score - a.score || b.kinds.length - a.kinds.length || (b.marketCap ?? 0) - (a.marketCap ?? 0));
  const board = names.slice(0, BOARD_MAX);
  if (!board.length) { console.log("warnings: no multi-signal names found — skipping write."); return; }

  if (await llmConfigured()) {
    const toExplain = board.slice(0, TOP_EXPLAIN);
    const SYSTEM =
      "You are a skeptical short-side analyst. Each name below carries SEVERAL INDEPENDENT bearish signals that happen to agree (rich vs its own history, EPS estimates being cut, super-investor 13F selling, a guidance cut, an analyst downgrade, put-heavy flow). For each write: (thesis) the BEAR case these signals TOGETHER imply and the mechanism tying them — a name priced for perfection that informed money + the Street are abandoning, not a restatement of the chips; (risk) what would INVALIDATE the warning — the strongest reason it might be fine (a durable moat, a one-off, cheap on forward numbers); (watch) the concrete thing that would confirm or refute the warning (a guide, a print, follow-through selling). " +
      "Ground every claim in the supplied signals + context — never invent a number or a reason. Two to three crisp sentences total across the three fields. Be specific to the company, not generic. " + NO_ADVICE;
    const SCHEMA = 'Return ONLY JSON: {"reads":[{"symbol": string, "thesis": string, "risk": string, "watch": string}]}';
    const lines = toExplain.map((n) => {
      const c = `${n.symbol} (${n.name}) · ${n.sector || "?"} · ${n.marketCap ? money(n.marketCap) : "?"} · ${pct(n.retYtd)} YTD, ${pct(n.pctFromHigh)} vs 52w-high`;
      return `${c}\n   signals: ${n.signals.map((x) => `[${x.kind}] ${x.detail}`).join(" | ")}`;
    });
    const out = await chatJSON<{ reads: (WarningRead & { symbol: string })[] }>(SYSTEM, `${SCHEMA}\n\nNAMES (each with its stacked bear signals + context):\n${lines.join("\n")}`, { maxTokens: 16000, model: PRO_MODEL, reasoningEffort: "low" });
    const bySym = new Map((out?.reads || []).filter((r) => r?.symbol).map((r) => [String(r.symbol).toUpperCase(), r] as const));
    const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");
    for (const n of board) { const r = bySym.get(n.symbol.toUpperCase()); if (r && (r.thesis || r.risk || r.watch)) n.read = { thesis: str(r.thesis), risk: str(r.risk), watch: str(r.watch) }; }
  } else {
    console.warn("warnings: OPENROUTER_API_KEY not set — writing board without write-ups.");
  }

  const counts = WARNING_ORDER.reduce((acc, k) => { acc[k] = board.filter((n) => n.kinds.includes(k)).length; return acc; }, {} as Record<WarningKind, number>);
  const data: WarningsData = { generatedAt: new Date().toISOString(), universe: UNIVERSE, asOf: snap?.generatedAt || null, names: board, counts };
  await fs.writeFile(path.join(DATA, "warnings.json"), JSON.stringify(data));
  console.log(`warnings: wrote ${board.length} names (${board.filter((n) => n.read).length} explained) · signal coverage ${JSON.stringify(counts)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
