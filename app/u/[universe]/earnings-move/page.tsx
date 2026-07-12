import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { loadEarningsMove } from "@/lib/earningsMove";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import EarningsMoveView from "@/components/EarningsMoveView";
import UsOnlyNotice from "@/components/UsOnlyNotice";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

export default async function EarningsMovePage({
  params,
}: {
  params: Promise<{ universe: string }>;
}) {
  const { universe } = await params;
  const meta = UNIVERSE_BY_ID[universe];
  if (!meta) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Earnings Move" relPath="/earnings-move" />;

  const data = await loadEarningsMove();
  const intl = !!meta.international;

  let rows = data?.rows ?? [];
  if (!intl) {
    const snap = await loadSnapshot(universe);
    const members = new Set((snap?.stocks ?? []).map((s) => s.symbol));
    if (members.size) rows = rows.filter((r) => members.has(r.symbol));
  } else {
    rows = [];
  }

  return (
    <EarningsMoveView
      universe={universe}
      rows={rows}
      generatedAt={data?.generatedAt ?? new Date().toISOString()}
      source={data?.source ?? "U.S. large/mid caps reporting soon"}
      windowDays={data?.windowDays ?? 16}
      intl={intl}
    />
  );
}
