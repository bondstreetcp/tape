export default function Loading() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="h-5 w-64 animate-pulse rounded bg-[#1a1f2e]" />
      <div className="mt-3 h-8 w-80 animate-pulse rounded bg-[#1a1f2e]" />
      <div className="mt-4 h-40 animate-pulse rounded-xl bg-[#131722]" />
      <div className="mt-4 h-72 animate-pulse rounded-xl bg-[#131722]" />
      <p className="mt-4 text-center text-sm text-[#8b93a7]">
        Loading financials from Yahoo…
      </p>
    </main>
  );
}
