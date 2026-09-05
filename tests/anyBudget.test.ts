import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// The `any` budget — a ratchet, not a ban. Each directory may not EXCEED its number; when a change
// brings a count down, lower the number here so it can't creep back. Counted 2026-09-05 at the
// review's request (it found the UI untyped at the edges and the scripts leaning on `as any` for
// vendor payloads). The lint config deliberately leaves no-explicit-any off: this is the enforcement.

const BUDGET: Record<string, number> = { lib: 209, app: 121, components: 61, scripts: 553 };
const ROOT = path.join(__dirname, "..");
const ANY = /(: any\b|\bas any\b|<any>|\bany\[\])/g;

function countAny(dir: string): number {
  let n = 0;
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) { if (name !== "node_modules") walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      n += (readFileSync(p, "utf8").match(ANY) ?? []).length;
    }
  };
  walk(path.join(ROOT, dir));
  return n;
}

test("`any` stays within each directory's budget (ratchet the number down when you reduce it)", () => {
  const over: string[] = [];
  const room: string[] = [];
  for (const [dir, max] of Object.entries(BUDGET)) {
    const n = countAny(dir);
    if (n > max) over.push(`${dir}: ${n} > budget ${max}`);
    else if (n < max) room.push(`${dir}: ${n} (budget ${max} — lower it in tests/anyBudget.test.ts)`);
  }
  assert.deepEqual(over, [], `over the any budget: ${over.join("; ")}`);
  if (room.length) console.log(`  any budget headroom → ${room.join("; ")}`);
});
