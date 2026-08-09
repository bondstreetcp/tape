import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildCatalystCalendar, type CatalystEvent } from "@/lib/catalystCalendar";
import type { SnapshotEarnings } from "@/lib/portfolioCatalysts";
import MyNamesLedger from "@/components/MyNamesLedger";
import MyNamesTabs from "@/components/MyNamesTabs";
import WatchlistView from "@/components/WatchlistView";
import PortfolioRadar from "@/components/PortfolioRadar";
import PushAlerts from "@/components/PushAlerts";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const read = async (name: string): Promise<any> => {
  try { return JSON.parse(await fs.readFile(path.join(process.cwd(), "data", name), "utf8")); }
  catch { return null; }
};

// My Names — the monitoring leg consolidated (docs/SPEC-MY-NAMES-MONITOR.md; UX pass #6): one
// destination with three tabs. LEDGER = what changed since you last looked (the P1 join). QUOTES =
// the watchlist table (also standalone at /watchlist). RADAR = forward catalysts on the union
// (also standalone at /portfolio-radar). The list itself is client state; this page assembles the
// server-side feeds each tab needs and the client components do their own joins.
export default async function MyNamesPage({
  params,
  searchParams,
}: {
  params: Promise<{ universe: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const { tab } = await searchParams;
  const intl = !!UNIVERSE_BY_ID[universe].international;

  const [snapshot, earnings, investorDays, biotech, lockups, r3k] = await Promise.all([
    loadSnapshot(universe),
    intl ? null : read("earnings-move.json"),
    intl ? null : read("catalyst-vol.json"),
    intl ? null : read("biotech-catalysts.json"),
    intl ? null : read("ipo-monitor.json"),
    intl ? null : loadSnapshot("russell3000").catch(() => null),
  ]);

  // Radar inputs — same assembly as /portfolio-radar (US catalyst feeds; the tab hides on intl).
  let radarEvents: CatalystEvent[] = [];
  const earningsDates: Record<string, SnapshotEarnings> = {};
  let radarGeneratedAt = new Date().toISOString();
  if (!intl) {
    const now = Date.now();
    radarEvents = buildCatalystCalendar({ earnings, investorDays, biotech, lockups }, now, { horizonDays: 120 });
    for (const s of r3k?.stocks ?? []) {
      if (!s.earningsDate) continue;
      const t = Date.parse(s.earningsDate);
      if (!Number.isFinite(t) || t < now - DAY || t > now + 120 * DAY) continue;
      earningsDates[s.symbol] = { date: new Date(t).toISOString().slice(0, 10), name: s.name, estimated: !!s.earningsEstimate };
    }
    radarGeneratedAt = earnings?.generatedAt ?? investorDays?.generatedAt ?? radarGeneratedAt;
  }

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-4">
        <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
        <h1 className="mt-1 text-2xl font-bold">My Names</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-3)]">
          Your book + watchlist, monitored — the <b>Ledger</b> shows everything that changed since you last looked (prints, deals, filings, insider clusters, borrow stress, revisions, flow, headlines), <b>Quotes</b> is the live table, and <b>Radar</b> puts every forward catalyst on one timeline. Star names anywhere on the site, or paste your book into <Link href={`/u/${universe}/portfolio`} className="text-[var(--accent)] hover:underline">Prism</Link>.
        </p>
      </div>

      <MyNamesTabs
        initial={tab}
        ledger={
          <>
            <MyNamesLedger universe={universe} />
            <PushAlerts />
          </>
        }
        quotes={
          snapshot && snapshot.stocks.length > 0 ? (
            <WatchlistView universe={universe} stocks={snapshot.stocks} generatedAt={snapshot.generatedAt} embedded />
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--text-3)]">No snapshot on this box yet.</div>
          )
        }
        radar={intl ? undefined : <PortfolioRadar universe={universe} events={radarEvents} earningsDates={earningsDates} generatedAt={radarGeneratedAt} embedded />}
      />
    </main>
  );
}
