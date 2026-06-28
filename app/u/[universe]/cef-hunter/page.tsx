import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadCef } from "@/lib/cef";
import { buildCefHunter } from "@/lib/cefHunter";
import CefHunterView from "@/components/CefHunterView";

export const dynamic = "force-dynamic";

// CEF Discount Hunter — the scored shortlist of the most stretched US closed-end-fund discounts.
// Reuses data/cef.json; the [universe] param only drives nav + links.
export default async function CefHunterPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const data = await loadCef();
  const funds = data?.funds ? buildCefHunter(data.funds) : [];
  if (!funds.length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">CEF Discount Hunter</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">
          No fund data yet. Run <code className="rounded bg-[var(--surface)] px-1.5 py-0.5">npm run refresh-cef</code>.
        </p>
      </main>
    );
  }
  return <CefHunterView universe={universe} funds={funds} />;
}
