import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";

/**
 * Shown when a US-single-stock-options / US-earnings screener is opened on an INTERNATIONAL universe.
 * Those desks read a global US feed (vol-dislocation, earnings-move, dispersion, …), so under an intl
 * index they'd show US tickers with a mismatched header. Instead of that, we explain the scope and
 * offer one-click links to the same desk on the US universes. Server component (no client JS).
 */
export default function UsOnlyNotice({
  universe,
  label,
  relPath,
  dataNote,
}: {
  universe: string;
  label: string;
  relPath: string;
  /** What the US-only feed actually is — defaults to the options/earnings wording most desks need.
   *  Non-options US feeds (e.g. SEC Form 4 insider buys) pass their own so the notice isn't wrong. */
  dataNote?: string;
}) {
  const name = UNIVERSE_BY_ID[universe]?.name ?? "this index";
  const usUniverses = ["sp500", "nasdaq100", "russell1000", "russell3000"] as const;
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center">
        <div className="text-3xl" aria-hidden>🇺🇸</div>
        <h1 className="mt-3 text-xl font-bold">{label} covers US-listed names only</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--text-3)]">
          {dataNote ?? "This desk is built on US single-stock options & earnings data"}, which isn&apos;t available
          for <b className="text-[var(--text-2)]">{name}</b>. Open it on a US universe:
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {usUniverses.map((u) => (
            <Link
              key={u}
              href={`/u/${u}${relPath}`}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm font-medium text-[var(--accent)] transition-colors hover:border-[var(--border-strong)]"
            >
              {UNIVERSE_BY_ID[u]?.name ?? u}
            </Link>
          ))}
        </div>
        <p className="mt-6 text-xs text-[var(--text-4)]">
          <Link href={`/u/${universe}`} className="hover:text-[var(--text-3)]">← Back to {name}</Link>
        </p>
      </div>
    </main>
  );
}
