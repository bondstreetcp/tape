import ResearchDesk from "@/components/ResearchDesk";

export const metadata = { title: "Research Desk" };

export default function ResearchDeskPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">
          Research Desk{" "}
          <span className="align-middle rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-3)]">beta</span>
        </h1>
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-[var(--text-3)]">
          Ingest sell-side research PDFs → structured extraction (rating, price target, estimates, thesis, risks) →
          cross-broker <span className="text-[var(--text-2)]">consensus</span>, where the Street{" "}
          <span className="text-[var(--text-2)]">diverges</span>, and a{" "}
          <span className="text-[var(--text-2)]">&quot;what you might be missing&quot;</span> synthesis. The corpus is private to you,
          stored locally and never committed or redistributed.
        </p>
      </header>
      <ResearchDesk />
    </main>
  );
}
