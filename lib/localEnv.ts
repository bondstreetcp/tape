/**
 * Load .env.local into process.env for local `tsx` script runs. tsx does NOT auto-load it (only the
 * Next app does, via Next's own env loading), and the repo deliberately has no `dotenv` dependency —
 * so tooling scripts that need a key call this. No-op when .env.local is absent (CI injects the real
 * env vars). NEVER clobbers an already-set value, so a shell export / CI secret always wins.
 *
 * Only KEY=VALUE lines are parsed; values may be optionally quoted. Nothing is logged (these are
 * secrets).
 */
import { readFileSync } from "fs";
import path from "path";

let loaded = false;

export function loadLocalEnv(): void {
  if (loaded) return;
  loaded = true;
  let txt: string;
  try {
    txt = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  } catch {
    return; // no .env.local (CI) — real env vars are already present
  }
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue; // comment / blank / malformed
    const key = m[1];
    if (process.env[key] != null) continue; // don't override the shell / CI
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    process.env[key] = val;
  }
}
