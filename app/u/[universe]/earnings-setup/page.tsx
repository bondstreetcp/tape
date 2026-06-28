import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadEarningsMove } from "@/lib/earningsMove";
import EarningsSetupView from "@/components/EarningsSetupView";

export const dynamic = "force-dynamic";

// Earnings Setup Cards — a glanceable card deck of upcoming reporters (implied move vs. the stock's
// own history). Reuses data/earnings-move.json; the [universe] param drives nav + links.
export default async function EarningsSetupPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const data = await loadEarningsMove();
  if (!data || !data.rows.length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Earnings Setup Cards</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">
          No upcoming-earnings setups built yet. Run <code className="rounded bg-[var(--surface)] px-1.5 py-0.5">npm run refresh-earnings-move</code>.
        </p>
      </main>
    );
  }
  const asOf = data.generatedAt ? new Date(data.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  return <EarningsSetupView universe={universe} rows={data.rows} asOf={asOf} />;
}
