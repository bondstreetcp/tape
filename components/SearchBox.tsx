"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface Lite { symbol: string; name: string }

export default function SearchBox({
  universe,
  stocks,
}: {
  universe: string;
  stocks: Lite[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const starts: Lite[] = [];
    const contains: Lite[] = [];
    for (const x of stocks) {
      const sym = x.symbol.toLowerCase();
      if (sym === s || sym.startsWith(s)) starts.push(x);
      else if (sym.includes(s) || x.name.toLowerCase().includes(s)) contains.push(x);
      if (starts.length + contains.length > 60) break;
    }
    return [...starts, ...contains].slice(0, 8);
  }, [q, stocks]);

  const go = (sym: string) => {
    router.push(`/u/${universe}/stock/${encodeURIComponent(sym)}`);
    setQ("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && matches[active]) {
            go(matches[active].symbol);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Search ticker or company…"
        className="w-56 rounded-lg border border-[#2a2e39] bg-[#131722] px-3 py-2 text-sm outline-none placeholder:text-[#5b6478] focus:border-[#3a4256] sm:w-64"
      />
      {open && matches.length > 0 && (
        <div className="absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-lg border border-[#2a2e39] bg-[#0b0e14] shadow-xl">
          {matches.map((m, i) => (
            <button
              key={m.symbol}
              onMouseDown={(e) => {
                e.preventDefault();
                go(m.symbol);
              }}
              onMouseEnter={() => setActive(i)}
              className={
                "flex w-full items-center gap-2 px-3 py-2 text-left " +
                (i === active ? "bg-[#1a1f2e]" : "")
              }
            >
              <span className="w-14 shrink-0 font-mono text-sm font-semibold">{m.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-[#8b93a7]">{m.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
