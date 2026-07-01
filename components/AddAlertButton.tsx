"use client";
/** "＋ Alert" button next to Watch on the stock page → the alerts page prefilled for this symbol.
 *  Hidden when signed out / unconfigured, so anonymous users see the header exactly as before. */
import Link from "next/link";
import { useUser } from "@/lib/supabase/useUser";

export default function AddAlertButton({ symbol, universe }: { symbol: string; universe: string }) {
  const { user, enabled } = useUser();
  if (!enabled || !user) return null;
  return (
    <Link
      href={`/u/${universe}/alerts?symbol=${encodeURIComponent(symbol)}`}
      title={`Create an alert for ${symbol}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[var(--text-3)] transition-colors hover:text-[var(--text)]"
    >
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M10 2.5a4.5 4.5 0 0 0-4.5 4.5c0 3.5-1.2 4.9-1.8 5.6-.3.3-.1.9.4.9h11.8c.5 0 .7-.6.4-.9-.6-.7-1.8-2.1-1.8-5.6A4.5 4.5 0 0 0 10 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      Alert
    </Link>
  );
}
