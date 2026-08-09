/**
 * The per-stock company cache's R2 objects — its tarball + its OWN manifest (2026-08-09, the
 * null-stats incident's structural fix). Yahoo serves the NAS's egress IP degraded quoteSummary
 * payloads, so weeks of NAS bakes wrote stats:null for most of the tree; the bake belongs on a box
 * Yahoo treats well. With GitHub Actions billing-limited, that box is the Windows desktop:
 *
 *   PC (nightly Task Scheduler) → refresh-company-cache + uploadCompanyArchive(writer "pc")
 *   NAS / GH nightly           → refresh-company-cache STANDS DOWN while a fresh foreign stamp
 *                                exists (companyStanddown below), else bakes as the fallback —
 *                                fail-open: a dark PC only ever degrades the cache to STALE
 *                                (carry-forward + null-stats-is-due already guard content).
 *
 * The stamp lives on its OWN object, NOT site-data/manifest.json — that manifest is the tarball
 * standdown protocol's signal and is rewritten by every data upload; sharing it would let an
 * intraday tick masquerade as a fresh bake (the "one writer, one object" rule the news-tape
 * archive taught us).
 */
import { execFileSync } from "child_process";
import { readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import path from "path";
import { putObject, getObject, r2Configured } from "./r2";

export const KEY_COMPANY = "site-data/company.tar.gz";
export const KEY_COMPANY_MANIFEST = "site-data/company-manifest.json";

/** How this process signs uploads / recognizes its own stamp. */
export const archiveWriter = (): string => process.env.TAPE_WRITER || (process.env.GITHUB_ACTIONS ? "github" : "local");

export interface CompanyManifest {
  bakedAt: string;
  writer: string;
  bytes: number;
}

/** Tar data/company → upload + stamp. Throws on failure — callers decide whether that's fatal
 *  (the PC task: yes; data-to-r2's FULL branch keeps its own best-effort catch). */
export async function uploadCompanyArchive(): Promise<CompanyManifest> {
  if (!r2Configured()) throw new Error("R2 not configured (LAKE_S3_*)");
  if (!existsSync(path.join("data", "company"))) throw new Error("data/company missing — nothing to upload");
  const tmp = path.join("lake", ".tmp");
  mkdirSync(tmp, { recursive: true });
  const tarPath = path.join(tmp, "company.tar.gz");
  execFileSync("tar", ["-czf", tarPath, "data/company"], { stdio: ["ignore", "ignore", "inherit"] });
  const buf = readFileSync(tarPath);
  await putObject(KEY_COMPANY, buf, "application/gzip");
  const manifest: CompanyManifest = { bakedAt: new Date().toISOString(), writer: archiveWriter(), bytes: buf.length };
  await putObject(KEY_COMPANY_MANIFEST, Buffer.from(JSON.stringify(manifest)), "application/json");
  rmSync(tarPath, { force: true });
  return manifest;
}

/** Pure standdown decision — exported for tests. Stand down only to a FRESH stamp from a DIFFERENT
 *  writer; anything unreadable/stale/own means bake (fail-open). */
export function shouldStandDown(manifest: CompanyManifest | null, self: string, nowMs: number, maxAgeHours = 24): { skip: boolean; reason: string } {
  if (!manifest?.bakedAt || !manifest.writer) return { skip: false, reason: "no readable company stamp — baking" };
  const age = (nowMs - Date.parse(manifest.bakedAt)) / 3_600_000;
  if (!Number.isFinite(age) || age < 0) return { skip: false, reason: "unparseable stamp — baking" };
  if (manifest.writer === self) return { skip: false, reason: `own stamp (${self}) — baking` };
  if (age > maxAgeHours) return { skip: false, reason: `foreign stamp (${manifest.writer}) is ${age.toFixed(1)}h old (> ${maxAgeHours}h) — baking as fallback` };
  return { skip: true, reason: `standing down — ${manifest.writer} baked ${age.toFixed(1)}h ago (the good-IP pipe owns this feed)` };
}

/** Read the live stamp; null on any failure (→ fail-open bake). */
export async function readCompanyManifest(): Promise<CompanyManifest | null> {
  if (!r2Configured()) return null;
  try { return JSON.parse((await getObject(KEY_COMPANY_MANIFEST)).toString("utf8")) as CompanyManifest; }
  catch { return null; }
}
