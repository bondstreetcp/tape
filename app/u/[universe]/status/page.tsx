import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { checkFreshness } from "@/lib/dataFreshness";
import StatusView from "@/components/StatusView";

// force-dynamic + nodejs: a status page that could be served from cache is worse than none — it would
// report health as of whenever the page was baked. Every visit re-runs the same registry check the CI
// gate and /api/health/data use, so there is exactly one definition of "healthy" in the system.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function StatusPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const report = await checkFreshness();
  return (
    <StatusView
      universe={universe}
      report={report}
      build={{
        version: process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0",
        sha: process.env.NEXT_PUBLIC_GIT_SHA || "dev",
        builtAt: process.env.NEXT_PUBLIC_BUILD_TIME || "",
      }}
    />
  );
}
