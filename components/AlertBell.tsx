"use client";
/** Header bell → in-app alert center. Polls alert_events for the signed-in user, shows an unread
 *  badge, lists recent alerts, and marks them read. Renders nothing when signed out / unconfigured. */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { browserSupabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/supabase/useUser";
import { type AlertEvent, KIND_COLOR } from "@/lib/alerts";

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

export default function AlertBell({ base }: { base: string }) {
  const { user, enabled } = useUser();
  const [rows, setRows] = useState<AlertEvent[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const sb = browserSupabase();
    if (!sb || !user) return;
    const { data } = await sb
      .from("alert_events")
      .select("id,rule_id,symbol,kind,title,body,href,fired_at,read_at")
      .order("fired_at", { ascending: false })
      .limit(40);
    if (data) setRows(data as AlertEvent[]);
  }, [user]);

  useEffect(() => {
    if (!user) {
      setRows([]);
      return;
    }
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [user, load]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (!enabled || !user) return null;

  const unread = rows.filter((r) => !r.read_at).length;

  const markAllRead = async () => {
    const sb = browserSupabase();
    if (!sb) return;
    const ids = rows.filter((r) => !r.read_at).map((r) => r.id);
    if (!ids.length) return;
    setRows((prev) => prev.map((r) => (r.read_at ? r : { ...r, read_at: new Date().toISOString() })));
    await sb.from("alert_events").update({ read_at: new Date().toISOString() }).in("id", ids);
  };

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (next && unread) void markAllRead();
      return next;
    });
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={toggle}
        title="Alerts"
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M10 2.5a4.5 4.5 0 0 0-4.5 4.5c0 3.5-1.2 4.9-1.8 5.6-.3.3-.1.9.4.9h11.8c.5 0 .7-.6.4-.9-.6-.7-1.8-2.1-1.8-5.6A4.5 4.5 0 0 0 10 2.5Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M8.5 16a1.6 1.6 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ef4444] px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1.5 max-h-[70vh] w-[340px] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-md)]">
          <div className="flex items-center justify-between px-2.5 py-2">
            <span className="text-sm font-semibold text-[var(--text)]">Alerts</span>
            <Link href={`${base}/alerts`} onClick={() => setOpen(false)} className="text-xs text-[var(--accent)] hover:underline">
              Manage
            </Link>
          </div>
          {rows.length === 0 ? (
            <div className="px-2.5 py-6 text-center text-[13px] text-[var(--text-4)]">
              No alerts yet. Create rules from a stock page or the <Link href={`${base}/alerts`} onClick={() => setOpen(false)} className="text-[var(--accent)] hover:underline">Alerts</Link> page.
            </div>
          ) : (
            <ul className="pb-1">
              {rows.map((r) => {
                const inner = (
                  <div className={"rounded-md px-2.5 py-2 " + (r.read_at ? "" : "bg-[var(--surface-hover)]/60")}>
                    <div className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[r.kind] || "var(--text-4)" }} />
                      {r.symbol && <span className="font-mono text-[12px] font-semibold text-[var(--accent)]">{r.symbol}</span>}
                      <span className="text-[13px] font-medium text-[var(--text)]">{r.title}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-[var(--text-4)]">{ago(r.fired_at)}</span>
                    </div>
                    {r.body && <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--text-3)]">{r.body}</div>}
                  </div>
                );
                return (
                  <li key={r.id} className="border-b border-[var(--divider)] last:border-0">
                    {r.href ? <Link href={r.href} onClick={() => setOpen(false)} className="block hover:bg-[var(--surface-hover)]">{inner}</Link> : inner}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
