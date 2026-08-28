"use client";
import { useEffect, useState } from "react";
import { LATEST } from "@/lib/changelog";

// First-load "What's new" splash — shows the latest changelog entry + the build stamp once per release
// (keyed on LATEST.id in localStorage), then never again until the id is bumped. Renders nothing on the
// server / first client paint (decision is localStorage-only) so there's no hydration mismatch.
export default function WhatsNew() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let seen = "";
    try { seen = localStorage.getItem("tape.whatsnew") || ""; } catch { /* no localStorage */ }
    if (seen === LATEST.id) return;
    const t = setTimeout(() => setShow(true), 700); // let the page paint first
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => { setShow(false); try { localStorage.setItem("tape.whatsnew", LATEST.id); } catch { /* ignore */ } };

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  if (!show) return null;
  const version = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";
  const sha = process.env.NEXT_PUBLIC_GIT_SHA || "dev";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="What's new">
      <div className="absolute inset-0 bg-black/50" onClick={dismiss} />
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl">
        <div className="mb-1 flex shrink-0 items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--text)]">What&apos;s new</h2>
          <span className="shrink-0 font-mono text-[10px] text-[var(--text-4)]" title={`build ${sha}`}>v{version}·{sha}</span>
        </div>
        <div className="mb-3 shrink-0 text-[12px] text-[var(--text-4)]">{LATEST.date} · {LATEST.title}</div>
        <ul className="-mr-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-2 text-[13px] leading-snug text-[var(--text-2)]">
          {LATEST.items.map((it, i) => (
            <li key={i} className="flex gap-2"><span className="shrink-0 text-[var(--accent)]">▸</span> <span>{it}</span></li>
          ))}
        </ul>
        <div className="mt-4 flex shrink-0 justify-end border-t border-[var(--divider)] pt-3">
          <button onClick={dismiss} className="rounded-lg bg-[var(--accent-strong)] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90">Got it</button>
        </div>
      </div>
    </div>
  );
}
