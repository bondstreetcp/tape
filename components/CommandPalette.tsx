"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ALL_NAV, FEATURES, TOP_LINKS, JOBS } from "@/lib/nav";

interface Result { type: "feature" | "company"; label: string; sub: string; href: string }

// ⌘K command palette — jump to any feature or company by name. Its empty state is the
// "Start here" map (features grouped by job-to-be-done), so newcomers can browse too.
export default function CommandPalette({ universe }: { universe: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [companies, setCompanies] = useState<{ symbol: string; name: string; universe?: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open on ⌘K / Ctrl+K (or a custom event from the header button); always closable with Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-cmdk", onOpen as EventListener);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("open-cmdk", onOpen as EventListener); };
  }, []);

  // Reset + focus on open; lazily load the company index the first time.
  useEffect(() => {
    if (!open) return;
    setQ(""); setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    if (companies.length === 0) {
      fetch("/api/search-index").then((r) => r.json()).then((d) => setCompanies(Array.isArray(d) ? d : d?.stocks || [])).catch(() => {});
    }
    return () => clearTimeout(t);
  }, [open, companies.length]);

  const results: Result[] = useMemo(() => {
    const s = q.trim().toLowerCase();
    const feats = ALL_NAV.filter((n) => !s || `${n.label} ${n.desc} ${n.kw || ""}`.toLowerCase().includes(s))
      .map((n): Result => ({ type: "feature", label: n.label, sub: n.desc, href: `/u/${universe}${n.path}` }));
    const cos = !s ? [] : companies
      .filter((c) => c.symbol.toLowerCase().includes(s) || c.name.toLowerCase().includes(s))
      .slice(0, 8)
      .map((c): Result => ({ type: "company", label: c.symbol, sub: c.name, href: `/u/${c.universe || universe}/stock/${encodeURIComponent(c.symbol)}` }));
    return [...feats, ...cos].slice(0, 40);
  }, [q, companies, universe]);

  useEffect(() => { setActive(0); }, [q]);

  const go = (href: string) => { setOpen(false); router.push(href); };
  const browsing = q.trim() === "";

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-md)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && results[active]) { go(results[active].href); }
            else if (e.key === "Escape") { setOpen(false); }
          }}
          placeholder="Search features or companies…"
          className="w-full border-b border-[var(--divider)] bg-transparent px-4 py-3.5 text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-4)]"
        />

        <div className="max-h-[55vh] overflow-y-auto p-1.5">
          {browsing ? (
            // Empty state = "Start here": features grouped by job.
            JOBS.map((job) => {
              const items = [...TOP_LINKS, ...FEATURES].filter((n) => n.job === job);
              return (
                <div key={job} className="mb-2">
                  <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{job}</div>
                  {items.map((n) => (
                    <button key={n.path + n.label} onMouseDown={(e) => { e.preventDefault(); go(`/u/${universe}${n.path}`); }}
                      className="flex w-full items-baseline gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-[var(--surface-hover)]">
                      <span className="text-sm font-medium text-[var(--text)]">{n.label}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-3)]">{n.desc}</span>
                    </button>
                  ))}
                </div>
              );
            })
          ) : results.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-[var(--text-3)]">No matches.</div>
          ) : (
            results.map((r, i) => (
              <button key={r.type + r.href + i} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); go(r.href); }}
                className={"flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left " + (i === active ? "bg-[var(--surface-hover)]" : "")}>
                <span className={"shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase " + (r.type === "company" ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--surface-hover)] text-[var(--text-3)]")}>
                  {r.type === "company" ? "Stock" : "Page"}
                </span>
                <span className={"shrink-0 text-sm font-medium " + (r.type === "company" ? "font-mono" : "") + " text-[var(--text)]"}>{r.label}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-3)]">{r.sub}</span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-[var(--divider)] px-3 py-1.5 text-[11px] text-[var(--text-4)]">
          <span><kbd className="rounded bg-[var(--surface-hover)] px-1">↑↓</kbd> navigate</span>
          <span><kbd className="rounded bg-[var(--surface-hover)] px-1">↵</kbd> open</span>
          <span><kbd className="rounded bg-[var(--surface-hover)] px-1">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
