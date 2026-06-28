import { notFound } from "next/navigation";
import Link from "next/link";
import { loadDeskNote } from "@/lib/deskNote";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import DeskNote from "@/components/DeskNote";

export const dynamic = "force-dynamic";

// Morning Desk — the night's GLM-authored overnight brief (movers + filings + options
// flow + analyst actions, fused and deduped). Universe-independent (US/S&P 500-keyed).
export default async function MorningDeskPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const note = await loadDeskNote();

  return (
    <main className="mx-auto max-w-[60rem] px-4 py-6 sm:px-6">
      <div className="mb-4">
        <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
        <h1 className="mt-1 text-2xl font-bold">Morning Desk</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-3)]">
          An AI brief of the overnight tape — the biggest moves, the most material new SEC filings, unusual options flow, and analyst rating changes, fused and deduped into one 60-second read. Research / decision-support, not investment advice.
        </p>
      </div>
      {note ? (
        <DeskNote note={note} universe={universe} />
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-16 text-center text-sm text-[var(--text-3)]">
          Tonight&apos;s desk note isn&apos;t built yet — it generates in the overnight run after the US close. Check back in the morning.
        </div>
      )}
    </main>
  );
}
