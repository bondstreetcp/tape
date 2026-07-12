import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { loadSuperInvestors } from "@/lib/superinvestors";
import { loadCongress } from "@/lib/congress";
import { buildSmartMoney } from "@/lib/smartMoney";
import SmartMoneyView from "@/components/SmartMoneyView";
import EmptyState from "@/components/EmptyState";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// Smart-Money Radar — computed at request from the 13F + Congress snapshots (cross-universe data;
// the [universe] param only drives nav + links). Broad Russell 3000 snapshot supplies context.
export default async function SmartMoneyPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const [si, cong, snap] = await Promise.all([loadSuperInvestors(), loadCongress(), loadSnapshot("russell3000")]);
  const ctxBy = new Map((snap?.stocks || []).map((s) => [s.symbol, s] as const));
  const names = buildSmartMoney(si, cong, ctxBy);

  if (!names.length) {
    return <EmptyState universe={universe} title="Smart-Money Radar" />;
  }
  const asOf = si?.generatedAt ? new Date(si.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  return <SmartMoneyView names={names} universe={universe} asOf={asOf} />;
}
