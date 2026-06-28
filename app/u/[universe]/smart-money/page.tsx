import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { loadSuperInvestors } from "@/lib/superinvestors";
import { loadCongress } from "@/lib/congress";
import { buildSmartMoney } from "@/lib/smartMoney";
import SmartMoneyView from "@/components/SmartMoneyView";

export const dynamic = "force-dynamic";

// Smart-Money Radar — computed at request from the 13F + Congress snapshots (cross-universe data;
// the [universe] param only drives nav + links). Broad Russell 3000 snapshot supplies context.
export default async function SmartMoneyPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const [si, cong, snap] = await Promise.all([loadSuperInvestors(), loadCongress(), loadSnapshot("russell3000")]);
  const ctxBy = new Map((snap?.stocks || []).map((s) => [s.symbol, s] as const));
  const names = buildSmartMoney(si, cong, ctxBy);

  if (!names.length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Smart-Money Radar</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">
          No accumulation data yet. Run <code className="rounded bg-[var(--surface)] px-1.5 py-0.5">npm run refresh-13f</code> and{" "}
          <code className="rounded bg-[var(--surface)] px-1.5 py-0.5">npm run refresh-congress</code> first.
        </p>
      </main>
    );
  }
  const asOf = si?.generatedAt ? new Date(si.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  return <SmartMoneyView names={names} universe={universe} asOf={asOf} />;
}
