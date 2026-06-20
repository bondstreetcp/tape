import Backtest from "@/components/Backtest";

export const metadata = { title: "Backtest" };

export default async function BacktestPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Strategy Backtest</h1>
        <p className="mt-1 text-xs leading-relaxed text-[#8b93a7]">
          Test simple <span className="text-[#aab2c5]">price-based</span> strategies over this universe&apos;s largest names — momentum,
          trend-following, low-volatility, equal-weight — against the cap-weighted benchmark. Monthly rebalance, ~5 years.
        </p>
      </header>
      <Backtest universe={universe} />
    </main>
  );
}
