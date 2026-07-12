import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { PolicyData } from "@/lib/policy";
import PolicyView from "@/components/PolicyView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

function loadPolicy(): Promise<PolicyData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "policy.json"), "utf8")
    .then((s) => JSON.parse(s) as PolicyData)
    .catch(() => null);
}

export default async function PolicyPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await loadPolicy();
  return <PolicyView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), scanned: 0, items: [] }} />;
}
