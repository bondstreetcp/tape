import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { loadSnapshot } from "@/lib/data";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import type { PrintPredictorFile } from "@/lib/printPredictor";
import PrintPredictorView from "@/components/PrintPredictorView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

function loadPredictor(): Promise<PrintPredictorFile | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "earnings-print-predictor.json"), "utf8")
    .then((s) => {
      const d = JSON.parse(s) as PrintPredictorFile;
      // Guard a prior-schema file kept across a deploy: a shape mismatch degrades to the no-feed
      // empty state rather than crashing the render.
      const ok = !!(d && d.oos?.beatMiss && d.oos?.reaction && d.models?.beatMiss && d.models?.reaction && d.baseRates && Array.isArray(d.method) && Array.isArray(d.live));
      return ok ? d : null;
    })
    .catch(() => null);
}

export default async function PrintPredictorPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  const meta = UNIVERSE_BY_ID[universe];
  if (!meta) notFound();
  if (meta.international) return <UsOnlyNotice universe={universe} label="Earnings Print Predictor" relPath="/print-predictor" />;

  const data = await loadPredictor();
  // Scope the live predictions to THIS universe's members (the track-record pattern) — a Nasdaq-100
  // viewer shouldn't see off-universe rows. Fall back to all if the snapshot is absent.
  let live = data?.live ?? [];
  const snap = await loadSnapshot(universe);
  const members = new Set((snap?.stocks ?? []).map((s) => s.symbol));
  if (members.size) live = live.filter((l) => members.has(l.symbol));

  return <PrintPredictorView universe={universe} data={data} live={live} />;
}
