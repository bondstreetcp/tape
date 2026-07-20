import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import path from "path";

// THE 2026-07-20 DRIFT: run-tick.ts promises it mirrors refresh-data.yml "STEP FOR STEP ... so the
// NAS pipeline and the GitHub fallback can never drift" — but the promise was comment-enforced, and
// it drifted invisibly THREE ways at once: run-tick was missing refresh-hedge-etfs + refresh-adv
// (portfolio inputs freeze on NAS-only operation), and the yml was missing refresh-forensics (a
// GH-run FULL left forensics.json 60h stale and flunked the freshness gate — observed same day).
// This test machine-enforces the mirror: add a step to either side without the other and it fails.

const ROOT = process.cwd();
const yml = readFileSync(path.join(ROOT, ".github", "workflows", "refresh-data.yml"), "utf8");
const narrYml = readFileSync(path.join(ROOT, ".github", "workflows", "refresh-narration.yml"), "utf8");
const runTick = readFileSync(path.join(ROOT, "scripts", "run-tick.ts"), "utf8");

/** Canonical npm-script names from a shell command: split `&&` compounds, strip env prefixes
 *  ("LIMIT=150 npm run refresh-guidance" → "refresh-guidance"). */
function scriptsIn(cmd: string): string[] {
  return cmd
    .split("&&")
    .map((part) => part.trim().replace(/^(\w+=\S+\s+)+/, ""))
    .map((part) => /^npm run (\S+)/.exec(part)?.[1])
    .filter((s): s is string => !!s);
}

const ymlScripts = (src: string) => [...src.matchAll(/^\s*run: (.+)$/gm)].flatMap((m) => scriptsIn(m[1]));
const tickScripts = [...runTick.matchAll(/cmd: "([^"]+)"/g)].flatMap((m) => scriptsIn(m[1]));

// Steps the yml runs OUTSIDE run-tick's STEPS table by design: run-tick performs hydrate, upload and
// its own deploy gate as dedicated phases of its main() (not table entries). Nothing else is excused.
const YML_ONLY = new Set(["data-from-r2", "data-to-r2", "check-freshness"]);

test("every refresh-data.yml npm step is mirrored in run-tick STEPS (NAS can't silently skip a feed)", () => {
  const tick = new Set(tickScripts);
  const missing = [...new Set(ymlScripts(yml))].filter((s) => !tick.has(s) && !YML_ONLY.has(s));
  assert.deepEqual(missing, [], `refresh-data.yml steps absent from run-tick STEPS: ${missing.join(", ")} — add them to STEPS in the same commit (the [[daily-refresh-cron]] doctrine)`);
});

test("every run-tick STEPS cmd exists in refresh-data.yml (the GH fallback can't silently skip a feed)", () => {
  const ymlSet = new Set(ymlScripts(yml));
  const extra = [...new Set(tickScripts)].filter((s) => !ymlSet.has(s));
  assert.deepEqual(extra, [], `run-tick STEPS not present in refresh-data.yml: ${extra.join(", ")} — add the workflow step in the same commit`);
});

test("the YML_ONLY exceptions all still exist in the yml (a stale exception is itself drift)", () => {
  const ymlSet = new Set(ymlScripts(yml));
  const stale = [...YML_ONLY].filter((s) => !ymlSet.has(s));
  assert.deepEqual(stale, [], `YML_ONLY lists scripts the yml no longer runs: ${stale.join(", ")}`);
});

test("refresh-narration.yml matches run-tick's narr-flagged steps exactly", () => {
  // narr:true marks the subset of STEPS the narration workflow re-runs; hydrate/upload bookend it.
  const narrFlagged = new Set(
    [...runTick.matchAll(/cmd: "([^"]+)"[^\n]*narr: true/g)].flatMap((m) => scriptsIn(m[1])),
  );
  const narrSteps = ymlScripts(narrYml).filter((s) => s !== "data-from-r2" && s !== "data-to-r2");
  assert.deepEqual(
    [...narrSteps].sort(),
    [...narrFlagged].sort(),
    "refresh-narration.yml steps and run-tick narr:true flags have drifted",
  );
});
