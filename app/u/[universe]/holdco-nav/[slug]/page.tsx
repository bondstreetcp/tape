import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { holdcoByTicker, type HoldcoNavData } from "@/lib/holdco";
import HoldcoDetailView from "@/components/HoldcoDetailView";

export const dynamic = "force-dynamic";

// Per-holdco detail — NAV-basket vs price chart + discount-over-time + constituents.
export default async function HoldcoDetailPage({ params }: { params: Promise<{ universe: string; slug: string }> }) {
  const { universe, slug } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  let data: HoldcoNavData | null = null;
  try {
    const p = join(process.cwd(), "data", "holdco-nav.json");
    if (existsSync(p)) data = JSON.parse(readFileSync(p, "utf8")) as HoldcoNavData;
  } catch {
    /* not built */
  }
  const h = data?.holdcos.find((x) => x.slug === slug) ?? null;
  if (!h) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Link href={`/u/${universe}/holdco-nav`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← Holdco NAV tracker</Link>
        <h1 className="mt-4 text-2xl font-bold">Holdco not found</h1>
      </main>
    );
  }
  return <HoldcoDetailView h={h} universe={universe} xref={holdcoByTicker(data!.holdcos)} />;
}
