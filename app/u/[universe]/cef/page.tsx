import { notFound } from "next/navigation";
import { loadCef } from "@/lib/cef";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import CefScreenerView from "@/components/CefScreenerView";

export const dynamic = "force-dynamic";

// Closed-end fund discount-to-NAV screener. Universe-independent (its own US CEF universe);
// the route lives under /u/[universe] only so it inherits the app header + nav.
export default async function CefPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const data = await loadCef();
  if (!data || !data.funds.length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Closed-End Fund Screener</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">Fund data isn&apos;t built yet. Run <code className="rounded bg-[var(--surface)] px-1.5 py-0.5">npm run refresh-cef</code> to pull the latest CEF pricing.</p>
      </main>
    );
  }
  return <CefScreenerView universe={universe} data={data} />;
}
