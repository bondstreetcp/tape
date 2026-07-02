// Route-level loading state for every universe page — streams instantly while slow server pages
// (congress, confluence, research) build, so navigation never looks dead.
export default function Loading() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <div className="animate-pulse text-center text-sm text-[var(--text-4)]">Loading…</div>
    </main>
  );
}
