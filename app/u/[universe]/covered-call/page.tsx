import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { loadPutWrite } from "@/lib/putwrite";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import CoveredCallView from "@/components/CoveredCallView";

export const dynamic = "force-dynamic";

export default async function CoveredCallPage({
  params,
}: {
  params: Promise<{ universe: string }>;
}) {
  const { universe } = await params;
  const meta = UNIVERSE_BY_ID[universe];
  if (!meta) notFound();

  // Same screened pool as put-writing (one scan builds both put and call legs).
  const data = await loadPutWrite();
  const intl = !!meta.international;

  let candidates = data?.candidates ?? [];
  if (!intl) {
    const snap = await loadSnapshot(universe);
    const members = new Set((snap?.stocks ?? []).map((s) => s.symbol));
    if (members.size) candidates = candidates.filter((c) => members.has(c.symbol));
  } else {
    candidates = [];
  }

  return (
    <CoveredCallView
      universe={universe}
      candidates={candidates}
      generatedAt={data?.generatedAt ?? new Date().toISOString()}
      source={data?.source ?? "U.S. large/mid caps"}
      minMktCap={data?.filters?.minMarketCap ?? 1e9}
      intl={intl}
    />
  );
}
