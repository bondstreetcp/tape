import Link from "next/link";
import DocSearch from "@/components/DocSearch";
import UniverseSwitcher from "@/components/UniverseSwitcher";
import { UNIVERSE_BY_ID } from "@/lib/universes";

export const metadata = { title: "Filings & Docs" };

export default async function ResearchPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Filings &amp; Docs</h1>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-3)]">
            Full-text search across <span className="text-[var(--text-2)]">every public company&apos;s</span> SEC filings — 10-Ks,
            10-Qs, 8-Ks, proxies — back to 2001. Find every mention of a theme, product, risk, or competitor (e.g.{" "}
            <span className="text-[var(--text-2)]">&quot;generative AI&quot;</span>,{" "}
            <span className="text-[var(--text-2)]">tariff</span>, <span className="text-[var(--text-2)]">&quot;going concern&quot;</span>).
            Data from SEC EDGAR.
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </header>
      <DocSearch />
    </main>
  );
}
