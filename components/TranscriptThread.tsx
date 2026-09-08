"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { splitIntoBubbles, type TranscriptTurn } from "@/lib/transcriptTurns";

/**
 * Reading view for an earnings call — a left-aligned transcript DOCUMENT (not an iMessage thread, which turns
 * long prepared remarks into a hard-to-read wall of right-aligned bubbles). Each speaker is a block: a name
 * label coloured by role + a left-border stripe (management = accent, analyst = neutral), remarks as comfortable
 * dark-on-light paragraphs. Section dividers separate "Prepared remarks" from "Questions & Answers"; analyst
 * questions get a tinted "Q" block (tighter spacing); the operator is a centred divider.
 *
 * A "Jump to speaker" index heads the transcript — click a name to scroll to their first turn (auto-expanding the
 * prepared remarks if that speaker sits inside the collapsed section). Long prepared remarks are COLLAPSED behind
 * a "Show full prepared remarks" toggle so the reader lands near the Q&A; the Q&A is always fully shown.
 *
 * `surfaceVar` is the background the collapse fade blends into (the inline section sits on --surface; the standalone
 * page passes --bg). Client component (toggle + jump state); renders in both the server page and the client Filings
 * & Calls section. Reset per quarter via a `key` on the caller.
 */
export default function TranscriptThread({ turns, surfaceVar = "var(--surface)" }: { turns: TranscriptTurn[]; surfaceVar?: string }) {
  const firstAnalyst = turns.findIndex((t) => t.side === "analyst");
  const qaStart = firstAnalyst === -1 ? turns.length : firstAnalyst;
  const prepared = turns.slice(0, qaStart);
  const qa = turns.slice(qaStart);
  const preparedChars = prepared.reduce((n, t) => n + (t.text?.length || 0), 0);
  const collapsible = preparedChars > 1400 && qa.length > 0; // only worth collapsing when there's a Q&A to land on

  const [open, setOpen] = useState(false);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);

  // Distinct speakers in first-appearance order → the jump index (+ which sit inside the collapsible prepared block).
  const speakers: { slug: string; name: string; side: TranscriptTurn["side"]; inPrepared: boolean }[] = [];
  const seenIndex = new Set<string>();
  turns.forEach((t, i) => {
    if (t.side === "operator" || !(t.speaker || t.role)) return;
    const slug = speakerSlug(t);
    if (seenIndex.has(slug)) return;
    seenIndex.add(slug);
    speakers.push({ slug, name: t.speaker || (t.side === "mgmt" ? "Management" : "Analyst"), side: t.side, inPrepared: i < qaStart });
  });

  // Scroll after the DOM has the (possibly newly-expanded) target. Re-runs when `open` flips so expand-then-scroll works.
  // Scope the scroll to the nearest scroll container (the inline reader's 560px box) so a jump doesn't yank the whole
  // stock page; fall back to window scroll on the standalone page (no inner scroller). Honour reduced-motion + move focus.
  useEffect(() => {
    if (!pendingScrollId) return;
    const el = document.getElementById(pendingScrollId);
    if (el) {
      const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
      const scroller = nearestScrollable(el);
      if (scroller) {
        scroller.scrollTo({ top: el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 8, behavior });
      } else {
        el.scrollIntoView({ behavior, block: "start" });
      }
      el.focus({ preventScroll: true }); // take keyboard/SR users to the content, not leave focus on the pill
    }
    setPendingScrollId(null);
  }, [pendingScrollId, open]);

  const jumpTo = (slug: string, inPrepared: boolean) => {
    if (inPrepared && collapsible && !open) setOpen(true);
    setPendingScrollId("spk-" + slug);
  };

  // First-seen id per speaker, shared across the prepared + Q&A render passes so the jump target is the global first turn.
  const assigned = new Set<string>();
  const idFor = (t: TranscriptTurn): string | undefined => {
    if (t.side === "operator" || !(t.speaker || t.role)) return undefined;
    const slug = speakerSlug(t);
    if (assigned.has(slug)) return undefined;
    assigned.add(slug);
    return "spk-" + slug;
  };

  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      {speakers.length >= 2 && (
        <div style={{ margin: "0 0 4px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-4)", margin: "0 0 6px" }}>Jump to speaker</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {speakers.map((s) => (
              <button
                key={s.slug}
                onClick={() => jumpTo(s.slug, s.inPrepared)}
                style={{
                  padding: "3px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                  border: `1px solid ${s.side === "mgmt" ? "var(--accent)" : "var(--border)"}`,
                  color: s.side === "mgmt" ? "var(--accent)" : "var(--text-2)",
                  background: "transparent",
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {prepared.length > 0 && (
        <>
          <SectionHeader label="Prepared remarks" />
          {collapsible && !open ? (
            <>
              <div style={{ position: "relative", maxHeight: 320, overflow: "hidden" }}>
                {renderTurns(prepared, false, idFor)}
                <div
                  aria-hidden
                  style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 96, background: `linear-gradient(to bottom, transparent, ${surfaceVar})`, pointerEvents: "none" }}
                />
              </div>
              <ToggleButton onClick={() => setOpen(true)} label="Show full prepared remarks" dir="down" />
            </>
          ) : (
            <>
              {renderTurns(prepared, false, idFor)}
              {collapsible && <ToggleButton onClick={() => setOpen(false)} label="Show less" dir="up" />}
            </>
          )}
        </>
      )}
      {qa.length > 0 && (
        <>
          <SectionHeader label="Questions & Answers" />
          {renderTurns(qa, true, idFor)}
        </>
      )}
    </div>
  );
}

function speakerSlug(t: TranscriptTurn): string {
  return `${t.side}-${(t.speaker || t.role || "x").toLowerCase()}`.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
}

/** Nearest ancestor that actually scrolls (the inline reader's overflow-y box), or null → the window is the scroller. */
function nearestScrollable(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** Speaker-grouped blocks for one contiguous list (prepared or Q&A). `dense` tightens the Q&A. Grouping resets between lists. */
function renderTurns(list: TranscriptTurn[], dense: boolean, idFor: (t: TranscriptTurn) => string | undefined): ReactNode[] {
  const out: ReactNode[] = [];
  let prevKey = "";
  list.forEach((t, i) => {
    if (t.side === "operator") {
      prevKey = "";
      out.push(<OperatorLine key={`${i}op`} text={t.text} dense={dense} />);
      return;
    }
    const key = `${t.side}|${t.speaker}`;
    const showLabel = key !== prevKey;
    prevKey = key;
    out.push(<SpeakerBlock key={i} turn={t} showLabel={showLabel} dense={dense} id={showLabel ? idFor(t) : undefined} />);
  });
  return out;
}

function ToggleButton({ onClick, label, dir }: { onClick: () => void; label: string; dir: "up" | "down" }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block", width: "100%", marginTop: 8, padding: "9px 0", fontSize: 12.5, fontWeight: 600,
        color: "var(--accent)", background: "transparent", border: "none", borderTop: "1px solid var(--border)", cursor: "pointer",
      }}
    >
      {label} {dir === "down" ? "↓" : "↑"}
    </button>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "22px 0 12px" }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-3)", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function SpeakerBlock({ turn, showLabel, dense, id }: { turn: TranscriptTurn; showLabel: boolean; dense: boolean; id?: string }) {
  const isQuestion = turn.side === "analyst";
  const accent = turn.side === "mgmt" ? "var(--accent)" : "var(--text-3)";
  const paras = splitIntoBubbles(turn.text, 450); // paragraph-sized blocks, never tiny bubbles
  const topGap = showLabel ? (dense ? 8 : 12) : 0;
  return (
    <div
      id={id}
      tabIndex={id ? -1 : undefined}
      style={{
        borderLeft: `3px solid ${accent}`,
        paddingLeft: 14,
        margin: `${topGap}px 0 0`,
        scrollMarginTop: 12,
        outline: "none",
        ...(isQuestion
          ? { background: "var(--surface-2)", borderRadius: 8, padding: dense ? "6px 12px" : "8px 14px", margin: `${topGap}px 0 3px` }
          : {}),
      }}
    >
      {showLabel && (
        <div style={{ fontSize: 12.5, fontWeight: 700, color: turn.side === "mgmt" ? "var(--text)" : "var(--text-2)", margin: "0 0 3px" }}>
          {isQuestion && <span style={{ color: accent, marginRight: 6 }}>Q</span>}
          {turn.speaker || (turn.side === "mgmt" ? "Management" : "Analyst")}
          {turn.role ? <span style={{ fontWeight: 400, color: "var(--text-3)" }}> · {turn.role}</span> : null}
        </div>
      )}
      {paras.map((p, j) => (
        <p key={j} style={{ margin: `0 0 ${dense ? 6 : 9}px`, fontSize: dense ? 14 : 14.5, lineHeight: dense ? 1.55 : 1.62, color: "var(--text)" }}>{p}</p>
      ))}
    </div>
  );
}

function OperatorLine({ text, dense }: { text: string; dense: boolean }) {
  if (text.length < 180) {
    return (
      <div style={{ textAlign: "center", margin: dense ? "12px 0 8px" : "18px 0 10px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-4)" }}>Operator</div>
        <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>{text}</div>
      </div>
    );
  }
  return (
    <div style={{ margin: dense ? "12px 0 4px" : "16px 0 4px", paddingLeft: 14, borderLeft: "3px solid var(--border)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-4)", margin: "0 0 3px" }}>Operator</div>
      {splitIntoBubbles(text, 450).map((p, j) => (
        <p key={j} style={{ margin: `0 0 ${dense ? 6 : 9}px`, fontSize: 14, lineHeight: 1.55, color: "var(--text-3)" }}>{p}</p>
      ))}
    </div>
  );
}
