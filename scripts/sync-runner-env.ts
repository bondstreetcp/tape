/**
 * Per-tick sync of runner secrets from R2 → $APP/.alert-env (the file tape-entrypoint sources at
 * the top of every tick). Why: the runner container's env_file (tape.env) only applies on a
 * container RECREATE — a Synology/DSM click no automation can perform — so a new secret used to
 * wait on a human. R2 is the private channel both runners already authenticate to; the PUBLIC repo
 * carries only this mechanism, never a value. Managed block is fenced so hand-added lines survive.
 *
 * To ship/rotate a secret: append KEY=value to site-data/runner.env in R2 (from the PC:
 * npm run push-runner-env, which uploads data/.tmp/runner.env). Takes effect on the NEXT tick.
 * Run: npm run sync-runner-env. No-ops silently when R2 or the object is absent (GH runs, dev).
 */
import { promises as fsp } from "fs";
import { getObject, r2Configured } from "../lib/r2";

const KEY = "site-data/runner.env";
const BEGIN = "# --- managed by sync-runner-env (R2 site-data/runner.env) ---";
const END = "# --- end managed ---";

async function main() {
  if (!r2Configured()) { console.log("sync-runner-env: R2 not configured — skip"); return; }
  const buf = await getObject(KEY).catch(() => null);
  if (!buf) { console.log("sync-runner-env: no runner.env in R2 — skip"); return; }
  const managed = buf.toString("utf8").trim();
  const target = process.env.TAPE_RUNNER_ENV_FILE || "/app/.alert-env";
  const current = await fsp.readFile(target, "utf8").catch(() => "");
  const withoutBlock = current.includes(BEGIN)
    ? current.slice(0, current.indexOf(BEGIN)).trimEnd() + "\n" + current.slice(current.indexOf(END) + END.length).trimStart()
    : current;
  const next = `${withoutBlock.trim()}\n\n${BEGIN}\n${managed}\n${END}\n`.replace(/^\n+/, "");
  if (next === current) { console.log("sync-runner-env: up to date"); return; }
  await fsp.writeFile(target, next);
  console.log(`sync-runner-env: wrote ${managed.split("\n").length} managed line(s) → ${target} (live next tick)`);
}

main().catch((e) => { console.error("sync-runner-env failed (non-fatal):", String(e?.message || e)); });
