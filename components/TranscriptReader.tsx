/**
 * TranscriptReader — the human reading view for archived earnings calls (data/calls), rendered as a left-aligned
 * transcript DOCUMENT (see TranscriptThread): speaker blocks coloured by role, "Prepared remarks" / "Q&A"
 * dividers, the AI digest as a header card, and a quarter picker. Server component (pure rendering); the quarter
 * picker is plain links (?q=<period>) so each render ships only the selected call's turns.
 */
import type { CallDigest } from "@/lib/callDigests";
import type { TranscriptTurn } from "@/lib/transcriptTurns";
import TranscriptThread from "./TranscriptThread";

interface Quarter { period: string; callDate: string; href: string; active: boolean }
export interface TranscriptReaderData {
  period: string;
  callDate: string;
  title: string;
  source: string;
  url: string;
  digest: CallDigest | null;
  turns: TranscriptTurn[];
}

const TONE_EMOJI: Record<string, string> = { upbeat: "🟢", measured: "🟡", cautious: "🟠", defensive: "🔴" };
const GUIDE_LABEL: Record<string, string> = { raised: "▲ raised", cut: "▼ cut", reaffirmed: "= reaffirmed", initiated: "＋ initiated", withdrawn: "✕ withdrawn", mixed: "± mixed", none: "" };

export default function TranscriptReader({
  symbol,
  name,
  quarters,
  selected,
}: {
  symbol: string;
  name: string;
  quarters: Quarter[];
  selected: TranscriptReaderData | null;
}) {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 12px 64px" }}>
      <header style={{ padding: "16px 2px 8px" }}>
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>Earnings calls</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "2px 0 0", color: "var(--text)" }}>
          {name} <span style={{ color: "var(--text-3)", fontWeight: 500 }}>({symbol})</span>
        </h1>
      </header>

      {/* Quarter picker — newest first, horizontally scrollable pills */}
      {quarters.length > 0 && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "6px 2px 12px", scrollbarWidth: "thin" }}>
          {quarters.map((q) => (
            <a
              key={q.period}
              href={q.href}
              style={{
                flex: "0 0 auto", padding: "5px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, textDecoration: "none",
                border: "1px solid var(--border)",
                background: q.active ? "var(--accent)" : "var(--surface)",
                color: q.active ? "#fff" : "var(--text-2)",
              }}
            >
              {q.period.replace("-", " ")}
            </a>
          ))}
        </div>
      )}

      {!selected ? (
        <div style={{ color: "var(--text-3)", padding: "40px 4px", textAlign: "center", fontSize: 14 }}>
          No earnings-call transcripts archived yet for {symbol}. They populate as the backfill + ingestion run.
        </div>
      ) : (
        <>
          {/* AI digest card */}
          {selected.digest && (
            <section style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 14, padding: 14, marginBottom: 16 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 12, color: "var(--text-3)", marginBottom: 6 }}>
                <span style={{ fontWeight: 700, color: "var(--text-2)" }}>{selected.period.replace("-", " ")} · {selected.callDate}</span>
                <span>{TONE_EMOJI[selected.digest.tone] || ""} tone {selected.digest.tone}</span>
                {GUIDE_LABEL[selected.digest.guidance.action] && <span>guidance {GUIDE_LABEL[selected.digest.guidance.action]}</span>}
              </div>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "var(--text)" }}>{selected.digest.tldr}</p>
              {selected.digest.kpis.length > 0 && (
                <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
                  {selected.digest.kpis.slice(0, 5).map((k, i) => <li key={i}>{k}</li>)}
                </ul>
              )}
            </section>
          )}
          {!selected.digest && (
            <div style={{ fontSize: 12, color: "var(--text-4)", marginBottom: 12, fontStyle: "italic" }}>
              {selected.period.replace("-", " ")} · {selected.callDate} · AI digest pending ingestion — full transcript below.
            </div>
          )}

          {/* The transcript document (see TranscriptThread). stickyTop clears the sticky AppHeader (~48px) on this page. */}
          <TranscriptThread turns={selected.turns} surfaceVar="var(--bg)" stickyTop={52} />

          <footer style={{ marginTop: 20, fontSize: 11, color: "var(--text-4)", textAlign: "center" }}>
            Transcript via <a href={selected.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-3)" }}>{selected.source}</a>. Research, not advice.
          </footer>
        </>
      )}
    </div>
  );
}

