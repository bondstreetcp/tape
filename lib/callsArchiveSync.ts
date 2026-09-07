/**
 * R2 sync for the earnings-call archive (SCRIPT-ONLY — pulls in child_process/tar + R2, which the
 * route-imported read path in lib/callsArchive must not). Mirrors lib/companyArchive: the data/calls tree
 * rides its OWN tarball + OWN stamp ("one writer, one object"), FULL-only, excluded from the every-tick
 * data.tar.gz. The writer stands down to a fresh foreign stamp so two runners never clobber each other.
 */
import { execFileSync } from "child_process";
import { readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import path from "path";
import { putObject, getObject, r2Configured } from "./r2";
import { archiveWriter, shouldStandDown } from "./companyArchive";
import { callsCacheDir } from "./callsArchive";

export const KEY_CALLS = "site-data/calls.tar.gz";
export const KEY_CALLS_MANIFEST = "site-data/calls-manifest.json";

export interface CallsManifest {
  bakedAt: string;
  writer: string;
  bytes: number;
  records: number; // total call records in the archive at upload time
}

/** Tar data/calls → upload + stamp. Throws on failure (caller decides fatality). FULL-only, own object. */
export async function uploadCallsArchive(records: number): Promise<CallsManifest> {
  if (!r2Configured()) throw new Error("R2 not configured (LAKE_S3_*)");
  if (!existsSync(callsCacheDir())) throw new Error("data/calls missing — nothing to upload");
  const tmp = path.join(process.cwd(), "lake", ".tmp");
  mkdirSync(tmp, { recursive: true });
  const tarPath = path.join(tmp, "calls.tar.gz");
  execFileSync("tar", ["-czf", tarPath, "data/calls"], { stdio: ["ignore", "ignore", "inherit"] });
  const buf = readFileSync(tarPath);
  await putObject(KEY_CALLS, buf, "application/gzip");
  const manifest: CallsManifest = { bakedAt: new Date().toISOString(), writer: archiveWriter(), bytes: buf.length, records };
  await putObject(KEY_CALLS_MANIFEST, Buffer.from(JSON.stringify(manifest)), "application/json");
  rmSync(tarPath, { force: true });
  return manifest;
}

/** Read the live archive stamp; null on any failure. */
export async function readCallsManifest(): Promise<CallsManifest | null> {
  if (!r2Configured()) return null;
  try { return JSON.parse((await getObject(KEY_CALLS_MANIFEST)).toString("utf8")) as CallsManifest; }
  catch { return null; }
}

/** Should THIS writer bake the archive, or stand down to a fresh foreign stamp? Reuses the company-cache
 *  standdown doctrine (fail-open: unreadable/stale/own stamp → bake). */
export function callsStandDown(manifest: CallsManifest | null, self: string, nowMs: number, maxAgeHours = 24): { skip: boolean; reason: string } {
  return shouldStandDown(manifest, self, nowMs, maxAgeHours);
}
