import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildSqueeze } from "@/lib/shortSqueeze";
import type { EstimatesFile } from "@/lib/revisions";
import SqueezeView from "@/components/SqueezeView";

export const dynamic = "force-dynamic";

// Short-Squeeze Radar — joins the per-name short-interest block in the nightly estimate snapshot
// (data/estimates.json, US-only) with the current universe's snapshot.
export default async function SqueezePage({ params }: { params: Promise<{ universe: string }> }) {
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

  const data = snap?.stocks && file ? buildSqueeze(file, snap.stocks) : null;
  if (!data || !data.rows.length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
        <h1 className="mt-4 text-2xl font-bold">Short-Squeeze Radar</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">No short-interest data for this universe — it&apos;s built nightly for US names (`npm run refresh-estimates`). This radar is US-only; try the S&amp;P 500 or a broad US universe.</p>
      </main>
    );
  }
  return <SqueezeView data={data} universe={universe} />;
}
