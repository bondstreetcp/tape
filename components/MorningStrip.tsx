"use client";
import Link from "next/link";
import { useMyNamesNewCount } from "./MyNamesBadge";

// The morning dispatcher — three tiles at the top of Home answering the wake-up questions in
// order: what happened (Desk Brief) → anything in MY names (ledger cursor count) → anything new
// worth a look (Idea Inbox arrivals). Server passes the desk/ideas facts; the my-names count is
// client state (the same sessionStorage-TTL'd fetch as the top-bar badge — one number everywhere).

const ago = (iso: string | null): string => {
  if (!iso) return "";
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (!Number.isFinite(h) || h < 0) return "";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 36) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

function Tile({ href, title, value, sub, accent }: { href: string; title: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Link href={href} className="group flex min-w-0 flex-1 flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 transition-colors hover:border-[var(--border-strong)]">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{title}</span>
      <span className={"mt-0.5 truncate text-sm font-semibold " + (accent ? "text-[var(--accent)]" : "text-[var(--text)]")}>{value}</span>
      {sub && <span className="truncate text-[11px] text-[var(--text-4)]">{sub}</span>}
    </Link>
  );
}

export default function MorningStrip({
  universe,
  desk,
  ideasToday,
  ideasWeek,
}: {
  universe: string;
  desk: { generatedAt: string; run: string } | null;
  /** null = the signal log isn't available on this box/universe (intl) — the tile hides */
  ideasToday: number | null;
  ideasWeek: number | null;
}) {
  const { count, names } = useMyNamesNewCount();
  const base = `/u/${universe}`;
  return (
    <div className="mb-5 flex flex-col gap-2 sm:flex-row">
      <Tile
        href={`${base}/morning-desk`}
        title="Desk brief"
        value={desk ? `${desk.run === "evening" ? "Evening" : "Morning"} run · ${ago(desk.generatedAt)}` : "Not built yet"}
        sub="movers · filings · flow · analyst actions"
      />
      <Tile
        href={`${base}/my-names`}
        title="My names"
        value={names === 0 ? "Set up your list" : count > 0 ? `${count} new event${count !== 1 ? "s" : ""}` : count === 0 ? "Nothing new" : `${names} monitored`}
        sub={names === 0 ? "star names or paste your book" : "since you last looked"}
        accent={count > 0}
      />
      {ideasToday != null && (
        <Tile
          href={`${base}/ideas`}
          title="Idea inbox"
          value={`${ideasToday} arrival${ideasToday !== 1 ? "s" : ""} today`}
          sub={ideasWeek != null ? `${ideasWeek} this week across the boards` : undefined}
          accent={ideasToday > 0}
        />
      )}
    </div>
  );
}
