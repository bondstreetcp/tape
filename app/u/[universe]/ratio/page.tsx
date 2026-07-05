import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import RatioChartView from "@/components/RatioChartView";

export const dynamic = "force-dynamic";

// Ratio & spread charts — a general two-symbol tool; lives under /u/[universe] to inherit the nav.
// Accepts ?a=&b= so other pages (e.g. the Pairs screener) can deep-link a specific pair pre-loaded.
export default async function RatioPage({
  params,
  searchParams,
}: {
  params: Promise<{ universe: string }>;
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const sp = await searchParams;
  return <RatioChartView universe={universe} initialA={typeof sp.a === "string" ? sp.a : undefined} initialB={typeof sp.b === "string" ? sp.b : undefined} />;
}
