import { getMacroCached } from "@/lib/macroData";
import { getEconCalendar, econKeyConfigured } from "@/lib/econCalendar";
import { getVolOilCurves } from "@/lib/curves";
import { getEconEstimates, matchEstimate } from "@/lib/econEstimates";
import { LABEL_TO_RELEASE } from "@/lib/releases";
import MacroDashboard from "@/components/MacroDashboard";

// FRED data updates daily/monthly — cache for an hour.
export const revalidate = 3600;

export default async function MacroPage() {
  const [macro, calendar, volOil, ff] = await Promise.all([
    getMacroCached(),
    getEconCalendar(),
    getVolOilCurves().catch(() => ({ vix: [], oil: [], asOf: "" })),
    getEconEstimates().catch(() => []),
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
    />
  );
}
