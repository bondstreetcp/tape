import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import RatioChartView from "@/components/RatioChartView";

export const dynamic = "force-dynamic";

// Ratio & spread charts — a general two-symbol tool; lives under /u/[universe] to inherit the nav.
export default async function RatioPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  return <RatioChartView universe={universe} />;
}
