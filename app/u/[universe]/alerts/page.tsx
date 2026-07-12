import { Suspense } from "react";
import AlertsManager from "@/components/AlertsManager";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

export default async function AlertsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  return (
    <Suspense fallback={null}>
      <AlertsManager universe={universe} />
    </Suspense>
  );
}
