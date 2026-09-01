import { test } from "node:test";
import assert from "node:assert/strict";
import { diffusionComposite, type RealEcoSeries } from "../lib/realEconomy";

// A minimal survey series with just the fields the composite reads.
const mk = (key: string, hist: [string, number][]): RealEcoSeries => ({
  key, label: key, group: "Manufacturing", unit: "diffusion idx", changeUnit: "pts", signLevel: true,
  seriesId: key, latest: hist.at(-1)?.[1] ?? null, latestDate: hist.at(-1)?.[0] ?? null,
  prev: null, yearAgo: null, momPct: null, yoyPct: null, history: hist, source: "test",
});
const META = { key: "pmi-composite", label: "Mfg composite", group: "Manufacturing" as const, note: "test" };

test("diffusionComposite averages the members per date and derives latest/MoM in points", () => {
  const empire = mk("pmi-empire", [["2026-06-01", 10], ["2026-07-01", 20], ["2026-08-01", 30]]);
  const philly = mk("pmi-philly", [["2026-06-01", 20], ["2026-07-01", 40], ["2026-08-01", 60]]);
  const dallas = mk("pmi-dallas", [["2026-06-01", 0], ["2026-07-01", 0], ["2026-08-01", 0]]);
  const c = diffusionComposite([empire, philly, dallas], META);
  assert.ok(c != null);
  assert.equal(c!.latestDate, "2026-08-01");
  assert.ok(Math.abs((c!.latest as number) - 30) < 1e-9, `avg of 30/60/0 = 30, got ${c!.latest}`); // (30+60+0)/3
  assert.ok(Math.abs((c!.momPct as number) - 10) < 1e-9, `MoM is a POINT move: 30 − 20 = 10, got ${c!.momPct}`); // prev avg (20+40+0)/3 = 20
  assert.equal(c!.changeUnit, "pts");
  assert.equal(c!.signLevel, true);
});

test("diffusionComposite requires at least half the members present on a date", () => {
  // August has only 1 of 3 members → dropped (need ≥2); July has 2 of 3 → kept.
  const a = mk("pmi-empire", [["2026-06-01", 10], ["2026-07-01", 20], ["2026-08-01", 99]]);
  const b = mk("pmi-philly", [["2026-06-01", 30], ["2026-07-01", 40]]);
  const d = mk("pmi-dallas", [["2026-06-01", 50], ["2026-07-01", 60]]);
  const c = diffusionComposite([a, b, d], META);
  assert.ok(c != null);
  assert.equal(c!.latestDate, "2026-07-01", "the thin August month (1 of 3) is excluded");
  assert.ok(Math.abs((c!.latest as number) - 40) < 1e-9, "(20+40+60)/3 = 40");
});

test("diffusionComposite returns null with fewer than two usable members", () => {
  assert.equal(diffusionComposite([mk("pmi-empire", [["2026-08-01", 10]])], META), null);
  assert.equal(diffusionComposite([mk("a", []), mk("b", [])], META), null);
});
