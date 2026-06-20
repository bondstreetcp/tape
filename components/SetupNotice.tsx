export default function SetupNotice() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-2xl font-semibold">No market data yet</h1>
      <p className="text-[var(--text-3)]">
        Pull the latest end-of-day data for the S&amp;P 500 and the 11 sector
        ETFs, then reload this page.
      </p>
      <pre className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4 text-left text-sm">
        <span className="text-[var(--text-3)]"># one-time: grab the constituent list</span>
        {"\n"}npm run fetch-constituents{"\n\n"}
        <span className="text-[var(--text-3)]"># pull prices (a few minutes for all 500)</span>
        {"\n"}npm run refresh-data
      </pre>
      <p className="text-xs text-[var(--text-3)]">
        Tip: <code className="text-[var(--text)]">LIMIT=40 npm run refresh-data</code>{" "}
        builds a quick subset while testing.
      </p>
    </main>
  );
}
