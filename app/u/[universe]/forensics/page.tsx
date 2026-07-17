import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import type { ForensicsData } from "@/lib/forensics";
import ForensicsView from "@/components/ForensicsView";
import EmptyState from "@/components/EmptyState";
import UsOnlyNotice from "@/components/UsOnlyNotice";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// lib/forensics stays fs-free (the client view imports its types), so the loader lives here.
const loadForensics = (): Promise<ForensicsData | null> =>
  fs.readFile(path.join(process.cwd(), "data", "forensics.json"), "utf8").then((s) => JSON.parse(s) as ForensicsData).catch(() => null);

// Fundamental-forensics board — earnings-quality red flags from the US SEC fundamentals panel. The
// current universe's snapshot supplies the known-symbol set so a ticker links only when it lives here.
export default async function ForensicsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international)
    return <UsOnlyNotice universe={universe} label="Forensics & Quality" relPath="/forensics" dataNote="This board reads US SEC XBRL filings (Beneish/Altman/Piotroski/Sloan on US filers)" />;

  const [data, snapshot] = await Promise.all([loadForensics(), loadSnapshot(universe)]);
  if (!data || !data.rows.length) return <EmptyState universe={universe} title="Forensics & Quality" note="The board builds on the next nightly run." />;
  const known = snapshot?.stocks.map((s) => s.symbol) ?? [];
  return <ForensicsView universe={universe} data={data} known={known} />;
}
