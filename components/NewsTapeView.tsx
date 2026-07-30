"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePolledFetch, fmtClock } from "@/lib/usePolledFetch";
import { useWatchlist } from "@/lib/watchlist";
import InfoDot from "@/components/InfoDot";
import type { TapeItem, TagMethod } from "@/lib/newsTape";

/**
 * The live news tape. One row per wire item, newest first, ticker-tagged where the tag can be
 * defended and blank where it cannot.
 *
 * Every row shows HOW it was tagged. That is the same commitment /debates makes by rendering the gate
 * that admitted each piece of evidence: a tag you cannot audit is a tag you cannot trust, and the
 * difference between "the filing's own CIK said so" and "the headline started with this company's
 * name" is exactly the difference a user needs to judge a row.
 */

const TAG_LABEL: Record<TagMethod, string> = {
  "edgar-cik": "from the filing's own CIK — exact",
  "wire-symbol": "the wire printed this ticker",
  "name-exact": "headline opens with the full registered name",
  "name-prefix": "headline opens with this company's name",
};
const TAG_SHORT: Record<TagMethod, string> = {
  "edgar-cik": "CIK", "wire-symbol": "wire", "name-exact": "name", "name-prefix": "name~",
};

const KINDS = [
  { id: "", label: "All" },
  { id: "filing", label: "Filings" },
  { id: "press", label: "Press" },
  { id: "macro", label: "Macro" },
] as const;

/** "3m ago" / "2h ago" — a tape is read by recency, so the age is the primary time signal. */
function ago(at: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

const clock = (at: string) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export interface TapeResponse {
  generatedAt: string | null;
  latencyNote?: string | null;
  archiveTotal?: number;
  matched?: number;
  total?: number;
  tagged?: number;
  taggedPct?: number;
  inLastHour?: number;
  byCategory?: Record<string, number>;
  items: TapeItem[];
}

export default function NewsTapeView({ universe, initial }: { universe: string; initial: TapeResponse | null }) {
  const [kind, setKind] = useState<string>("");
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [taggedOnly, setTaggedOnly] = useState(false);
  const [live, setLive] = useState(true);
  const { list: watchlist } = useWatchlist();

  const url = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", "200");
    if (kind) p.set("kinds", kind);
    if (q.trim()) p.set("q", q.trim());
    if (taggedOnly) p.set("taggedOnly", "1");
    // "My names" is a client-side toggle over a server filter so the archive does the work, not the
    // browser: with an empty watchlist we deliberately send nothing rather than an empty filter that
    // would silently match everything.
    if (mine && watchlist.length) p.set("symbols", watchlist.join(","));
    return `/api/news-tape?${p.toString()}`;
  }, [kind, q, mine, taggedOnly, watchlist]);

  // 60s poll. The endpoint reads a memoised file and the hook stops entirely while the tab is hidden;
  // both matter, because an always-on poller on a dynamic endpoint is what took the site down before.
  const { data, asOf, loading } = usePolledFetch(live, url, 60_000);
  const payload: TapeResponse | null = (data as TapeResponse) ?? initial;
  const items = payload?.items ?? [];
  const now = Date.now();

  const emptyMine = mine && watchlist.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Market News Tape</h1>
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          {payload?.archiveTotal != null && (
            <span>{payload.archiveTotal.toLocaleString()} archived</span>
          )}
          {payload?.inLastHour != null && <span>{payload.inLastHour} in the last hour</span>}
          <button
            onClick={() => setLive((v) => !v)}
            className={`rounded border px-2 py-0.5 ${live ? "border-emerald-600 text-emerald-600" : "border-neutral-400 text-neutral-500"}`}
            title={live ? "Polling every 60s while this tab is visible" : "Paused — click to resume"}
          >
            {live ? (loading ? "updating…" : "live") : "paused"}
          </button>
        </div>
      </div>

      <p className="mb-4 text-xs text-neutral-500">
        Company press releases and SEC filings as they hit the public wires, tagged to a ticker where
        the attribution can be defended.
        <InfoDot
          term="How fresh is this?"
          text={
            `${payload?.latencyNote ?? "Free public wires: EDGAR runs ~5 min behind, press wires ~10 min."} ` +
            "These are the free public feeds (SEC EDGAR, PR Newswire, GlobeNewswire), so the tape is " +
            "minutes behind, not seconds — a paid Reuters or Benzinga feed is what gets you sub-second. " +
            "What this has that they don't is the archive: the wires expose only their newest ~20 items " +
            "and forget the rest, so every row here is kept from the moment it was first seen."
          }
        />
        {asOf && <span className="ml-2 text-neutral-400">checked {fmtClock(asOf)}</span>}
      </p>

      {/* ── filters ─────────────────────────────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <div className="flex overflow-hidden rounded border border-neutral-300 dark:border-neutral-700">
          {KINDS.map((k) => (
            <button
              key={k.id}
              onClick={() => setKind(k.id)}
              className={`px-2.5 py-1 ${kind === k.id ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search headlines or ticker…"
          className="w-56 rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          My names
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={taggedOnly} onChange={(e) => setTaggedOnly(e.target.checked)} />
          Tagged only
        </label>
        {payload?.matched != null && (
          <span className="text-neutral-500">
            {payload.matched.toLocaleString()} match{payload.matched === 1 ? "" : "es"}
            {payload.taggedPct != null && ` · ${payload.taggedPct}% tagged`}
          </span>
        )}
      </div>

      {emptyMine && (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Your watchlist is empty, so &ldquo;My names&rdquo; has nothing to filter to. Add symbols from any
          stock page.
        </p>
      )}

      {/* ── the tape ────────────────────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded border border-neutral-200 dark:border-neutral-800">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-16" /><col className="w-20" /><col /><col className="w-32" />
          </colgroup>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-neutral-100 last:border-0 align-top hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/50">
                <td className="px-2 py-1.5 tabular-nums text-xs text-neutral-500" title={new Date(i.at).toLocaleString()}>
                  <div>{clock(i.at)}</div>
                  <div className="text-[10px] text-neutral-400">{ago(i.at, now)}</div>
                </td>
                <td className="px-2 py-1.5">
                  {i.symbol ? (
                    <Link
                      href={`/u/${universe}/stock/${i.symbol}`}
                      className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                      title={i.tagHow ? TAG_LABEL[i.tagHow] : undefined}
                    >
                      {i.symbol}
                    </Link>
                  ) : (
                    <span className="text-neutral-300 dark:text-neutral-700" title="No ticker could be established for this headline — see the note above.">—</span>
                  )}
                  {i.tagHow && (
                    <div className="text-[10px] text-neutral-400" title={TAG_LABEL[i.tagHow]}>
                      {TAG_SHORT[i.tagHow]}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <a href={i.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {i.headline}
                  </a>
                  {i.kind === "promo" && (
                    <span className="ml-1 rounded bg-neutral-200 px-1 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                      promo
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-xs text-neutral-500">
                  <div>{i.source}</div>
                  {i.category && <div className="truncate text-[10px] text-neutral-400" title={i.category}>{i.category}</div>}
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm text-neutral-500">
                  {payload ? "Nothing matches those filters." : "Loading the tape…"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-neutral-400">
        A blank ticker means we could not attribute the headline to a listed issuer with confidence —
        not that the story is unimportant. Wrong tickers are worse than missing ones, so the matcher
        refuses whenever a company name is ambiguous.
      </p>
    </div>
  );
}
