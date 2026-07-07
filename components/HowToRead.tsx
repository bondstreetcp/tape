// "New here?" explainer — a collapsible plain-English card that tells a first-time visitor how a
// page works: where the numbers come from, what the columns mean, and how to read the board.
// Native <details> (no client JS), so it renders in server components and costs nothing collapsed.

export default function HowToRead({ title = "New to this page? How it works", children }: { title?: string; children: React.ReactNode }) {
  return (
    <details className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5">
      <summary className="cursor-pointer select-none text-[13px] font-medium text-[var(--accent)] hover:underline">
        ⓘ {title}
      </summary>
      <div className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-[var(--text-2)] [&_b]:text-[var(--text)]">
        {children}
      </div>
    </details>
  );
}
