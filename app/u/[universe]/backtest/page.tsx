import Backtest from "@/components/Backtest";
import { loadSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backtest" };

export default async function BacktestPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  const snapshot = await loadSnapshot(universe);
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Strategy Backtest</h1>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-3)]">
          Test <span className="text-[var(--text-2)]">price-based</span> strategies (momentum, trend, low-vol, equal-weight) and the{" "}
          <span className="text-[#d8b4fe]">factor screens</span> (Magic Formula, Net-Net, Piotroski, Shareholder Yield) over this universe&apos;s
          largest names, against the cap-weighted benchmark. Monthly rebalance, ~5 years.
        </p>
      </header>
      <Backtest universe={universe} stocks={snapshot?.stocks ?? []} />
    </main>
  );
}
