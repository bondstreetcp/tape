import { GLOSSARY } from "@/lib/glossary";

// A small "?" that reveals a plain-English definition on hover. Pass a glossary `term`
// (looked up in lib/glossary.ts) or free-form `text`. Renders nothing if neither resolves,
// so it's safe to sprinkle next to any label: <InfoDot term="IV rank" />.
export default function InfoDot({ term, text, className = "" }: { term?: string; text?: string; className?: string }) {
  const body = text || (term ? GLOSSARY[term] : "") || "";
  if (!body) return null;
  return (
    <span className={"group relative inline-flex cursor-help align-middle " + className} tabIndex={0}>
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[var(--border-strong)] text-[9px] font-bold leading-none text-[var(--text-4)] transition-colors group-hover:border-[var(--accent)] group-hover:text-[var(--accent)]">?</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-56 -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-[var(--text-2)] shadow-[var(--shadow-md)] group-hover:block group-focus:block"
      >
        {term && <span className="mb-0.5 block font-semibold text-[var(--text)]">{term}</span>}
        {body}
      </span>
    </span>
  );
}
