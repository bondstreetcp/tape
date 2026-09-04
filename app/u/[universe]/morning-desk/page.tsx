import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import Link from "next/link";
import { loadDeskNote } from "@/lib/deskNote";
import { loadSnapshot } from "@/lib/data";
import { loadOvernightFilings } from "@/lib/overnightFilings";
import { loadCallDigests } from "@/lib/callDigests";
import type { FilingIndex, RelatedFiling } from "@/lib/filingIndex";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import DeskNote from "@/components/DeskNote";
import Briefing from "@/components/Briefing";
import DailyDeskTabs from "@/components/DailyDeskTabs";
import OvernightFilingsView from "@/components/OvernightFilingsView";
import CallDigestsView from "@/components/CallDigestsView";
import WatchlistWire from "@/components/WatchlistWire";
import { getMarketHeadlines } from "@/lib/marketHeadlinesFetch";
import MarketHeadlinesWire from "@/components/MarketHeadlinesWire";

export const dynamic = "force-dynamic";

// Related-filings lists from the semantic index — same read the standalone /overnight page does
// (vectors stay server-side; only the related lists cross to the client). Missing index → {}.
const loadRelated = async (): Promise<Record<string, RelatedFiling[]>> => {
  try {
    const idx = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "filing-index.json"), "utf8")) as FilingIndex;
    const m: Record<string, RelatedFiling[]> = {};
    for (const r of idx.rows) if (r.related?.length) m[r.accession] = r.related;
    return m;
  } catch { return {}; }
};

// Daily Desk — the morning workflow in one page, in reading order: the AI desk brief (movers +
// filings + options flow + analyst actions, fused; a pre-open morning run + a post-close evening
// run), the Reuters news wire, and Overnight Filings (the SuperAnalyst 8-K/10-Q/10-K desk notes —
// also standalone at /overnight; rendered here too because "what happened overnight" is THE
// wake-up question this page answers). Universe-independent data (US/S&P 500-keyed).
// ?tab=wire / ?tab=filings deep-link the tabs (old /briefing bookmarks land on wire).
export default async function DailyDeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ universe: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const { tab } = await searchParams;
  const [note, overnight, snapshot, related, headlines, calls] = await Promise.all([
    loadDeskNote(),
    loadOvernightFilings().catch(() => null),
    loadSnapshot(universe).catch(() => null),
    loadRelated(),
    getMarketHeadlines().catch(() => []),
    loadCallDigests().catch(() => null),
  ]);
  const known = snapshot?.stocks.map((s) => s.symbol) ?? [];
  const sectors: Record<string, string> = {};
  for (const s of snapshot?.stocks ?? []) if (s.sector) sectors[s.symbol] = s.sector;

  return (
    <main className="mx-auto max-w-[72rem] px-4 py-6 sm:px-6">
      <div className="mb-4">
        <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
        <h1 className="mt-1 text-2xl font-bold">Daily Desk</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-3)]">
          The morning read, in order — the AI <b>desk brief</b> (biggest moves, material SEC filings, unusual options flow, analyst actions; a pre-open <b>morning run</b> and a post-close <b>evening run</b> each weekday), the day&apos;s Reuters <b>news wire</b>, the <b>overnight filings</b> desk notes, and <b>yesterday&apos;s earnings calls</b> — every transcript from the last session, read in full and digested on the desk&apos;s local model. Research / decision-support, not investment advice.
        </p>
      </div>

      <DailyDeskTabs
        initial={tab}
        brief={
          note ? (
            <DeskNote note={note} universe={universe} />
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-16 text-center text-sm text-[var(--text-3)]">
              The desk note isn&apos;t built yet — it generates before the open (~8:45am ET) and after the close (~5:15pm ET) on weekdays.
            </div>
          )
        }
        wire={
          <>
            {/* Your watched names lead the wire — curated headlines + the code-anchored REPORTED
                fact per name (client component: the watchlist is client state). */}
            <WatchlistWire universe={universe} />
            <section>
              <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-[var(--divider)] pb-1.5">
                <h2 className="text-lg font-bold text-[var(--text)]">News wire</h2>
                <span className="text-[11px] text-[var(--text-4)]">Reuters Morning News Call · The Day Ahead</span>
              </div>
              <Briefing />
            </section>
          </>
        }
        headlines={
          <section>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--divider)] pb-1.5">
              <h2 className="text-lg font-bold text-[var(--text)]">Market headlines</h2>
              <span className="text-[11px] text-[var(--text-4)]">⚡ Walter Bloomberg flashes + reputable wire · ~5-min live</span>
            </div>
            <MarketHeadlinesWire initial={headlines} />
            <p className="mt-2 text-[11px] text-[var(--text-4)]"><span className="text-[var(--accent)]">⚡</span> = Walter Bloomberg&apos;s hand-curated flashes (his public Telegram — read as public content, no login/API/scraping); the rest is a reputable-source aggregate (Reuters, Bloomberg, CNBC, WSJ…) for what he didn&apos;t flag. Research, not advice.</p>
          </section>
        }
        filings={
          overnight ? (
            <OvernightFilingsView universe={universe} data={overnight} known={known} sectors={sectors} related={related} embedded />
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-16 text-center text-sm text-[var(--text-3)]">
              No overnight filings ingested yet — this fills on the nightly scan. The standalone board lives at{" "}
              <Link href={`/u/${universe}/overnight`} className="text-[var(--accent)] hover:underline">Overnight Filings</Link>.
            </div>
          )
        }
        calls={
          calls ? (
            <CallDigestsView universe={universe} data={calls} />
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-16 text-center text-sm text-[var(--text-3)]">
              No earnings-call digests yet — the first run happens on the next desk tick (08:00 / 17:00 ET) or the nightly rebuild.
            </div>
          )
        }
      />
    </main>
  );
}
