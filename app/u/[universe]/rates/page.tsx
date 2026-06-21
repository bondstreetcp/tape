import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { getMacroCached } from "@/lib/macroData";
import FixedIncomeView from "@/components/FixedIncomeView";

export const revalidate = 1800;

export default async function RatesPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const macro = await getMacroCached();
  return <FixedIncomeView universe={universe} curve={macro.curve} indicators={macro.indicators} asOf={macro.asOf} />;
}
