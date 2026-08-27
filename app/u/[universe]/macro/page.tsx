import { getMacroCached } from "@/lib/macroData";
import { getEconCalendar, econKeyConfigured } from "@/lib/econCalendar";
import { getVolOilCurves } from "@/lib/curves";
import { getEconEstimates, matchEstimate } from "@/lib/econEstimates";
import { LABEL_TO_RELEASE } from "@/lib/releases";
import { getMacroReleases } from "@/lib/macroReleasesServer";
import { getRealEconomy } from "@/lib/realEconomyServer";
import { getIndexTrend, getSectorTrend } from "@/lib/indexTrendServer";
import { getCot } from "@/lib/cotServer";
import { getEnergy } from "@/lib/energyServer";
import { getEconSurprise } from "@/lib/econSurpriseServer";
import { getMarketHeadlines } from "@/lib/marketHeadlinesFetch";
import MacroDashboard from "@/components/MacroDashboard";

// FRED data updates daily/monthly — cache for an hour.
export const revalidate = 3600;

export default async function MacroPage() {
  const [macro, calendar, volOil, ff, recentReleases, headlines, realEconomy, indexTrend, sectorTrend, cot, energy, econSurprise] = await Promise.all([
    getMacroCached(),
    getEconCalendar(),
    getVolOilCurves().catch(() => ({ vix: [], oil: [], asOf: "" })),
    getEconEstimates().catch(() => []),
    getMacroReleases().catch(() => []),
    getMarketHeadlines().catch(() => []),
    getRealEconomy().catch(() => null),
    getIndexTrend().catch(() => null),
    getSectorTrend().catch(() => null),
    getCot().catch(() => null),
    getEnergy().catch(() => null),
    getEconSurprise().catch(() => null),
  ]);
  // Attach the consensus estimate to each upcoming release where we have one.
  const calendarWithEst = calendar.map((e) => ({
    ...e,
    estimate: matchEstimate(LABEL_TO_RELEASE[e.label] ?? "", e.date, ff),
  }));
  return (
    <MacroDashboard
      curve={macro.curve}
      indicators={macro.indicators}
      asOf={macro.asOf}
      calendar={calendarWithEst}
      keyConfigured={econKeyConfigured()}
      volOil={volOil}
      releases={macro.releases}
      creditSeries={macro.creditSeries}
      recentReleases={recentReleases}
      headlines={headlines}
      realEconomy={realEconomy}
      indexTrend={indexTrend}
      sectorTrend={sectorTrend}
      cot={cot}
      energy={energy}
      econSurprise={econSurprise}
    />
  );
}
