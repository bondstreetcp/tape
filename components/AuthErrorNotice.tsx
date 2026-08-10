"use client";
/** Surfaces the /?auth_error=1 bounce from the auth callback as a dismissible notice. Before this,
 *  a failed link exchange landed on Home with no explanation at all (2026-08-09: cost half an hour
 *  of blind debugging). Links fail for humane reasons — single-use, short expiry, or opened in a
 *  different browser than the one that requested them — so say that. */
import { useEffect, useState } from "react";

export default function AuthErrorNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth_error") !== "1") return;
    setShow(true);
    params.delete("auth_error");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
  }, []);

  if (!show) return null;
  return (
    <div className="fixed inset-x-0 top-16 z-[70] flex justify-center px-3">
      <div className="flex max-w-md items-start gap-2.5 rounded-lg border border-[#ef4444]/40 bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--text-2)] shadow-[var(--shadow-md)]">
        <span aria-hidden className="mt-0.5 text-[#ef4444]">⚠</span>
        <div>
          <div className="font-semibold text-[var(--text)]">Sign-in link didn&apos;t complete</div>
          Links are single-use, expire quickly, and must open in the same browser that requested them. Request a fresh
          one from <b>Sign in</b> — or type the 6-digit code from the email instead.
        </div>
        <button
          onClick={() => setShow(false)}
          aria-label="Dismiss"
          className="ml-1 shrink-0 text-[var(--text-4)] transition-colors hover:text-[var(--text)]"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
