import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { loadSnapshot } from "@/lib/data";
import { getNews, pickHeadlines } from "@/lib/news";
import { detectRecentReport, detectPreannounce } from "@/lib/preannounce";
import { loadCatalystOverlay, type CatalystFlag } from "@/lib/catalystOverlay";
import { loadOvernightFilings } from "@/lib/overnightFilings";
import { readCompanyCache } from "@/lib/companyCache";
import { getBorrow } from "@/lib/borrow";
import { pool } from "@/lib/edgar";
import { memo } from "@/lib/memoCache";
import { daysUntil } from "@/lib/calendar";
import { normalizeSyms } from "@/lib/watchlistWire";
import { sortEvents, orderNames, shortsEvent, borrowEvent, estimateEvent, flowEvent, type LedgerData, type LedgerEvent, type LedgerName } from "@/lib/myNamesLedger";
import type { Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// My Names — Change Ledger (P1, docs/SPEC-MY-NAMES-MONITOR.md). The client sends its watched
// symbols (client state); this route joins each against feeds that ALREADY exist and returns the
// typed event list. Pure joins — no LLM anywhere in this path; every event carries a deep link to
// its source. Per-name degradation throughout: one dead feed or vendor costs its events only.

const DAY = 86_400_000;

async function broadUs(): Promise<Snapshot | null> {
  for (const u of ["russell3000", "broad1500", "russell1000", "sp1500", "sp500"]) {
    const s = await loadSnapshot(u).catch(() => null);
    if (s?.stocks?.length) return s;
  }
  return null;
}

const readJson = async <T,>(name: string): Promise<T | null> => {
  try { return JSON.parse(await fs.readFile(path.join(process.cwd(), "data", name), "utf8")) as T; }
  catch { return null; }
};

const catKind = (k: CatalystFlag["kind"]): { kind: "deal" | "review" | "spin"; title: string } =>
  k === "acquisition" ? { kind: "deal", title: "Under agreement to be acquired" }
  : k === "spin-off" ? { kind: "spin", title: "Spin-off in motion" }
  : { kind: "review", title: "Strategic alternatives live" };

export async function GET(req: Request) {
  const syms = normalizeSyms(new URL(req.url).searchParams.get("syms") ?? "");
  if (!syms.length) return NextResponse.json({ generatedAt: new Date().toISOString(), names: [] } satisfies LedgerData, { headers: { "Cache-Control": "no-store" } });

  const key = `mnl:${[...syms].sort().join(",")}`;
  const data = await memo(
    key,
    600_000,
    async (): Promise<LedgerData> => {
      const now = Date.now();
      // Shared feeds load ONCE per request, not per name.
      const [snap, overlay, overnight, insiders, shorts, flow, emove] = await Promise.all([
        broadUs(),
        loadCatalystOverlay().catch(() => null),
        loadOvernightFilings().catch(() => null),
        readJson<{ names?: Record<string, { buyers: number; transactions: number; totalValue: number; lastBuy: string }> }>("insiders.json"),
        readJson<{ rows?: { symbol: string; latestShortVolPct?: number; ftdUsd?: number }[] }>("short-mechanics.json"),
        readJson<{ entries?: { symbol: string; type?: string; strike?: number; expiry?: string; premium?: number }[] }>("options-flow.json"),
        readJson<{ rows?: { symbol: string; impliedMovePct?: number | null }[] }>("earnings-move.json"),
      ]);
      const bySym = new Map((snap?.stocks ?? []).map((s) => [s.symbol, s]));
      const shortsBy = new Map((shorts?.rows ?? []).map((r) => [r.symbol, r]));
      const impliedBy = new Map((emove?.rows ?? []).map((r) => [r.symbol, r.impliedMovePct ?? null]));
      const flowBy = new Map<string, NonNullable<typeof flow>["entries"]>();
      for (const e of flow?.entries ?? []) {
        if (!flowBy.has(e.symbol)) flowBy.set(e.symbol, []);
        flowBy.get(e.symbol)!.push(e);
      }

      const names = await pool(syms, 6, async (sym): Promise<LedgerName> => {
        const row = bySym.get(sym);
        const events: LedgerEvent[] = [];
        const earnISO = row?.earningsDate ?? null;

        // Live per-name facts, each independently bounded/degrading.
        const [reported, news, borrow, cache] = await Promise.all([
          detectRecentReport(sym, now).catch(() => null),
          getNews(row?.name || sym, 30).catch(() => []),
          getBorrow(sym).catch(() => null),
          readCompanyCache(sym).catch(() => null), // cache-only — never a live fallback for a 40-name loop
        ]);

        if (reported) {
          events.push({ kind: "reported", ts: reported.date, title: `Reported earnings ${reported.daysAgo === 0 ? "today" : reported.daysAgo === 1 ? "yesterday" : `${reported.daysAgo}d ago`}`, detail: "Results 8-K (Item 2.02) on record", href: `/stock/${sym}` });
        }
        const flag = overlay?.flagFor(sym) ?? null;
        if (flag) {
          const c = catKind(flag.kind);
          events.push({ kind: c.kind, ts: flag.date, title: c.title, detail: flag.headline, href: c.kind === "deal" ? "/merger-arb" : "/corp-events" });
        } else if (!reported && earnISO && (daysUntil(earnISO.slice(0, 10)) ?? 99) <= 35) {
          // No overlay flag AND no print on record → check for a preannouncement ahead of the
          // scheduled print. (Once a results 8-K exists, `reported` covers it — a stale snapshot's
          // past earningsDate otherwise double-reports the same filing as a "preannouncement".)
          const pre = await detectPreannounce(sym, earnISO).catch(() => null);
          if (pre) events.push({ kind: "preannounce", ts: pre.date, title: "Preannounced ahead of the print", detail: pre.headline, href: `/stock/${sym}` });
        }
        const dte = earnISO ? daysUntil(earnISO.slice(0, 10)) : null;
        if (dte != null && dte >= 0 && dte <= 5 && !reported) {
          const imp = impliedBy.get(sym);
          events.push({ kind: "earnings-ahead", ts: earnISO!.slice(0, 10), title: dte === 0 ? "Reports today" : `Reports in ${dte}d`, detail: imp != null ? `options price ±${imp.toFixed(1)}%` : undefined, href: `/stock/${sym}` });
        }
        for (const it of overnight?.items ?? []) {
          if (it.ticker === sym) events.push({ kind: "filing", ts: it.filedAt, title: `${it.form}: ${it.headline ?? "new filing"}`.slice(0, 140), href: it.url });
        }
        const ins = insiders?.names?.[sym];
        if (ins && now - Date.parse(ins.lastBuy) <= 30 * DAY) {
          events.push({ kind: "insider", ts: ins.lastBuy, title: "Insider cluster buying", detail: `${ins.buyers} buyer${ins.buyers !== 1 ? "s" : ""} · ${ins.transactions} buys · $${Math.round(ins.totalValue / 1000)}K`, href: "/insiders" });
        }
        const sh = shortsEvent(shortsBy.get(sym));
        if (sh) events.push({ kind: "shorts", ts: shorts?.rows ? new Date(now).toISOString().slice(0, 10) : "", ...sh, href: "/short-mechanics" });
        const br = borrowEvent(borrow);
        if (br) events.push({ kind: "borrow", ts: new Date(now).toISOString().slice(0, 10), ...br, href: `/stock/${sym}` });
        const q0 = cache?.stats?.estimates?.find((e: { period?: string }) => e.period === "0q") ?? cache?.stats?.estimates?.[0];
        const est = estimateEvent(q0);
        if (est) events.push({ kind: "estimate", ts: new Date(now).toISOString().slice(0, 10), ...est, href: "/revisions" });
        const fl = flowEvent(flowBy.get(sym) ?? []);
        if (fl) events.push({ kind: "options", ts: flow?.entries ? new Date(now).toISOString().slice(0, 10) : "", ...fl, href: "/options-flow" });
        for (const h of pickHeadlines(news, { nowMs: now, windowDays: 3, limit: 3 })) {
          const src = news.find((n) => n.title === h.title);
          events.push({ kind: "headline", ts: h.date, title: h.title, detail: src?.publisher, href: src?.link ?? undefined });
        }

        return { symbol: sym, name: row?.name ?? null, pct1d: row?.returns?.["1d"] ?? null, events: sortEvents(events) };
      });

      return { generatedAt: new Date().toISOString(), names: orderNames(names.filter(Boolean)) };
    },
    { cacheIf: (v) => v.names.length > 0 },
  );

  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
