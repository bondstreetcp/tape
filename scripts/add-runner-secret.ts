/**
 * Safely upsert ONE secret into the NAS runner-env (R2 site-data/runner.env) WITHOUT clobbering the
 * others. The blunt `push-runner-env` uploads a whole local file — easy to accidentally blank every
 * other managed secret. This instead pulls the current object, sets/updates a single KEY, and writes
 * it back, preserving the rest. The value is read from the same-named env var, so it never appears on
 * the command line or in the log. Takes effect on the NAS on the next tick (via sync-runner-env).
 *
 * Run where the R2 WRITE creds (LAKE_S3_*) live — the NAS or the secrets/PC box, not a plain laptop:
 *   $env:EIA_API_KEY="your-key"; npm run add-runner-secret EIA_API_KEY
 */
import { getObject, putObject, r2Configured } from "../lib/r2";

const OBJ = "site-data/runner.env";

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured (LAKE_S3_*) — run this where the R2 write creds live (NAS / secrets box), not a laptop.");
  const name = process.argv[2];
  if (!name || !/^[A-Z0-9_]+$/.test(name)) throw new Error("usage: npm run add-runner-secret <ENV_NAME>   (the value is read from that same env var)");
  const value = process.env[name];
  if (!value) throw new Error(`env var ${name} is empty — set it first (e.g.  $env:${name}=\"...\"  in PowerShell) then re-run.`);

  const cur = (await getObject(OBJ).catch(() => null))?.toString("utf8") ?? "";
  const map = new Map<string, string>();
  for (const line of cur.split(/\r?\n/)) {
    let t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (t.startsWith("export ")) t = t.slice(7).trim(); // tolerate (and normalize) existing export lines
    const i = t.indexOf("=");
    if (i > 0) map.set(t.slice(0, i).trim(), t.slice(i + 1));
  }
  const existed = map.has(name);
  map.set(name, value);

  // `export KEY=value`, not bare `KEY=value`: tape-entrypoint sources this file with a plain `.` (no
  // `set -a`), so without the export keyword the vars set as shell locals and never reach the tick's
  // child processes — the bug that made EIA_API_KEY/ALERT_WEBHOOK_URL silently not apply. Self-exporting
  // lines work on the current container with no recreate.
  const body = [...map].map(([k, v]) => `export ${k}=${v}`).join("\n") + "\n";
  await putObject(OBJ, Buffer.from(body), "text/plain");
  console.log(`add-runner-secret: ${existed ? "updated" : "added"} ${name} — ${map.size} secret(s) now in ${OBJ}. Live on the NAS next tick.`);
  console.log(`  (kept: ${[...map.keys()].filter((k) => k !== name).join(", ") || "none"})`);
}

main().catch((e) => { console.error("add-runner-secret failed:", String(e?.message || e)); process.exit(1); });
