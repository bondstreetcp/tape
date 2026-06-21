import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { getOptionsFlow } from "@/lib/optionsFlow";
import FlowView from "@/components/FlowView";

export const dynamic = "force-dynamic";

export default async function FlowPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const flow = getOptionsFlow();
  if (!flow || !flow.entries.length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Options Flow</h1>
        <p className="mt-2 text-sm text-[var(--text-3)]">
          No options-flow snapshot yet. Run <span className="font-mono text-[var(--text-2)]">npm run refresh-flow</span> to scan the S&amp;P 500 for the day&apos;s largest options trades.
        </p>
      </main>
    );
  }
  return <FlowView flow={flow} universe={universe} />;
}
