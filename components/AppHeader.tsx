"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SearchBox from "./SearchBox";
import ThemeToggle from "./ThemeToggle";

interface Item { href: string; label: string }
interface Group { label: string; items: Item[] }

export default function AppHeader({
  universe,
  stocks,
}: {
  universe: string;
  stocks: { symbol: string; name: string }[];
}) {
  const pathname = usePathname();
  const base = `/u/${universe}`;
  const [open, setOpen] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const navRef = useRef<HTMLElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const groups: Group[] = [
    {
      label: "Markets",
      items: [
        { href: `${base}/heatmap`, label: "Heatmap" },
        { href: `${base}/market`, label: "Cross-Asset Monitor" },
        { href: `${base}/rotation`, label: "Sector Rotation" },
        { href: `${base}/flow`, label: "Options Flow" },
        { href: `${base}/earnings`, label: "Earnings Calendar" },
      ],
    },
    {
      label: "Research",
      items: [
        { href: `${base}/compare-stocks`, label: "Compare Stocks" },
        { href: `${base}/compare`, label: "Sector Compare" },
        { href: `${base}/superinvestors`, label: "Super-Investors" },
        { href: `${base}/backtest`, label: "Backtest" },
        { href: `${base}/research`, label: "Filings & Docs" },
        { href: `${base}/research-desk`, label: "Research Desk" },
      ],
    },
    {
      label: "Economy",
      items: [
        { href: `${base}/macro`, label: "Macro & Rates" },
        { href: `${base}/briefing`, label: "Daily Briefing" },
      ],
    },
  ];

  // Close the dropdown on outside-click, scroll, or navigation.
  useEffect(() => { setOpen(null); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!navRef.current?.contains(t) && !dropRef.current?.contains(t)) setOpen(null);
    };
    const onScroll = () => setOpen(null);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  const groupActive = (g: Group) => g.items.some((it) => isActive(it.href));

  const linkCls = (active: boolean) =>
    "shrink-0 whitespace-nowrap rounded-md px-2 py-1 transition-colors " +
    (active ? "bg-[var(--surface-hover)] text-[var(--text)]" : "text-[var(--text-3)] hover:text-[var(--text)]");

  const toggle = (label: string, e: React.MouseEvent) => {
    if (open === label) { setOpen(null); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ left: Math.round(r.left), top: Math.round(r.bottom + 5) });
    setOpen(label);
  };

  const active = groups.find((g) => g.label === open);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--divider)] bg-[var(--bg)]/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <Link href={base} className="mr-1 flex shrink-0 items-center gap-1.5 font-semibold text-[var(--text)]">
            <span className="text-[#60a5fa]">▦</span>
            <span className="hidden font-bold tracking-tight sm:inline">Tape</span>
          </Link>
          <nav ref={navRef} className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Link href={base} className={linkCls(isActive(base, true))}>Home</Link>
            <Link href={`${base}/screener`} className={linkCls(isActive(`${base}/screener`))}>Screener</Link>
            {groups.map((g) => (
              <button
                key={g.label}
                onClick={(e) => toggle(g.label, e)}
                aria-haspopup="menu"
                aria-expanded={open === g.label}
                className={
                  "flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md px-2 py-1 transition-colors " +
                  (groupActive(g) || open === g.label ? "bg-[var(--surface-hover)] text-[var(--text)]" : "text-[var(--text-3)] hover:text-[var(--text)]")
                }
              >
                {g.label}
                <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden className={"transition-transform " + (open === g.label ? "rotate-180" : "")}>
                  <path d="M2.5 4.5l3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ))}
            <Link href={`${base}/watchlist`} className={linkCls(isActive(`${base}/watchlist`))} title="Watchlist">★</Link>
          </nav>
        </div>
        <div className="flex items-center gap-1.5">
          <SearchBox universe={universe} stocks={stocks} />
          <a
            href="/guide.html"
            target="_blank"
            rel="noreferrer"
            title="New here? Open the walkthrough guide"
            className="hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-sm text-[var(--text-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] sm:inline-flex"
          >
            <span aria-hidden className="text-[13px] text-[var(--text-4)]">📖</span> Guide
          </a>
          <ThemeToggle />
        </div>
      </div>

      {/* Dropdown panel — fixed so it isn't clipped by the scrollable nav. */}
      {active && (
        <div
          ref={dropRef}
          role="menu"
          style={{ position: "fixed", left: pos.left, top: pos.top }}
          className="z-50 min-w-[190px] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl"
        >
          {active.items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              role="menuitem"
              onClick={() => setOpen(null)}
              className={
                "block rounded-md px-2.5 py-1.5 text-sm transition-colors " +
                (isActive(it.href) ? "bg-[var(--surface-hover)] text-[var(--text)]" : "text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]")
              }
            >
              {it.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}
