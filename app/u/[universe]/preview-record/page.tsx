import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { loadSnapshot } from "@/lib/data";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import type { PreviewLogData } from "@/lib/earningsPreviewLog";
import PreviewRecordView from "@/components/PreviewRecordView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

function loadPreviewLog(): Promise<PreviewLogData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "earnings-preview-log.json"), "utf8")
    .then((s) => JSON.parse(s) as PreviewLogData)
    .catch(() => null);
}

export default async function PreviewRecordPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  const meta = UNIVERSE_BY_ID[universe];
  if (!meta) notFound();
  if (meta.international) return <UsOnlyNotice universe={universe} label="Earnings Preview Accuracy" relPath="/preview-record" />;

  const data = await loadPreviewLog();
  // Scope the record to THIS universe's members (the track-record pattern) — a Nasdaq-100 viewer
  // shouldn't see Russell-3000 small-cap forecasts. Fall back to everything if the snapshot is absent.
  let recs = data?.recs ?? [];
  const snap = await loadSnapshot(universe);
  const members = new Set((snap?.stocks ?? []).map((s) => s.symbol));
  if (members.size) recs = recs.filter((r) => members.has(r.symbol));
  return (
    <PreviewRecordView
      universe={universe}
      recs={recs}
      generatedAt={data?.generatedAt ?? new Date().toISOString()}
      intl={!!meta.international}
    />
  );
}
