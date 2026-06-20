import { getMacroCached } from "@/lib/macroData";
import { getEconCalendar, econKeyConfigured } from "@/lib/econCalendar";
import { getVolOilCurves } from "@/lib/curves";
import MacroDashboard from "@/components/MacroDashboard";

// FRED data updates daily/monthly — cache for an hour.
export const revalidate = 3600;

export default async function MacroPage() {
  const [macro, calendar, volOil] = await Promise.all([
    getMacroCached(),
    getEconCalendar(),
    getVolOilCurves().catch(() => ({ vix: [], oil: [], asOf: "" })),
  ]);
  return (
    <MacroDashboard
      curve={macro.curve}
      indicators={macro.indicators}
      asOf={macro.asOf}
      calendar={calendar}
      keyConfigured={econKeyConfigured()}
      volOil={volOil}
      gdpNow={macro.gdpNow ?? null}
    />
  );
}
