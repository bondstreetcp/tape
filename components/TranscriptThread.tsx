"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { splitIntoBubbles, type TranscriptTurn } from "@/lib/transcriptTurns";

/**
 * Reading view for an earnings call — a left-aligned transcript DOCUMENT (not an iMessage thread, which turns
 * long prepared remarks into a hard-to-read wall of right-aligned bubbles). Each speaker is a block: a name label
 * coloured by role + a left-border stripe (management = accent, analyst = neutral), remarks as comfortable
 * dark-on-light paragraphs. "Prepared remarks" / "Questions & Answers" dividers; analyst questions are a tinted
 * "Q" block (tighter spacing); the operator is a centred divider.
 *
 * A STICKY toolbar heads the transcript: in-call search (highlights matches, ↑/↓ to cycle, auto-expands the
 * collapsed remarks so matches are visible) + a horizontally-scrolling "Jump" speaker index. Long prepared remarks
 * COLLAPSE behind a "Show full prepared remarks" toggle (when a Q&A exists to land on); the Q&A is always shown.
 * Scrolling (jump + match nav) is scoped to the nearest scroll container (the inline 560px box) so it never yanks
 * the whole stock page; window-scroll fallback on the standalone page.
 *
 * `surfaceVar` is the background the sticky bar + collapse fade blend into (inline: --surface; standalone page: --bg).
 * Client component; renders in both trees. Reset per quarter via a `key` on the caller.
 */
export default function TranscriptThread({ turns, surfaceVar = "var(--surface)", stickyTop = 0 }: { turns: TranscriptTurn[]; surfaceVar?: string; stickyTop?: number }) {
  const firstAnalyst = turns.findIndex((t) => t.side === "analyst");
  const qaStart = firstAnalyst === -1 ? turns.length : firstAnalyst;
  const prepared = turns.slice(0, qaStart);
  const qa = turns.slice(qaStart);
  const preparedChars = prepared.reduce((n, t) => n + (t.text?.length || 0), 0);
  const collapsible = preparedChars > 1400 && qa.length > 0; // only worth collapsing when there's a Q&A to land on

  const [open, setOpen] = useState(false);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLSpanElement>(null);
  const currentMatch = useRef(-1);

  const q = query.trim().toLowerCase();
  const searching = q.length >= 2; // ignore 0/1-char noise
  const showAll = open || searching; // searching forces the prepared section open so its matches are visible

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

  // Jump-to-speaker: scroll after the (possibly newly-expanded) target commits; re-run when open/searching flip.
  useEffect(() => {
    if (!pendingScrollId) return;
    const el = document.getElementById(pendingScrollId);
    if (el) {
      scrollToEl(el, (toolbarRef.current?.offsetHeight ?? 84) + 8);
      el.focus({ preventScroll: true });
    }
    setPendingScrollId(null);
  }, [pendingScrollId, open, searching]);

  // Recount highlighted matches whenever the query or expansion changes the rendered marks; reset the cursor.
  useEffect(() => {
    const marks = rootRef.current?.querySelectorAll("mark.tx-match");
    marks?.forEach((m) => m.classList.remove("tx-current"));
    currentMatch.current = -1;
    setMatchCount(marks?.length ?? 0);
  }, [q, showAll]); // NOT `turns` — a quarter change already remounts via the caller's key; keeping it here would refire on any unrelated parent re-render and wipe the active-match highlight

  const jumpTo = (slug: string, inPrepared: boolean) => {
    if (inPrepared && collapsible && !showAll) setOpen(true);
    setPendingScrollId("spk-" + slug);
  };

  const cycleMatch = (delta: number) => {
    const marks = rootRef.current?.querySelectorAll("mark.tx-match");
    if (!marks || !marks.length) return;
    const base = currentMatch.current < 0 && delta < 0 ? 0 : currentMatch.current; // first ↑ lands on the last match
    const next = (base + delta + marks.length) % marks.length;
    currentMatch.current = next;
    marks.forEach((m, i) => m.classList.toggle("tx-current", i === next));
    if (liveRef.current) liveRef.current.textContent = `Match ${next + 1} of ${marks.length}`;
    scrollToEl(marks[next], (toolbarRef.current?.offsetHeight ?? 84) + 8);
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
  const hl = searching ? q : "";

  return (
    <div ref={rootRef} style={{ maxWidth: 680, margin: "0 auto" }}>
      <style>{`.tx-match{background:rgba(245,197,66,.38);border-radius:3px;padding:0 1px}.tx-current{background:var(--accent);color:#fff}`}</style>
      <span ref={liveRef} aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }} />

      {/* Sticky toolbar: search + match nav, then the horizontally-scrolling jump index. `stickyTop` clears a fixed
          site header on the standalone page; z-index stays below the header's (40). */}
      <div ref={toolbarRef} style={{ position: "sticky", top: stickyTop, zIndex: 3, background: surfaceVar, borderBottom: "1px solid var(--border)", padding: "8px 0", marginBottom: 6 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this call…"
            aria-label="Search this earnings call"
            style={{ flex: 1, minWidth: 0, fontSize: 13, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
          />
          {searching && (
            <span aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-3)", whiteSpace: "nowrap" }}>
              {matchCount} {matchCount === 1 ? "match" : "matches"}
              <button onClick={() => cycleMatch(-1)} disabled={!matchCount} aria-label="Previous match" style={navBtn}>↑</button>
              <button onClick={() => cycleMatch(1)} disabled={!matchCount} aria-label="Next match" style={navBtn}>↓</button>
            </span>
          )}
        </div>
        {speakers.length >= 2 && (
          <div style={{ display: "flex", gap: 6, overflowX: "auto", marginTop: 8, scrollbarWidth: "thin" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-4)", alignSelf: "center", whiteSpace: "nowrap", paddingRight: 2 }}>Jump</span>
            {speakers.map((s) => (
              <button key={s.slug} onClick={() => jumpTo(s.slug, s.inPrepared)} style={chipStyle(s.side)}>{s.name}</button>
            ))}
          </div>
        )}
      </div>

      {prepared.length > 0 && (
        <>
          <SectionHeader label="Prepared remarks" />
          {collapsible && !showAll ? (
            <>
              <div style={{ position: "relative", maxHeight: 320, overflow: "hidden" }}>
                {renderTurns(prepared, false, idFor, hl)}
                <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 96, background: `linear-gradient(to bottom, transparent, ${surfaceVar})`, pointerEvents: "none" }} />
              </div>
              <ToggleButton onClick={() => setOpen(true)} label="Show full prepared remarks" dir="down" />
            </>
          ) : (
            <>
              {renderTurns(prepared, false, idFor, hl)}
              {collapsible && !searching && <ToggleButton onClick={() => setOpen(false)} label="Show less" dir="up" />}
            </>
          )}
        </>
      )}
      {qa.length > 0 && (
        <>
          <SectionHeader label="Questions & Answers" />
          {renderTurns(qa, true, idFor, hl)}
        </>
      )}
    </div>
  );
}

const navBtn: CSSProperties = { fontSize: 13, lineHeight: 1, padding: "2px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-2)", cursor: "pointer" };
function chipStyle(side: TranscriptTurn["side"]): CSSProperties {
  return {
    padding: "3px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
    border: `1px solid ${side === "mgmt" ? "var(--accent)" : "var(--border)"}`,
    color: side === "mgmt" ? "var(--accent)" : "var(--text-2)",
    background: "transparent",
  };
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

/** Scroll an element into view within its scroll container (offset clears the sticky toolbar); window fallback on the page. */
function scrollToEl(el: Element, offset: number) {
  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
  const node = el as HTMLElement;
  const scroller = nearestScrollable(node);
  if (scroller) {
    scroller.scrollTo({ top: node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - offset, behavior });
  } else {
    node.scrollIntoView({ behavior, block: "center" });
  }
}

/** Wrap case-insensitive matches of `q` (already lower-cased; "" = none) in <mark class="tx-match">. */
function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const out: ReactNode[] = [];
  const lower = text.toLowerCase();
  let i = 0, k = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) { out.push(text.slice(i)); break; }
    if (idx > i) out.push(text.slice(i, idx));
    out.push(<mark key={k++} className="tx-match">{text.slice(idx, idx + q.length)}</mark>);
    i = idx + q.length;
  }
  return out;
}

/** Speaker-grouped blocks for one contiguous list (prepared or Q&A). `dense` tightens the Q&A. Grouping resets between lists. */
function renderTurns(list: TranscriptTurn[], dense: boolean, idFor: (t: TranscriptTurn) => string | undefined, hl: string): ReactNode[] {
  const out: ReactNode[] = [];
  let prevKey = "";
  list.forEach((t, i) => {
    if (t.side === "operator") {
      prevKey = "";
      out.push(<OperatorLine key={`${i}op`} text={t.text} dense={dense} hl={hl} />);
      return;
    }
    const key = `${t.side}|${t.speaker}`;
    const showLabel = key !== prevKey;
    prevKey = key;
    out.push(<SpeakerBlock key={i} turn={t} showLabel={showLabel} dense={dense} id={showLabel ? idFor(t) : undefined} hl={hl} />);
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

function SpeakerBlock({ turn, showLabel, dense, id, hl }: { turn: TranscriptTurn; showLabel: boolean; dense: boolean; id?: string; hl: string }) {
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
        <p key={j} style={{ margin: `0 0 ${dense ? 6 : 9}px`, fontSize: dense ? 14 : 14.5, lineHeight: dense ? 1.55 : 1.62, color: "var(--text)" }}>{highlight(p, hl)}</p>
      ))}
    </div>
  );
}

function OperatorLine({ text, dense, hl }: { text: string; dense: boolean; hl: string }) {
  if (text.length < 180) {
    return (
      <div style={{ textAlign: "center", margin: dense ? "12px 0 8px" : "18px 0 10px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-4)" }}>Operator</div>
        <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>{highlight(text, hl)}</div>
      </div>
    );
  }
  return (
    <div style={{ margin: dense ? "12px 0 4px" : "16px 0 4px", paddingLeft: 14, borderLeft: "3px solid var(--border)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-4)", margin: "0 0 3px" }}>Operator</div>
      {splitIntoBubbles(text, 450).map((p, j) => (
        <p key={j} style={{ margin: `0 0 ${dense ? 6 : 9}px`, fontSize: 14, lineHeight: 1.55, color: "var(--text-3)" }}>{highlight(p, hl)}</p>
      ))}
    </div>
  );
}
