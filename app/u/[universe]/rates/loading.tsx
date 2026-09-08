// Page-shaped skeleton for the Fixed Income (/rates) page — streams instantly on navigation so the tab never
// looks dead while the curve + credit series load (the "does nothing at first" report). Mirrors the real
// header + the curve/spread card grid in <FixedIncomeView/>.
export default function RatesLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-4">
        <div className="h-4 w-20 animate-pulse rounded bg-[var(--surface-2)]" />
        <div className="mt-2 h-7 w-48 animate-pulse rounded bg-[var(--surface-2)]" />
        <div className="mt-2 h-3 w-72 animate-pulse rounded bg-[var(--surface-2)]" />
      </header>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="h-3 w-24 animate-pulse rounded bg-[var(--surface-2)]" />
            <div className="mt-2 h-6 w-16 animate-pulse rounded bg-[var(--surface-2)]" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="h-4 w-40 animate-pulse rounded bg-[var(--surface-2)]" />
        <div className="mt-3 h-56 w-full animate-pulse rounded bg-[var(--surface-2)]" />
      </div>
      <p className="mt-4 text-center text-xs text-[var(--text-4)]">Loading the yield curve &amp; credit spreads…</p>
    </main>
  );
}
