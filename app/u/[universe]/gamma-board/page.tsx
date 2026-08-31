import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import type { GammaBoardData } from "@/lib/gammaBoard";
import type { ConvertiblesData } from "@/lib/convertible";
import GammaBoardView from "@/components/GammaBoardView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

const load = (): Promise<GammaBoardData | null> =>
  fsp
    .readFile(path.join(process.cwd(), "data", "gamma-board.json"), "utf8")
    .then((s) => JSON.parse(s) as GammaBoardData)
    .catch(() => null);

// Convertible capped-call caps → overlaid on the board as dealer-short-gamma levels (the issuer's hedge
// dealers sold those calls, so they're short gamma up at the cap — an extra resistance beyond the OI wall).
const loadConv = (): Promise<ConvertiblesData | null> =>
  fsp
    .readFile(path.join(process.cwd(), "data", "convertibles.json"), "utf8")
    .then((s) => JSON.parse(s) as ConvertiblesData)
    .catch(() => null);

export default async function GammaBoardPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international)
    return <UsOnlyNotice universe={universe} label="Dealer Gamma Board" relPath="/gamma-board" />;
  const [data, conv] = await Promise.all([load(), loadConv()]);
  const cappedCaps: Record<string, number> = {};
  for (const r of conv?.rows ?? []) if (r.ticker && r.cappedCallCap != null) cappedCaps[r.ticker] = r.cappedCallCap;
  return <GammaBoardView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), universe: "sp500", scanned: 0, rows: [] }} cappedCaps={cappedCaps} />;
}
