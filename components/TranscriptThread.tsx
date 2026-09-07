import type { ReactNode } from "react";
import { splitIntoBubbles, type TranscriptTurn } from "@/lib/transcriptTurns";

/**
 * Presentational iMessage-style thread for an earnings call: management in accent bubbles (right),
 * analysts/operator on the left. Each speaker turn is broken into several short bubbles (splitIntoBubbles)
 * so prepared remarks read like a real chat instead of one wall of text. Pure render — no hooks, so it works
 * in both server (the standalone reader page) and client (the inline Filings & Calls section) trees.
 */
export default function TranscriptThread({ turns }: { turns: TranscriptTurn[] }) {
  const out: ReactNode[] = [];
  let prevKey = "";
  turns.forEach((t, i) => {
    if (t.side === "operator") {
      prevKey = "";
      out.push(
        <div key={`${i}op`} style={{ textAlign: "center", margin: "16px 0 6px" }}>
          <span style={{ fontSize: 11, color: "var(--text-4)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 999, padding: "3px 10px" }}>
            Operator{t.text.length < 160 ? ` · ${t.text}` : ""}
          </span>
        </div>,
      );
      if (t.text.length >= 160) splitIntoBubbles(t.text).forEach((b, j) => out.push(<Bubble key={`${i}o${j}`} side="analyst" text={b} />));
      return;
    }
    const right = t.side === "mgmt";
    const key = `${t.side}|${t.speaker}`;
    if (key !== prevKey && (t.speaker || t.role)) {
      out.push(
        <div key={`${i}h`} style={{ fontSize: 11, color: "var(--text-3)", margin: "14px 6px 4px", textAlign: right ? "right" : "left" }}>
          <span style={{ fontWeight: 600, color: "var(--text-2)" }}>{t.speaker || (right ? "Management" : "Analyst")}</span>
          {t.role ? <span> · {t.role}</span> : null}
        </div>,
      );
    }
    prevKey = key;
    splitIntoBubbles(t.text).forEach((b, j) => out.push(<Bubble key={`${i}-${j}`} side={t.side} text={b} />));
  });
  return <div>{out}</div>;
}

function Bubble({ side, text }: { side: TranscriptTurn["side"]; text: string }) {
  const right = side === "mgmt";
  return (
    <div style={{ display: "flex", justifyContent: right ? "flex-end" : "flex-start", marginBottom: 3 }}>
      <div
        style={{
          maxWidth: "82%", padding: "8px 13px", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap",
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          borderBottomRightRadius: right ? 5 : 16, borderBottomLeftRadius: right ? 16 : 5,
          ...(right
            ? { background: "var(--accent)", color: "#fff" }
            : { background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)" }),
        }}
      >
        {text}
      </div>
    </div>
  );
}
