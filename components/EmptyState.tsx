import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";

/** Standard "data not built yet" screen for feature pages whose nightly dataset is missing.
 *  Replaces the old developer-facing "Run `npm run refresh-X`" fallbacks (which meant nothing to a
 *  deployed user) and keeps the normal page chrome (back-link + title) so users aren't stranded. */
export default function EmptyState({ universe, title, note }: { universe: string; title: string; note?: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">
        ← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}
      </Link>
      <h1 className="mt-1 text-2xl font-bold">{title}</h1>
      <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
        Nothing here yet — this fills in on the nightly data refresh.
        {note && <div className="mt-2 text-[13px] text-[var(--text-4)]">{note}</div>}
      </div>
    </main>
  );
}
