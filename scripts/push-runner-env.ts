/**
 * Upload data/.tmp/runner.env (KEY=value lines, git-ignored) to R2 site-data/runner.env — the
 * private channel scripts/sync-runner-env.ts reads on every runner tick. Run from the PC after
 * adding or rotating a secret: npm run push-runner-env. Refuses an empty file (a fat-fingered
 * empty upload would blank the runner's managed secrets next tick).
 */
import { promises as fsp } from "fs";
import path from "path";
import { putObject, r2Configured } from "../lib/r2";

async function main() {
  if (!r2Configured()) throw new Error("R2 not configured (LAKE_S3_*)");
  const file = path.join(process.cwd(), "data", ".tmp", "runner.env");
  const body = (await fsp.readFile(file, "utf8")).trim();
  if (!body || !body.includes("=")) throw new Error(`${file} is empty or not KEY=value lines — refusing to upload`);
  await putObject("site-data/runner.env", Buffer.from(body + "\n"), "text/plain");
  console.log(`push-runner-env: uploaded ${body.split("\n").length} line(s) to site-data/runner.env`);
}

main().catch((e) => { console.error("push-runner-env failed:", String(e?.message || e)); process.exit(1); });
