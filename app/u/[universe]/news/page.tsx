import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import NewsTapeView, { type TapeResponse } from "@/components/NewsTapeView";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import { summariseTape, type TapeItem } from "@/lib/newsTape";

/**
 * Market News Tape.
 *
 * The page is a THIN SHELL on purpose. Everything live comes from /api/news-tape, which the client
 * polls; the server render exists only so the first paint has rows instead of a spinner. Hence the
 * long revalidate — an ISR window on the tape itself would pin a stale render for its full duration,
 * which for a news feed is the one unacceptable failure.
 */
export const revalidate = 300;
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

const FIRST_PAINT = 200;

async function loadInitial(): Promise<TapeResponse | null> {
  const raw = await fs
    .readFile(path.join(process.cwd(), "data", "news-tape.json"), "utf8")
    .then((s) => JSON.parse(s) as { generatedAt: string; latencyNote?: string; items: TapeItem[] })
    .catch(() => null);
  if (!raw?.items?.length) return null;
  // Mirror the API's default view (promo excluded) so the first paint doesn't visibly reshuffle when
  // the first poll lands.
  const items = raw.items.filter((i) => i.kind !== "promo");
  return {
    generatedAt: raw.generatedAt,
    latencyNote: raw.latencyNote ?? null,
    archiveTotal: raw.items.length,
    matched: items.length,
    ...summariseTape(items, Date.now()),
    items: items.slice(0, FIRST_PAINT),
  };
}

export default async function NewsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  // The wires are SEC EDGAR plus the US press-release services, and the ticker index is SEC's
  // registrant list — so the tape is US-listed by construction, and the international universes get
  // the same honest notice the other US-only boards give rather than a silently empty table.
  if (UNIVERSE_BY_ID[universe].international)
    return (
      <UsOnlyNotice
        universe={universe}
        label="Market News Tape"
        relPath="/news"
        dataNote="The wires are SEC EDGAR and the US press-release services, tagged against SEC's registrant list"
      />
    );

  return <NewsTapeView universe={universe} initial={await loadInitial()} />;
}
