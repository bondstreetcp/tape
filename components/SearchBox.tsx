"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Entry { symbol: string; name: string; universe: string }

// Subsequence test — chars of q appear in order in str (catches typos, e.g.
// "aritza" still matches "aritzia").
function isSubsequence(q: string, str: string): boolean {
  let i = 0;
  for (let j = 0; j < str.length && i < q.length; j++) if (str[j] === q[i]) i++;
  return i === q.length;
}

export default function SearchBox({
  universe,
  stocks,
}: {
  universe: string;
  stocks: { symbol: string; name: string }[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Global index (all universes) fetched once; until it lands, fall back to the
  // current universe's stocks so search works instantly.
  const [global, setGlobal] = useState<Entry[] | null>(null);
  const fetched = useRef(false);

  const loadGlobal = () => {
    if (fetched.current) return;
    fetched.current = true;
    fetch("/api/search-index")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d)) setGlobal(d); })
      .catch(() => {});
  };
  useEffect(loadGlobal, []);

  const source: Entry[] = useMemo(
    () => global ?? stocks.map((s) => ({ ...s, universe })),
    [global, stocks, universe],
  );

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const starts: Entry[] = [];
    const contains: Entry[] = [];
    for (const x of source) {
      const sym = x.symbol.toLowerCase();
      const nm = x.name.toLowerCase();
      if (sym === s || sym.startsWith(s) || nm.startsWith(s)) starts.push(x);
      else if (sym.includes(s) || nm.includes(s)) contains.push(x);
      if (starts.length + contains.length > 120) break;
    }
    let out = [...starts, ...contains];
    // Fuzzy fallback when strong matches are sparse (handles misspellings).
    if (out.length < 6 && s.length >= 4) {
      for (const x of source) {
        if (out.includes(x)) continue;
        if (isSubsequence(s, x.name.toLowerCase())) { out.push(x); if (out.length >= 8) break; }
      }
    }
    return out.slice(0, 8);
  }, [q, source]);

  const go = (e: Entry) => {
    router.push(`/u/${e.universe}/stock/${encodeURIComponent(e.symbol)}`);
    setQ("");
    setOpen(false);
  };
  // Free-form ticker lookup — routes to an off-index symbol (when-issued spinoffs like
  // MBGL-WI, fresh IPOs, ADRs); the stock page fetches it live from Yahoo.
  const literal = q.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "");
  const goLiteral = () => {
    if (!literal) return;
    router.push(`/u/${universe}/stock/${encodeURIComponent(literal)}`);
    setQ("");
    setOpen(false);
  };
  // Show the literal-lookup row unless the top match already IS that exact ticker.
  const showLiteral = literal.length > 0 && matches[0]?.symbol !== literal;

  return (
    <div className="relative">
      <input
        value={q}
        onFocus={() => { loadGlobal(); setOpen(true); }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            if (matches[active]) go(matches[active]);
            else if (literal) goLiteral();
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Search any company…"
        className="w-56 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none placeholder:text-[var(--text-4)] focus:border-[var(--border-strong)] sm:w-64"
      />
      {open && (matches.length > 0 || showLiteral) && (
        <div className="absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-xl">
          {matches.map((m, i) => (
            <button
              key={`${m.universe}:${m.symbol}`}
              onMouseDown={(e) => {
                e.preventDefault();
                go(m);
              }}
              onMouseEnter={() => setActive(i)}
              className={
                "flex w-full items-center gap-2 px-3 py-2 text-left " +
                (i === active ? "bg-[var(--surface-hover)]" : "")
              }
            >
              <span className="w-16 shrink-0 truncate font-mono text-sm font-semibold">{m.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-3)]">{m.name}</span>
            </button>
          ))}
          {showLiteral && (
            <button
              onMouseDown={(e) => { e.preventDefault(); goLiteral(); }}
              className={"flex w-full items-center gap-2 px-3 py-2 text-left " + (matches.length === 0 ? "" : "border-t border-[var(--divider)]")}
            >
              <span className="w-16 shrink-0 truncate font-mono text-sm font-semibold text-[#60a5fa]">{literal}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-4)]">Look up any ticker (incl. when-issued) →</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
