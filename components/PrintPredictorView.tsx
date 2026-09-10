"use client";

import { useMemo, useState } from "react";
import type { PrintPredictorFile, LivePrediction, OosBlock, PublishedModel } from "@/lib/printPredictor";

// Feature labels for the odds-ratio / contributor tables (the model's "why", in plain English).
const FEATURE_LABEL: Record<string, string> = {
  toneScore: "Call tone", guideDelta: "Guidance action", qaDirectness: "Q&A directness",
  nKpis: "KPIs cited", nDrivers: "Drivers cited", nWatch: "Risks flagged", nReadThrough: "Read-throughs",
  priorSurprisePct: "Prior EPS surprise", priorMovePct: "Prior reaction", logMktCap: "Size (log mkt-cap)",
};
const feat = (k: string) => FEATURE_LABEL[k] ?? k;

const pct = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const num = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));
const ci = (c: [number, number] | null | undefined, d = 2) => (c ? `[${c[0].toFixed(d)}, ${c[1].toFixed(d)}]` : "—");

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "var(--surface-2)" }}>
      <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 650, color: "var(--text)", marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function OddsTable({ model }: { model: PublishedModel }) {
  const rows = model.oddsRatios.slice(0, 8);
  if (!rows.length) return <p style={{ color: "var(--text-dim)", fontSize: 13 }}>No model fit yet.</p>;
  return (
    <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ color: "var(--text-dim)", textAlign: "left" }}>
          <th style={{ padding: "4px 8px" }}>Feature</th>
          <th style={{ padding: "4px 8px", textAlign: "right" }}>Odds ratio</th>
          <th style={{ padding: "4px 8px", textAlign: "right" }}>Coef</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.feature} style={{ borderTop: "1px solid var(--border)" }}>
            <td style={{ padding: "4px 8px", color: "var(--text)" }}>{feat(o.feature)}</td>
            <td style={{ padding: "4px 8px", textAlign: "right", color: o.oddsRatio >= 1 ? "var(--pos)" : "var(--neg)" }}>{o.oddsRatio.toFixed(2)}×</td>
            <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-dim)" }}>{o.coef >= 0 ? "+" : ""}{o.coef.toFixed(3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Scorecard({ title, oos, isReaction }: { title: string; oos: OosBlock; isReaction?: boolean }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, background: "var(--surface-1)" }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 14, color: "var(--text)" }}>{title}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
        <Tile label="AUC" value={num(oos.auc)} sub={oos.auc == null ? "n/a" : oos.auc > 0.55 ? "some edge" : oos.auc < 0.5 ? "worse than chance" : "≈ chance"} />
        <Tile label="Hit rate" value={pct(oos.hit, 0)} sub={`balanced ${pct(oos.balanced, 0)}`} />
        {isReaction && <Tile label="Rank-IC" value={num(oos.rankIC)} sub={`CI ${ci(oos.rankICCI)}`} />}
        {isReaction && <Tile label="Long-short edge" value={oos.longShortEdge == null ? "—" : `${oos.longShortEdge.toFixed(2)}pp`} sub={`CI ${ci(oos.edgeCI)}`} />}
        <Tile label="Brier" value={num(oos.brier, 3)} sub={`calib gap ${num(oos.reliability, 3)}`} />
        <Tile label="Sample" value={`${oos.nOOS}`} sub={`${oos.cohorts} cohorts OOS`} />
      </div>
    </div>
  );
}

export default function PrintPredictorView({ universe, data, live }: { universe: string; data: PrintPredictorFile | null; live: LivePrediction[] }) {
  const [sortByReaction, setSortByReaction] = useState(true);
  const rows = useMemo(() => {
    const r = [...live];
    r.sort((a, b) => ((sortByReaction ? b.predReactUpProb ?? -1 : b.predBeatProb ?? -1) - (sortByReaction ? a.predReactUpProb ?? -1 : a.predBeatProb ?? -1)));
    return r;
  }, [live, sortByReaction]);

  if (!data) {
    return (
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 16px" }}>
        <h1 style={{ fontSize: 22, color: "var(--text)" }}>Earnings Print Predictor</h1>
        <p style={{ color: "var(--text-dim)", marginTop: 12 }}>
          No prediction feed yet. The model builds once enough earnings-call transcripts are digested and paired into
          consecutive-quarter examples — the nightly job keeps this empty (rather than shipping an untrained model) until then.
        </p>
      </main>
    );
  }

  const dim = { color: "var(--text-dim)", fontSize: 12 };
  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: 22, color: "var(--text)", marginBottom: 4 }}>Earnings Print Predictor</h1>
      <p style={dim}>
        Reads each earnings call's tone &amp; guidance to predict the <strong>next</strong> print — graded walk-forward,
        out-of-sample. Model trained on {data.universe.toUpperCase()}
        {data.universe.toLowerCase() !== universe.toLowerCase() ? ` (live calls below scoped to ${universe.toUpperCase()})` : ""}
        {" · built "}{new Date(data.generatedAt).toLocaleString()}
        {data.trainedThrough ? ` · trained through ${data.trainedThrough}` : ""}
        {data.baseRates.beat != null ? ` · base beat rate ${pct(data.baseRates.beat, 0)}` : ""}
        {data.baseRates.up != null ? ` · base up rate ${pct(data.baseRates.up, 0)}` : ""}
      </p>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 16 }}>
        <Scorecard title="Post-call price reaction (the deeper backtest)" oos={data.oos.reaction} isReaction />
        <Scorecard title="Next-quarter beat / miss (label-shallow — see method)" oos={data.oos.beatMiss} />
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 16 }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, background: "var(--surface-1)" }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "var(--text)" }}>Reaction model — what drives it</h3>
          <OddsTable model={data.models.reaction} />
        </div>
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, background: "var(--surface-1)" }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "var(--text)" }}>Beat/miss model — what drives it</h3>
          <OddsTable model={data.models.beatMiss} />
        </div>
      </section>

      <section style={{ marginTop: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ fontSize: 16, color: "var(--text)", margin: 0 }}>Live calls · {rows.length} names</h2>
          <button
            onClick={() => setSortByReaction((s) => !s)}
            style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}
          >
            sort by {sortByReaction ? "reaction ▾" : "beat prob ▾"}
          </button>
        </div>
        {rows.length === 0 ? (
          <p style={dim}>No live predictions for {universe.toUpperCase()} yet — a name lights up here once its latest call is digested.</p>
        ) : (
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr style={{ color: "var(--text-dim)", textAlign: "left", background: "var(--surface-2)" }}>
                  <th style={{ padding: "8px 10px" }}>Symbol</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>P(beat)</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>P(react up)</th>
                  <th style={{ padding: "8px 10px" }}>Top drivers</th>
                  <th style={{ padding: "8px 10px" }}>Call</th>
                  <th style={{ padding: "8px 10px" }}>Conf.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.symbol}-${r.fiscalPeriod}`} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 10px", color: "var(--text)", fontWeight: 600 }}>{r.symbol}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: "var(--text)" }}>{pct(r.predBeatProb, 0)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: "var(--text)" }}>{pct(r.predReactUpProb, 0)}</td>
                    <td style={{ padding: "8px 10px", color: "var(--text-dim)" }}>
                      {r.topContributors.map((c) => `${feat(c.feature)} ${c.contribPp >= 0 ? "+" : ""}${c.contribPp}`).join(" · ") || "—"}
                    </td>
                    <td style={{ padding: "8px 10px", color: "var(--text-dim)" }}>{r.callDate}</td>
                    <td style={{ padding: "8px 10px", color: "var(--text-dim)" }}>{r.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14, color: "var(--text)", marginBottom: 6 }}>How to read this</h2>
        <ul style={{ ...dim, paddingLeft: 18, lineHeight: 1.6 }}>
          {data.method.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
        <p style={{ ...dim, marginTop: 8, fontStyle: "italic" }}>{data.oos.verdict}</p>
      </section>
    </main>
  );
}
