import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import WheelTracker from "@/components/WheelTracker";

export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// Wheel Tracker — a client-only, localStorage-driven ledger of active theta-wheel positions. The page
// is just a shell (no server data); the book stays in the browser.
export default async function WheelPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international)
    return <UsOnlyNotice universe={universe} label="Wheel Tracker" relPath="/wheel" dataNote="The wheel runs on US options" />;
  return <WheelTracker universe={universe} />;
}
