"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import SearchBox from "./SearchBox";
import ThemeToggle from "./ThemeToggle";

export default function AppHeader({
  universe,
  stocks,
}: {
  universe: string;
  stocks: { symbol: string; name: string }[];
}) {
  const pathname = usePathname();
  const base = `/u/${universe}`;

  const NavLink = ({ href, label, exact = false }: { href: string; label: string; exact?: boolean }) => {
    const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
    return (
      <Link
        href={href}
        className={
          "shrink-0 whitespace-nowrap rounded-md px-2 py-1 transition-colors " +
          (active ? "bg-[var(--surface-hover)] text-[var(--text)]" : "text-[var(--text-3)] hover:text-[var(--text)]")
        }
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--divider)] bg-[var(--bg)]/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <Link href={base} className="mr-1 flex shrink-0 items-center gap-1.5 font-semibold text-[var(--text)]">
            <span className="text-[#60a5fa]">▦</span>
            <span className="hidden font-bold tracking-tight sm:inline">Tape</span>
          </Link>
          <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <NavLink href={base} label="Home" exact />
            <NavLink href={`${base}/screener`} label="Screener" />
            <NavLink href={`${base}/heatmap`} label="Heatmap" />
            <NavLink href={`${base}/market`} label="Markets" />
            <NavLink href={`${base}/flow`} label="Options" />
            <NavLink href={`${base}/macro`} label="Economy" />
            <NavLink href={`${base}/rotation`} label="Sectors" />
            <NavLink href={`${base}/research`} label="Filings" />
            <NavLink href={`${base}/earnings`} label="Earnings" />
            <NavLink href={`${base}/compare`} label="Compare" />
            <NavLink href={`${base}/backtest`} label="Backtest" />
            <NavLink href={`${base}/briefing`} label="Briefing" />
            <NavLink href={`${base}/watchlist`} label="★" />
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
    </header>
  );
}
