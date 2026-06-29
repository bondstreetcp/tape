import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildInsiderBuys, type InsidersFile } from "@/lib/insiders";
import InsidersView from "@/components/InsidersView";

export const dynamic = "force-dynamic";

// Insider Cluster-Buying — joins the nightly Form 4 buy scan (data/insiders.json) with the current
// universe's snapshot. Refreshed by `npm run refresh-insiders`.
export default async function InsidersPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const snap = await loadSnapshot(universe);
  let file: InsidersFile | null = null;
  try {
    const p = join(process.cwd(), "data", "insiders.json");
    if (existsSync(p)) file = JSON.parse(readFileSync(p, "utf8")) as InsidersFile;
  } catch {
    /* no insiders file yet */
  }

  const data = snap?.stocks && file ? buildInsiderBuys(file, snap.stocks) : null;
  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
        <h1 className="mt-4 text-2xl font-bold">Insider Cluster-Buying</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">No insider-buy data yet — it&apos;s built nightly for US names (`npm run refresh-insiders`).</p>
      </main>
    );
  }
  return <InsidersView data={data} universe={universe} />;
}
