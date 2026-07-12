import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { SpinoffsData } from "@/lib/spinoffs";
import SpinoffsView from "@/components/SpinoffsView";
import EmptyState from "@/components/EmptyState";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";
export const metadata = { title: "Spinoff Turnover" };

export default async function SpinoffsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await fsp
    .readFile(path.join(process.cwd(), "data", "spinoffs.json"), "utf8")
    .then((s) => JSON.parse(s) as SpinoffsData)
    .catch(() => null);
  if (!data) return <EmptyState universe={universe} title="Spinoff Turnover" />;
  return <SpinoffsView universe={universe} data={data} />;
}
