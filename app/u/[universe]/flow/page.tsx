import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { getOptionsFlow } from "@/lib/optionsFlow";
import FlowView from "@/components/FlowView";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function FlowPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const flow = getOptionsFlow();
  if (!flow || !flow.entries.length) {
    return <EmptyState universe={universe} title="Options Flow" />;
  }
  return <FlowView flow={flow} universe={universe} />;
}
