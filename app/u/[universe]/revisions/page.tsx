import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildRevisions, type EstimatesFile } from "@/lib/revisions";
import RevisionsView from "@/components/RevisionsView";

export const dynamic = "force-dynamic";

// Revisions Momentum — joins the nightly estimate snapshot (data/estimates.json) with the current
// universe's snapshot. Estimate revisions are refreshed by `npm run refresh-estimates`.
export default async function RevisionsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const snap = await loadSnapshot(universe);
  let file: EstimatesFile | null = null;
  try {
    const p = join(process.cwd(), "data", "estimates.json");
    if (existsSync(p)) file = JSON.parse(readFileSync(p, "utf8")) as EstimatesFile;
  } catch {
    /* no estimates file yet */
  }

  const data = snap?.stocks && file ? buildRevisions(file, snap.stocks) : null;
  if (!data || !data.rows.length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
        <h1 className="mt-4 text-2xl font-bold">Revisions Momentum</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">No estimate-revision data for this universe yet — it&apos;s built nightly (`npm run refresh-estimates`). The S&amp;P 500 is covered first.</p>
      </main>
    );
  }
  return <RevisionsView data={data} universe={universe} />;
}
