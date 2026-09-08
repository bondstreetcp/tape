import type { ReactNode } from "react";
import { splitIntoBubbles, type TranscriptTurn } from "@/lib/transcriptTurns";

/**
 * Reading view for an earnings call — a left-aligned transcript DOCUMENT (not an iMessage thread, which turns
 * long prepared remarks into a hard-to-read wall of right-aligned bubbles). Each speaker is a block: a name
 * label coloured by role + a left-border stripe (management = accent, analyst = neutral), with the remarks as
 * comfortable dark-on-light paragraphs. Section dividers separate "Prepared remarks" from "Questions & Answers",
 * analyst questions get a tinted "Q" block, and the operator is a centred divider. Pure render — no hooks, so it
 * works in both server (the standalone reader page) and client (the inline Filings & Calls section) trees.
 */
export default function TranscriptThread({ turns }: { turns: TranscriptTurn[] }) {
  const firstAnalyst = turns.findIndex((t) => t.side === "analyst");
  const firstSpeaker = turns.findIndex((t) => t.side !== "operator");
  // Only show a "Prepared remarks" header when there's management content BEFORE the Q&A begins.
  const prepIdx = firstSpeaker !== -1 && (firstAnalyst === -1 || firstSpeaker < firstAnalyst) ? firstSpeaker : -1;

  const out: ReactNode[] = [];
  let prevKey = "";
  turns.forEach((t, i) => {
    if (i === prepIdx) out.push(<SectionHeader key="prep" label="Prepared remarks" />);
    if (i === firstAnalyst && firstAnalyst !== -1) {
      out.push(<SectionHeader key="qa" label="Questions & Answers" />);
      prevKey = "";
    }
    if (t.side === "operator") {
      prevKey = "";
      out.push(<OperatorLine key={`${i}op`} text={t.text} />);
      return;
    }
    const key = `${t.side}|${t.speaker}`;
    const showLabel = key !== prevKey;
    prevKey = key;
    out.push(<SpeakerBlock key={i} turn={t} showLabel={showLabel} />);
  });

  return <div style={{ maxWidth: 680, margin: "0 auto" }}>{out}</div>;
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "24px 0 14px" }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-3)", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function SpeakerBlock({ turn, showLabel }: { turn: TranscriptTurn; showLabel: boolean }) {
  const isQuestion = turn.side === "analyst";
  const accent = turn.side === "mgmt" ? "var(--accent)" : "var(--text-3)";
  const paras = splitIntoBubbles(turn.text, 450); // paragraph-sized blocks, never tiny bubbles
  return (
    <div
      style={{
        borderLeft: `3px solid ${accent}`,
        paddingLeft: 14,
        margin: showLabel ? "12px 0 0" : "0",
        ...(isQuestion
          ? { background: "var(--surface-2)", borderRadius: 8, padding: "8px 14px", margin: showLabel ? "12px 0 4px" : "0 0 4px" }
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
        <p key={j} style={{ margin: "0 0 9px", fontSize: 14.5, lineHeight: 1.62, color: "var(--text)" }}>{p}</p>
      ))}
    </div>
  );
}

function OperatorLine({ text }: { text: string }) {
  if (text.length < 180) {
    return (
      <div style={{ textAlign: "center", margin: "18px 0 10px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-4)" }}>Operator</div>
        <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>{text}</div>
      </div>
    );
  }
  return (
    <div style={{ margin: "16px 0 4px", paddingLeft: 14, borderLeft: "3px solid var(--border)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-4)", margin: "0 0 3px" }}>Operator</div>
      {splitIntoBubbles(text, 450).map((p, j) => (
        <p key={j} style={{ margin: "0 0 9px", fontSize: 14, lineHeight: 1.6, color: "var(--text-3)" }}>{p}</p>
      ))}
    </div>
  );
}
