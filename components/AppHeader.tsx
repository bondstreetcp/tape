"use client";
import Link from "next/link";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SearchBox from "./SearchBox";
import ThemeToggle from "./ThemeToggle";
import InstallPWA from "./InstallPWA";
import CommandPalette from "./CommandPalette";
import { FEATURES, NAV_GROUPS, GROUP_HUBS, hubForPath } from "@/lib/nav";

interface Item { href: string; label: string; desc?: string; job?: string }
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
  const [drawerOpen, setDrawerOpen] = useState(false); // mobile left slide-out nav
  const [mounted, setMounted] = useState(false); // portal the drawer to <body> only after hydration
  useEffect(() => { setMounted(true); }, []);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const navRef = useRef<HTMLElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  // Dropdown groups are derived from the shared feature registry (lib/nav.ts), so the
  // nav, the ⌘K palette, and the Start-here map never drift apart.
  const groups: Group[] = NAV_GROUPS.map((label) => ({
    label,
    items: FEATURES.filter((f) => f.group === label).map((f) => ({ href: `${base}${f.path}`, label: f.label, desc: f.desc, job: f.job })),
  }));

  // Close the dropdown + mobile drawer on navigation.
  useEffect(() => { setOpen(null); setDrawerOpen(false); }, [pathname]);
  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [drawerOpen]);
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
    (active
      ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
      : "text-[var(--text-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]");
  const drawerLink = (active: boolean) =>
    "block rounded-md px-3 py-2 text-[15px] transition-colors " +
    (active ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]" : "text-[var(--text-2)] hover:bg-[var(--surface-hover)]");

  const toggle = (label: string, e: React.MouseEvent) => {
    if (open === label) { setOpen(null); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ left: Math.round(r.left), top: Math.round(r.bottom + 5) });
    setOpen(label);
  };

  const active = groups.find((g) => g.label === open);

  // Secondary sub-nav: when on a Research hub page, show that hub's sibling tools as sub-tabs.
  const relPath = pathname.startsWith(base) ? pathname.slice(base.length) || "/" : pathname;
  const hub = hubForPath(relPath);

  return (
    <>
    <header
      className="sticky top-0 z-40 border-b border-[var(--divider)] bg-[var(--bg)]/90 backdrop-blur"
      // Clear the iOS status bar / notch when running as an installed PWA (0 in a normal browser).
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="-ml-1 shrink-0 rounded-md p-1.5 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] lg:hidden"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden><path d="M3 6h18M3 12h18M3 18h18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <Link href={base} className="mr-1 flex shrink-0 items-center gap-1.5 font-semibold text-[var(--text)]">
            <span className="text-[var(--accent)]">▦</span>
            <span className="font-bold tracking-tight">Tape</span>
          </Link>
          <nav ref={navRef} className="hidden min-w-0 items-center gap-0.5 overflow-x-auto text-sm lg:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Link href={base} className={linkCls(isActive(base, true))}>Home</Link>
            <Link href={`${base}/morning-desk`} className={linkCls(isActive(`${base}/morning-desk`))}>Morning Desk</Link>
            <Link href={`${base}/briefing`} className={linkCls(isActive(`${base}/briefing`))}>Daily Briefing</Link>
            <Link href={`${base}/screener`} className={linkCls(isActive(`${base}/screener`))}>Screener</Link>
            {groups.map((g) => (
              <button
                key={g.label}
                onClick={(e) => toggle(g.label, e)}
                aria-haspopup="menu"
                aria-expanded={open === g.label}
                className={
                  "flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md px-2 py-1 transition-colors " +
                  (groupActive(g)
                    ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                    : open === g.label
                      ? "bg-[var(--surface-hover)] text-[var(--text)]"
                      : "text-[var(--text-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]")
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
          <button
            onClick={() => window.dispatchEvent(new Event("open-cmdk"))}
            title="Jump to any feature or company (⌘K / Ctrl-K)"
            className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm text-[var(--text-3)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] sm:inline-flex"
          >
            <span aria-hidden>⌘</span>K
            <span className="text-[var(--text-4)]">· Jump to…</span>
          </button>
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
          <InstallPWA />
          <ThemeToggle />
        </div>
      </div>

      {/* Secondary sub-nav — sub-tabs within the active Research hub. */}
      {hub && (
        <div className="border-t border-[var(--divider)] bg-[var(--surface)]/50">
          <div className="mx-auto flex max-w-7xl items-center gap-0.5 overflow-x-auto px-4 py-1.5 text-[13px] sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <span className="shrink-0 pr-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{hub.label}</span>
            {hub.items.map((it) => {
              const href = `${base}${it.path}`;
              return <Link key={it.path} href={href} className={linkCls(isActive(href))}>{it.label}</Link>;
            })}
          </div>
        </div>
      )}

      {/* Dropdown panel — fixed so it isn't clipped by the scrollable nav. */}
      {active && (
        <div
          ref={dropRef}
          role="menu"
          style={{ position: "fixed", left: pos.left, top: pos.top }}
          className="z-50 w-[320px] max-w-[calc(100vw-1rem)] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-md)]"
        >
          {(() => {
            // Break a long menu into sub-groups by job-to-be-done (so e.g. Research splits into
            // "Find ideas" vs "Research a name"). One group → no header.
            // Research & Strategies are consolidated into HUBS (those menus got busy) — each opens a
            // page whose sub-nav bar reveals the rest. Other groups split by job-to-be-done.
            const hubs = GROUP_HUBS[active.label as keyof typeof GROUP_HUBS];
            if (hubs) {
              return hubs.map((h) => {
                const href = `${base}${h.paths[0]}`;
                const act = h.paths.some((p) => isActive(`${base}${p}`));
                return (
                  <Link key={h.label} href={href} role="menuitem" onClick={() => setOpen(null)}
                    className={"block rounded-md px-2.5 py-1.5 transition-colors " + (act ? "bg-[var(--surface-hover)]" : "hover:bg-[var(--surface-hover)]")}>
                    <div className={"text-sm font-medium " + (act ? "text-[var(--accent)]" : "text-[var(--text)]")}>{h.label}{h.paths.length > 1 && <span className="text-[10px] font-normal text-[var(--text-4)]"> · {h.paths.length} tools</span>}</div>
                    <div className="mt-0.5 text-xs leading-snug text-[var(--text-3)]">{h.blurb}</div>
                  </Link>
                );
              });
            }
            const jobs = [...new Set(active.items.map((it) => it.job))];
            const renderItem = (it: Item) => (
              <Link
                key={it.href}
                href={it.href}
                role="menuitem"
                onClick={() => setOpen(null)}
                className={
                  "block rounded-md px-2.5 py-1.5 transition-colors " +
                  (isActive(it.href) ? "bg-[var(--surface-hover)]" : "hover:bg-[var(--surface-hover)]")
                }
              >
                <div className={"text-sm font-medium " + (isActive(it.href) ? "text-[var(--accent)]" : "text-[var(--text)]")}>{it.label}</div>
                {it.desc && <div className="mt-0.5 text-xs leading-snug text-[var(--text-3)]">{it.desc}</div>}
              </Link>
            );
            if (jobs.length <= 1) return active.items.map(renderItem);
            return jobs.map((job) => (
              <div key={job}>
                <div className="px-2.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{job}</div>
                {active.items.filter((it) => it.job === job).map(renderItem)}
              </div>
            ));
          })()}
        </div>
      )}

      <CommandPalette universe={universe} />
    </header>

    {/* Mobile left slide-out nav — portaled to <body> so it fills the full viewport (a plain fixed
        element gets confined by the header's backdrop-filter containing block). */}
    {mounted && createPortal(
      <div className={"fixed inset-0 z-[60] lg:hidden " + (drawerOpen ? "" : "pointer-events-none")} aria-hidden={!drawerOpen}>
      <div className={"absolute inset-0 bg-black/50 transition-opacity duration-200 " + (drawerOpen ? "opacity-100" : "opacity-0")} onClick={() => setDrawerOpen(false)} />
      <div
        className={"absolute inset-y-0 left-0 flex w-[86%] max-w-[340px] flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--bg)] shadow-xl transition-transform duration-200 " + (drawerOpen ? "translate-x-0" : "-translate-x-full")}
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-center justify-between border-b border-[var(--divider)] px-4 py-3">
          <Link href={base} onClick={() => setDrawerOpen(false)} className="flex items-center gap-1.5 font-bold text-[var(--text)]"><span className="text-[var(--accent)]">▦</span> Tape</Link>
          <button onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="rounded-md p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-hover)]">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <nav className="flex-1 px-2 py-3">
          {[
            { path: "", label: "Home", exact: true },
            { path: "/morning-desk", label: "Morning Desk" },
            { path: "/briefing", label: "Daily Briefing" },
            { path: "/screener", label: "Screener" },
            { path: "/watchlist", label: "★ Watchlist" },
          ].map((m) => {
            const href = `${base}${m.path}`;
            return <Link key={m.path} href={href} className={drawerLink(isActive(href, (m as any).exact))}>{m.label}</Link>;
          })}
          {groups.map((g) => (
            <div key={g.label} className="mt-3">
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{g.label}</div>
              {g.items.map((it) => <Link key={it.href} href={it.href} className={drawerLink(isActive(it.href))}>{it.label}</Link>)}
            </div>
          ))}
          <a href="/guide.html" target="_blank" rel="noreferrer" className="mt-4 block rounded-md px-3 py-2 text-[15px] text-[var(--text-3)] hover:bg-[var(--surface-hover)]">📖 Guide</a>
        </nav>
      </div>
      </div>,
      document.body,
    )}
    </>
  );
}
