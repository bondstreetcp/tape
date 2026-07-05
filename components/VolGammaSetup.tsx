"use client";
import { useState, useEffect } from "react";
import { classifySetup, nearFlipPct, type Setup } from "@/lib/volGamma";
import { distToFlipPct } from "@/lib/gammaBoard";
import InfoDot from "./InfoDot";

// A compact "vol regime + dealer positioning + the fused setup" headline at the top of a name's Options
// tab — surfaces the Coiled-Springs read where people already look (one name at a time), from the two
// per-name routes (/api/vol-cone realized cone + /api/gamma dealer gamma). Reuses the tested classifier.

const pv = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);

const SETUP: Record<Exclude<Setup, "none">, { label: string; c: string; line: string }> = {
  coiled: { label: "Coiled spring", c: "#22c55e", line: "cheap realized vol + dealers set to amplify — buy optionality" },
  pinned: { label: "Pinned / quiet", c: "#60a5fa", line: "quiet + dealers long gamma dampening — sell premium" },
  blown: { label: "Blown out", c: "#f59e0b", line: "realized vol already stretched + dealers amplifying" },
};

// Percentile → plain-English vol-regime word.
function regimeWord(pct: number | null): { w: string; c: string } {
  if (pct == null) return { w: "—", c: "var(--text-4)" };
  if (pct <= 10) return { w: "very quiet", c: "#22c55e" };
  if (pct <= 25) return { w: "coiled", c: "#22c55e" };
  if (pct >= 90) return { w: "wild", c: "#ef4444" };
  if (pct >= 75) return { w: "elevated", c: "#f59e0b" };
  return { w: "normal", c: "var(--text-3)" };
}

interface Cone { pct: number | null; cur: number | null; med: number | null }
interface Gam { regime: "long" | "short"; distToFlip: number | null; spot: number | null; flip: number | null }

export default function VolGammaSetup({ symbol }: { symbol: string }) {
  const [cone, setCone] = useState<Cone | null | undefined>(undefined); // undefined = loading, null = none
  const [gam, setGam] = useState<Gam | null | undefined>(undefined);

  useEffect(() => {
    let off = false;
    setCone(undefined); setGam(undefined);
    fetch(`/api/vol-cone/${encodeURIComponent(symbol)}`).then((r) => r.json()).then((d) => {
      if (off) return;
      const b = Array.isArray(d?.bands) ? d.bands.find((x: any) => x.h === 21) : null;
      setCone(b ? { pct: b.pct ?? null, cur: b.cur ?? null, med: b.med ?? null } : null);
    }).catch(() => { if (!off) setCone(null); });
    fetch(`/api/gamma/${encodeURIComponent(symbol)}`).then((r) => r.json()).then((d) => {
      if (off) return;
      setGam(typeof d?.totalGex === "number" ? { regime: d.totalGex >= 0 ? "long" : "short", distToFlip: distToFlipPct(d.spot, d.flip ?? null), spot: d.spot ?? null, flip: d.flip ?? null } : null);
    }).catch(() => { if (!off) setGam(null); });
    return () => { off = true; };
  }, [symbol]);

  if (cone === undefined || gam === undefined) return null; // stay quiet until both resolve (no layout flash)
  if (!cone && !gam) return null; // nothing to say (no history + no options)

  const setup: Setup = cone?.pct != null && gam ? classifySetup(cone.pct, gam.regime, gam.distToFlip) : "none";
  const rw = regimeWord(cone?.pct ?? null);
  const near = gam ? nearFlipPct(gam.distToFlip, 3) : false;
  const gc = gam?.regime === "short" ? "#f59e0b" : "#22c55e";
  const su = setup === "none" ? null : SETUP[setup];

  return (
    <div className="rounded-xl border p-3" style={su ? { borderColor: `color-mix(in oklab, ${su.c} 45%, transparent)`, background: `color-mix(in oklab, ${su.c} 7%, var(--surface))` } : { borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {su ? (
          <span className="rounded px-2 py-0.5 text-[12px] font-bold" style={{ color: su.c, background: `color-mix(in oklab, ${su.c} 16%, transparent)` }}>{su.label}</span>
        ) : (
          <span className="text-[12px] font-semibold text-[var(--text-2)]">Vol &amp; positioning</span>
        )}

        {cone?.pct != null && (
          <span className="text-[12px] text-[var(--text-3)]">
            realized vol <span className="font-mono font-semibold text-[var(--text-2)]">{pv(cone.cur)}</span> · <span className="font-semibold" style={{ color: rw.c }}>{cone.pct.toFixed(0)}th pct</span> of its own history <InfoDot term="Realized vol cone" /> (<span style={{ color: rw.c }}>{rw.w}</span>)
          </span>
        )}

        {gam && (
          <span className="text-[12px] text-[var(--text-3)]">
            dealers <span className="font-semibold" style={{ color: gc }}>{gam.regime === "short" ? "short γ" : "long γ"}</span> <InfoDot term="Gamma exposure" />
            {gam.distToFlip != null && <> · <span style={near ? { color: gc, fontWeight: 600 } : undefined}>{Math.abs(gam.distToFlip).toFixed(1)}% {gam.distToFlip >= 0 ? "above" : "below"} the flip</span> <InfoDot term="Gamma flip" /></>}
          </span>
        )}
      </div>
      {su && <div className="mt-1 text-[11px] text-[var(--text-4)]">{su.line}.</div>}
    </div>
  );
}
