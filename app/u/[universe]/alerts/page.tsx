import { Suspense } from "react";
import AlertsManager from "@/components/AlertsManager";

export const dynamic = "force-dynamic";

export default async function AlertsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  return (
    <Suspense fallback={null}>
      <AlertsManager universe={universe} />
    </Suspense>
  );
}
