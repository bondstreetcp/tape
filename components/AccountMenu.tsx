"use client";
/** Header account control: Google sign-in when signed out, avatar → sign-out menu when signed in.
 *  Renders nothing until Supabase auth is configured, so the header is unchanged pre-setup. */
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { browserSupabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/supabase/useUser";

export default function AccountMenu() {
  const { user, loading, enabled } = useUser();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (!enabled || loading) return null;

  const signIn = async () => {
    const sb = browserSupabase();
    if (!sb) return;
    await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(pathname || "/")}` },
    });
  };
  const signOut = async () => {
    const sb = browserSupabase();
    if (!sb) return;
    await sb.auth.signOut();
    setOpen(false);
  };

  if (!user) {
    return (
      <button
        onClick={signIn}
        className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] sm:inline-flex"
      >
        <svg width="14" height="14" viewBox="0 0 18 18" aria-hidden>
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z" />
          <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34z" />
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
        </svg>
        Sign in
      </button>
    );
  }

  const meta = (user.user_metadata || {}) as { name?: string; full_name?: string; avatar_url?: string };
  const name = meta.name || meta.full_name || user.email || "Account";
  const initial = (name.trim()[0] || "?").toUpperCase();

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={user.email || name}
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)]"
      >
        {meta.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={meta.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          initial
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-56 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-md)]">
          <div className="px-2.5 py-2">
            <div className="truncate text-sm font-medium text-[var(--text)]">{name}</div>
            {user.email && name !== user.email && <div className="truncate text-xs text-[var(--text-4)]">{user.email}</div>}
          </div>
          <div className="my-1 border-t border-[var(--divider)]" />
          <button
            onClick={signOut}
            className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
