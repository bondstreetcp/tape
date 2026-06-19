import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import AppHeader from "@/components/AppHeader";

export default async function UniverseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ universe: string }>;
}) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const snapshot = await loadSnapshot(universe);
  const stocks = (snapshot?.stocks ?? []).map((s) => ({ symbol: s.symbol, name: s.name }));

  return (
    <>
      <AppHeader universe={universe} stocks={stocks} />
      {children}
    </>
  );
}
