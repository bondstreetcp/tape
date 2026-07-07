import { notFound } from "next/navigation";
import Link from "next/link";
import { loadDeskNote } from "@/lib/deskNote";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import DeskNote from "@/components/DeskNote";
import Briefing from "@/components/Briefing";

export const dynamic = "force-dynamic";

// Daily Desk — the AI-authored brief (movers + filings + options flow + analyst actions, fused and
// deduped; a pre-open morning run + a post-close evening run) MERGED with the Reuters news wire
// (Morning News Call + The Day Ahead) on one page. Universe-independent (US/S&P 500-keyed).
export default async function DailyDeskPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const note = await loadDeskNote();

  return (
    <main className="mx-auto max-w-[72rem] px-4 py-6 sm:px-6">
      <div className="mb-4">
        <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
        <h1 className="mt-1 text-2xl font-bold">Daily Desk</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-3)]">
          The AI desk brief — biggest moves, material SEC filings, unusual options flow, and analyst actions, fused into one read (a pre-open <b>morning run</b> and a post-close <b>evening run</b> each weekday) — followed by the day&apos;s Reuters news wire. Research / decision-support, not investment advice.
        </p>
      </div>

      {note ? (
        <DeskNote note={note} universe={universe} />
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-16 text-center text-sm text-[var(--text-3)]">
          The desk note isn&apos;t built yet — it generates before the open (~8:45am ET) and after the close (~5:15pm ET) on weekdays.
        </div>
      )}

      <section className="mt-6">
        <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-[var(--divider)] pb-1.5">
          <h2 className="text-lg font-bold text-[var(--text)]">News wire</h2>
          <span className="text-[11px] text-[var(--text-4)]">Reuters Morning News Call · The Day Ahead</span>
        </div>
        <Briefing />
      </section>
    </main>
  );
}
