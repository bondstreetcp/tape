import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { ConfluenceData } from "@/lib/confluence";
import ConfluenceView from "@/components/ConfluenceView";

export const dynamic = "force-dynamic";

function loadConfluence(): Promise<ConfluenceData | null> {
  return fs
    .readFile(path.join(process.cwd(), "data", "confluence.json"), "utf8")
    .then((s) => JSON.parse(s) as ConfluenceData)
    .catch(() => null);
}

// The Confluence Engine — a cross-market opportunity board (built over the Russell 3000), so the
// data is the same regardless of the current universe; the [universe] param only drives nav + the
// stock-page links.
export default async function ConfluencePage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const data = await loadConfluence();
  if (!data || !data.names.length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Confluence Engine</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">
          The board isn&apos;t built yet. Run <code className="rounded bg-[var(--surface)] px-1.5 py-0.5">npm run refresh-confluence</code> to fuse the signals.
        </p>
      </main>
    );
  }
  return <ConfluenceView universe={universe} data={data} />;
}
