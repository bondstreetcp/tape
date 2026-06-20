import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { INDEX_META } from "@/lib/indices";
import IndexProfile from "@/components/IndexProfile";
import type { StockRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function IndexPage({
  params,
}: {
  params: Promise<{ universe: string; symbol: string }>;
}) {
  const { universe, symbol } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const SYM = decodeURIComponent(symbol);
  const meta = INDEX_META[SYM] ?? { symbol: SYM, name: SYM, about: "" };

  // Inline constituents (e.g. the Dow 30): pull their rows from a snapshot that holds them.
  let constituents: StockRow[] = [];
  if (meta.constituents?.length) {
    const snap = await loadSnapshot(meta.constituentUniverse ?? universe);
    const want = new Set(meta.constituents);
    constituents = (snap?.stocks ?? []).filter((s) => want.has(s.symbol));
  }

  return <IndexProfile universe={universe} meta={meta} constituents={constituents} />;
}
