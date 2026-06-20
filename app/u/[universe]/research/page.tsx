import DocSearch from "@/components/DocSearch";

export const metadata = { title: "Filing Search" };

export default function ResearchPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Filing Search</h1>
        <p className="mt-1 text-xs leading-relaxed text-[#8b93a7]">
          Full-text search across <span className="text-[#aab2c5]">every public company&apos;s</span> SEC filings — 10-Ks,
          10-Qs, 8-Ks, proxies — back to 2001. Find every mention of a theme, product, risk, or competitor (e.g.{" "}
          <span className="text-[#aab2c5]">&quot;generative AI&quot;</span>,{" "}
          <span className="text-[#aab2c5]">tariff</span>, <span className="text-[#aab2c5]">&quot;going concern&quot;</span>).
          Data from SEC EDGAR.
        </p>
      </header>
      <DocSearch />
    </main>
  );
}
