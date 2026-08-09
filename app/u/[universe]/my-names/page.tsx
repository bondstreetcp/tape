import { notFound } from "next/navigation";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import MyNamesLedger from "@/components/MyNamesLedger";
import PushAlerts from "@/components/PushAlerts";

export const dynamic = "force-dynamic";

// My Names — the Change Ledger (P1 of the monitoring layer; docs/SPEC-MY-NAMES-MONITOR.md).
// "What changed in MY names since I last looked" — the watchlist joined against the app's
// existing feeds server-side; the list itself is client state, so the shell renders and the
// client component does the join. P2 widens the list to portfolio ∪ watchlist.
export default async function MyNamesPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  return (
    <main className="mx-auto max-w-[72rem] px-4 py-6 sm:px-6">
      <div className="mb-4">
        <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
        <h1 className="mt-1 text-2xl font-bold">My Names — Change Ledger</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-3)]">
          Everything that changed in the names you watch, most-actionable first — prints and preannouncements, deals and reviews, upcoming reports with the priced move, filings, insider clusters, short-mechanics and borrow stress, estimate revisions, unusual options premium, and fresh headlines. Manage the list on the <Link href={`/u/${universe}/watchlist`} className="text-[var(--accent)] hover:underline">Watchlist</Link>.
        </p>
      </div>
      <MyNamesLedger universe={universe} />
      <PushAlerts />
    </main>
  );
}
