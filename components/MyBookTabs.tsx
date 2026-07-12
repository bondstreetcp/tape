import Link from "next/link";

// One switcher across the three "my book" tools — they all read the SAME pasted book from
// localStorage, so jumping between them is seamless (paste once, see risk / catalysts / income).
const TOOLS = [
  { path: "/portfolio", label: "Cockpit", desc: "Risk, exposure & factor tilts" },
  { path: "/portfolio-radar", label: "Radar", desc: "Forward catalysts in your names" },
  { path: "/portfolio-income", label: "Income", desc: "Covered-call yield on your longs" },
];

/** `current` is the active tool's path (e.g. "/portfolio-radar"). */
export default function MyBookTabs({ universe, current }: { universe: string; current: string }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1.5" aria-label="Portfolio tools">
      <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-4)]">My book</span>
      {TOOLS.map((t) => {
        const active = t.path === current;
        return active ? (
          <span key={t.path} className="rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 px-2.5 py-1 text-[12px] font-semibold text-[var(--accent)]" title={t.desc}>{t.label}</span>
        ) : (
          <Link key={t.path} href={`/u/${universe}${t.path}`} className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[12px] font-medium text-[var(--text-3)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]" title={t.desc}>{t.label}</Link>
        );
      })}
    </nav>
  );
}
