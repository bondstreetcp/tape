import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { checkFreshness } from "@/lib/dataFreshness";
import StatusView from "@/components/StatusView";
import { isTickHistory, isTickReport } from "@/lib/tickHistory";

// force-dynamic + nodejs: a status page that could be served from cache is worse than none — it would
// report health as of whenever the page was baked. Every visit re-runs the same registry check the CI
// gate and /api/health/data use, so there is exactly one definition of "healthy" in the system.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function StatusPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  // The runner's own record of its last 30 days (lib/tickHistory) rides the R2 tar with the feeds.
  const readData = async (f: string): Promise<unknown> => {
    try { return JSON.parse(await fs.readFile(path.join(process.cwd(), "data", f), "utf8")); } catch { return null; }
  };
  const [report, histRaw, latestRaw] = await Promise.all([checkFreshness(), readData("tick-history.json"), readData("tick-report.json")]);
  const ticks = { history: isTickHistory(histRaw) ? histRaw : null, latest: isTickReport(latestRaw) ? latestRaw : null };
  return (
    <StatusView
      universe={universe}
      report={report}
      ticks={ticks}
      build={{
        version: process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0",
        sha: process.env.NEXT_PUBLIC_GIT_SHA || "dev",
        builtAt: process.env.NEXT_PUBLIC_BUILD_TIME || "",
      }}
    />
  );
}
