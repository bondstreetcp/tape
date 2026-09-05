import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ENV_KNOBS, ENV_BY_NAME, renderEnvReference } from "../lib/envManifest";

// The 2026-09-05 review found 149 environment knobs, 27 of them in an env example — the rest were
// discoverable only by reading each script. This test makes the manifest the single source of truth:
// a new `process.env.X` fails the suite until it is described, a knob nobody reads any more fails
// until it is removed, and docs/ENV.md fails when it lags the table.

const ROOT = path.join(__dirname, "..");
const SCAN_DIRS = ["scripts", "lib", "app", "components"];

function knobsInCode(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== "node_modules" && name !== ".next") walk(p); continue; }
      if (!/\.(ts|tsx|mjs|js)$/.test(name)) continue;
      const src = readFileSync(p, "utf8");
      for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) {
        const rel = path.relative(ROOT, p).replace(/\\/g, "/");
        const list = found.get(m[1]) ?? [];
        if (!list.includes(rel)) list.push(rel);
        found.set(m[1], list);
      }
    }
  };
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d));
  return found;
}

test("every process.env knob the code reads is described in lib/envManifest", () => {
  const inCode = knobsInCode();
  const missing = [...inCode.keys()].filter((k) => !ENV_BY_NAME.has(k)).sort();
  assert.deepEqual(missing, [], `undescribed knobs (add to lib/envManifest): ${missing.map((k) => `${k} @ ${inCode.get(k)!.join(", ")}`).join("; ")}`);
});

test("the manifest carries no dead knobs", () => {
  const inCode = knobsInCode();
  const dead = ENV_KNOBS.map((k) => k.name).filter((k) => !inCode.has(k)).sort();
  assert.deepEqual(dead, [], `knobs nobody reads any more (remove from lib/envManifest): ${dead.join(", ")}`);
});

test("the manifest is well-formed: unique names, non-empty purposes and readers", () => {
  const names = ENV_KNOBS.map((k) => k.name);
  assert.equal(new Set(names).size, names.length, "duplicate knob names");
  for (const k of ENV_KNOBS) {
    assert.ok(k.purpose.trim().length > 15, `${k.name}: purpose too short`);
    assert.ok(k.where.trim().length > 0, `${k.name}: no reader named`);
    assert.ok(!/\.tsx?\b/.test(k.where), `${k.name}: name the script/module, not a file path (paths rot)`);
  }
});

test("docs/ENV.md is generated from the manifest (run: npm run gen-env-reference)", () => {
  const doc = readFileSync(path.join(ROOT, "docs", "ENV.md"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(doc, renderEnvReference(), "docs/ENV.md is stale — regenerate it with `npm run gen-env-reference`");
});
