"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import SearchBox from "./SearchBox";

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
          "rounded-md px-2.5 py-1 transition-colors " +
          (active ? "bg-[#1a2030] text-[#e6e9f0]" : "text-[#8b93a7] hover:text-[#e6e9f0]")
        }
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[#1f2430] bg-[#0b0e14]/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <Link href={base} className="mr-1 flex shrink-0 items-center gap-1.5 font-semibold text-[#e6e9f0]">
            <span className="text-[#60a5fa]">▦</span>
            <span className="hidden sm:inline">Screener</span>
          </Link>
          <nav className="flex items-center gap-0.5 text-sm">
            <NavLink href={base} label="Home" exact />
            <NavLink href={`${base}/screener`} label="Screener" />
            <NavLink href={`${base}/market`} label="Markets" />
            <NavLink href={`${base}/compare`} label="Compare" />
            <NavLink href={`${base}/watchlist`} label="★" />
          </nav>
        </div>
        <SearchBox universe={universe} stocks={stocks} />
      </div>
    </header>
  );
}
