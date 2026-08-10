import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { LobbyingFile } from "@/lib/lobbying";
import LobbyingView from "@/components/LobbyingView";
import EmptyState from "@/components/EmptyState";

export const revalidate = 600;
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

export default async function Page({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await fs
    .readFile(path.join(process.cwd(), "data", "lobbying.json"), "utf8")
    .then((s) => JSON.parse(s) as LobbyingFile)
    .catch(() => null);
  if (!data || !data.rows?.length) {
    return <EmptyState universe={universe} title="Lobbying" note="Builds on the nightly refresh once refresh-lobbying has pulled the LDA filings." />;
  }
  return <LobbyingView universe={universe} data={data} />;
}
