import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { HoldcoNavData } from "@/lib/holdco";
import HoldcoNavView from "@/components/HoldcoNavView";

export const dynamic = "force-dynamic";

// Holdco NAV tracker — universe-independent screener (lives under /u/[universe] to inherit the nav).
// Reads data/holdco-nav.json, built by `npm run refresh-holdco-nav`.
export default async function HoldcoNavPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  let data: HoldcoNavData | null = null;
  try {
    const p = join(process.cwd(), "data", "holdco-nav.json");
    if (existsSync(p)) data = JSON.parse(readFileSync(p, "utf8")) as HoldcoNavData;
  } catch {
    /* not built yet */
  }
  if (!data || !data.holdcos.length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
        <h1 className="mt-4 text-2xl font-bold">Holdco NAV / Discount Tracker</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">Not built yet — run <code className="rounded bg-[var(--surface-2)] px-1">npm run refresh-holdco-nav</code>.</p>
      </main>
    );
  }
  return <HoldcoNavView data={data} universe={universe} />;
}
