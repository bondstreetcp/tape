"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Feedback box — one click from anywhere, with the context already attached.
 *
 * The point isn't the textarea; it's that every report arrives carrying WHICH PAGE, WHICH BUILD and
 * WHICH UNIVERSE it came from. Verbal reports ("the earnings section isn't loading", "it hasn't
 * updated since Wednesday") each cost a diagnostic round-trip to place; captured here they arrive
 * already placed. The context is shown to the sender before they submit — nothing is collected that
 * they can't see.
 *
 * Sits beside the build stamp so the two ops affordances live together, and stays out of print.
 */
const KINDS = [
  { id: "bug", label: "Something's broken" },
  { id: "data", label: "Data looks wrong" },
  { id: "idea", label: "Idea / request" },
] as const;

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("bug");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<{ status: "idle" | "sending" | "sent" | "error"; detail?: string }>({ status: "idle" });
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const build = `v${process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0"}·${process.env.NEXT_PUBLIC_GIT_SHA || "dev"}`;
  const pathname = usePathname() || "";
  // /u/<universe>/<rest> — surfacing it means a report from the Nasdaq view isn't debugged against S&P.
  const universe = /^\/u\/([^/]+)/.exec(pathname)?.[1] ?? "";

  useEffect(() => {
    if (open) areaRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    // capture: close only THIS panel, not whatever modal sits underneath (the stacked-Escape lesson)
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const send = async () => {
    if (!message.trim() || state.status === "sending") return;
    setState({ status: "sending" });
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, kind, page: pathname, build, universe }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setState({ status: "sent" });
        setMessage("");
        setTimeout(() => { setOpen(false); setState({ status: "idle" }); }, 1400);
      } else {
        setState({ status: "error", detail: j?.error || `Server said ${res.status}.` });
      }
    } catch (e: any) {
      setState({ status: "error", detail: String(e?.message || e).slice(0, 140) });
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="feedback-fab"
        title="Send feedback — the page, build and universe are attached automatically"
        aria-label="Send feedback"
      >
        Feedback
      </button>

      {open && (
        <div className="feedback-panel" role="dialog" aria-label="Send feedback">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[var(--text)]">Send feedback</span>
            <button onClick={() => setOpen(false)} className="text-[var(--text-4)] hover:text-[var(--text)]" aria-label="Close">✕</button>
          </div>

          <div className="mb-2 inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
            {KINDS.map((k) => (
              <button
                key={k.id}
                onClick={() => setKind(k.id)}
                className={"rounded-md px-2 py-1 text-[11px] font-medium transition-colors " + (kind === k.id ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}
              >
                {k.label}
              </button>
            ))}
          </div>

          <textarea
            ref={areaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); }}
            rows={4}
            maxLength={4000}
            placeholder={kind === "data" ? "Which number looks wrong, and what did you expect?" : kind === "idea" ? "What would you like it to do?" : "What were you doing, and what happened?"}
            className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-[13px] outline-none placeholder:text-[var(--text-4)]"
          />

          <div className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-4)]">
            Attached automatically: <span className="font-mono">{pathname || "/"}</span> · build <span className="font-mono">{build}</span>
            {universe ? <> · universe <span className="font-mono">{universe}</span></> : null}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={send}
              disabled={!message.trim() || state.status === "sending"}
              className="rounded-lg bg-[var(--accent-strong)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {state.status === "sending" ? "Sending…" : state.status === "sent" ? "Sent ✓" : "Send"}
            </button>
            <span className="text-[11px] text-[var(--text-4)]">⌘/Ctrl+Enter</span>
          </div>

          {state.status === "error" && (
            <div className="mt-2 rounded-lg px-2 py-1.5 text-[11.5px]" style={{ color: "#ef4444", background: "color-mix(in oklab, #ef4444 12%, transparent)" }}>
              {state.detail} — nothing was sent, so please pass it along another way.
            </div>
          )}
        </div>
      )}
    </>
  );
}
