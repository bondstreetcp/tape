"use client";
/** Header account control: email MAGIC-LINK sign-in when signed out (the beta-friendly method —
 *  passwordless, zero OAuth config; the shelf note's explicit pick), avatar → sign-out when in.
 *  Renders nothing until Supabase auth is configured, so the header is unchanged pre-setup. */
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { browserSupabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/supabase/useUser";

export default function AccountMenu() {
  const { user, loading, enabled } = useUser();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const [otp, setOtp] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpErr, setOtpErr] = useState("");
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

  const sendLink = async () => {
    const sb = browserSupabase();
    const addr = email.trim();
    if (!sb || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return;
    setState("sending");
    // Return-path travels in a cookie, NOT in emailRedirectTo: Supabase matches the redirect
    // against the allowlist INCLUDING the query string, so "?next=..." silently falls back to the
    // Site URL. Same-browser is already required (the PKCE verifier cookie), so a cookie is safe.
    document.cookie = `tape-next=${encodeURIComponent(pathname || "/")}; Max-Age=900; Path=/; SameSite=Lax`;
    const { error } = await sb.auth.signInWithOtp({
      email: addr,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setErrMsg(
        (error as { code?: string }).code === "over_email_send_rate_limit"
          ? "Email quota hit — the mailer only sends a few links per hour. Wait a bit, then try again."
          : error.message || "Couldn't send the link — try again.",
      );
    }
    setState(error ? "error" : "sent");
  };
  // Same-browser is only required by the LINK (its PKCE verifier cookie); the emailed 6-digit code
  // verifies from any browser — the escape hatch for in-app email viewers. Needs {{ .Token }} in
  // the Supabase Magic Link email template to actually appear in the email.
  const verifyCode = async () => {
    const sb = browserSupabase();
    const token = otp.trim();
    if (!sb || !/^\d{6}$/.test(token)) return;
    setOtpBusy(true);
    setOtpErr("");
    const { error } = await sb.auth.verifyOtp({ email: email.trim(), token, type: "email" });
    setOtpBusy(false);
    if (error) setOtpErr(/expired|invalid/i.test(error.message) ? "Code invalid or expired — send a fresh link and use its code." : error.message);
    else setOpen(false);
  };

  const signOut = async () => {
    const sb = browserSupabase();
    if (!sb) return;
    await sb.auth.signOut();
    setOpen(false);
  };

  if (!user) {
    return (
      <div ref={ref} className="relative shrink-0">
        <button
          onClick={() => { setOpen((v) => !v); setState("idle"); setOtp(""); setOtpErr(""); }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        >
          Sign in
        </button>
        {open && (
          <div className="absolute right-0 z-50 mt-1.5 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-md)]">
            {state === "sent" ? (
              <div className="text-sm text-[var(--text-2)]">
                <div className="mb-1 font-semibold text-[var(--text)]">Check your email</div>
                A sign-in link is on its way to <b>{email.trim()}</b>. Open it in <i>this browser</i> — or type the 6-digit code from the email:
                <div className="mt-2 flex gap-1.5">
                  <input
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    onKeyDown={(e) => { if (e.key === "Enter") void verifyCode(); }}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm tracking-widest outline-none placeholder:text-[var(--text-4)] focus:border-[var(--border-strong)]"
                  />
                  <button
                    onClick={() => void verifyCode()}
                    disabled={otpBusy || otp.length !== 6}
                    className="rounded-md bg-[var(--accent-strong)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {otpBusy ? "…" : "Verify"}
                  </button>
                </div>
                {otpErr && <div className="mt-1.5 text-xs text-[#ef4444]">{otpErr}</div>}
              </div>
            ) : (
              <>
                <div className="mb-1.5 text-sm font-semibold text-[var(--text)]">Sign in with a magic link</div>
                <p className="mb-2 text-xs text-[var(--text-4)]">No password — we email you a one-tap link. Your local watchlist merges into the account on first sign-in.</p>
                <div className="flex gap-1.5">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void sendLink(); }}
                    placeholder="you@example.com"
                    className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)] focus:border-[var(--border-strong)]"
                  />
                  <button
                    onClick={() => void sendLink()}
                    disabled={state === "sending"}
                    className="rounded-md bg-[var(--accent-strong)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {state === "sending" ? "…" : "Send"}
                  </button>
                </div>
                {state === "error" && <div className="mt-1.5 text-xs text-[#ef4444]">{errMsg}</div>}
              </>
            )}
          </div>
        )}
      </div>
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
