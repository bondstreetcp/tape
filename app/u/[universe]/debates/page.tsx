import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import DebateLedgerView, { type DebatesFile } from "@/components/DebateLedgerView";
import EmptyState from "@/components/EmptyState";
import UsOnlyNotice from "@/components/UsOnlyNotice";

export const revalidate = 600; // ISR: the ledger is baked nightly; edge-cache the render
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// lib/debates stays fs-free (the client view imports its types), so the loader lives here.
const loadDebates = (): Promise<DebatesFile | null> =>
  fs.readFile(path.join(process.cwd(), "data", "debates.json"), "utf8").then((s) => JSON.parse(s) as DebatesFile).catch(() => null);

// Key Debates — a declared investment argument rendered as a dated bull/bear evidence ledger. The
// evidence is US SEC filings and US short-seller campaigns, and the rosters are US tickers, so the
// international universes get the same honest notice the other US-only boards give.
export default async function DebatesPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international)
    return <UsOnlyNotice universe={universe} label="Key Debates" relPath="/debates" dataNote="The evidence is US SEC filings and US short-seller campaigns" />;

  const data = await loadDebates();
  // A file with zero debates is "not built yet"; a file whose debates are all EMPTY is a legitimate
  // state (evidence accumulates forward from the day a debate opens) and must still render.
  if (!data || !data.debates?.length)
    return <EmptyState universe={universe} title="Key Debates" note="The ledger builds on the next nightly run." />;
  return <DebateLedgerView universe={universe} data={data} />;
}
