/** Durable conference inbox, outside both deploy slots and the hourly data hydration. Server only. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { webcastUrl, validSymbol } from "./conferenceRunner";
import type { CallRecord } from "./callsArchive";
import { sanitizeDigest } from "./callDigests";

export interface PortalTalk { id: string; name: string; audio: boolean; transcript: boolean; summary: boolean; symbol?: string; published?: boolean; backedUp?: boolean; error?: string }
export interface PortalJob {
  id: string; url: string; owner: string; title: string; createdAt: string; updatedAt: string;
  revision: number; state: "queued" | "running" | "attention" | "complete";
  phase: string; message?: string; talks: PortalTalk[]; mappings: Record<string, string>;
}
export function conferenceServiceDir() {
  return /^\/app\/[ab]$/.test(process.cwd()) ? "/app/conference-service" : path.join(process.cwd(), ".conference-service");
}
export const conferenceRecordsDir = () => path.join(conferenceServiceDir(), "records");
export async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, "utf8")) as T; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}
export async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 }); await fs.rename(tmp, file); }
  finally { await fs.unlink(tmp).catch(() => {}); }
}
export function jobPath(id: string) {
  if (!/^\d{1,16}$/.test(id)) throw Error("Invalid conference ID.");
  return path.join(conferenceServiceDir(), "jobs", `${id}.json`);
}
export async function listJobs() {
  const dir = path.join(conferenceServiceDir(), "jobs");
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const jobs = await Promise.all(names.filter(n => /^\d+\.json$/.test(n)).map(n => readJson<PortalJob>(path.join(dir, n))));
  return jobs.filter((j): j is PortalJob => !!j).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}
// The service has one writer per process, and one active web slot. Exclusive files protect enqueues.
let writes: Promise<unknown> = Promise.resolve();
export function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = writes.then(fn, fn); writes = result.catch(() => {}); return result;
}
export async function enqueueConference(input: string, owner: string) {
  const url = webcastUrl(input);
  if (url.username || url.password || url.port || url.href.length > 2000 || !/^\d{1,16}$/.test(url.searchParams.get("ei")!)) throw Error("Invalid conference link.");
  const id = url.searchParams.get("ei")!;
  return serialize(async () => {
    const prior = await readJson<PortalJob>(jobPath(id));
    if (prior) return prior;
    if ((await listJobs()).filter(j => j.state === "queued" || j.state === "running").length >= 10) throw Error("The queue is full. Wait for a conference to finish.");
    const now = new Date().toISOString();
    const job: PortalJob = { id, url: url.href, owner, title: `Conference ${id}`, createdAt: now, updatedAt: now, revision: 1, state: "queued", phase: "Waiting for Mac", talks: [], mappings: {} };
    await fs.mkdir(path.dirname(jobPath(id)), { recursive: true, mode: 0o700 });
    await fs.writeFile(jobPath(id), JSON.stringify(job), { flag: "wx", mode: 0o600 });
    return job;
  });
}
export async function workerAuthorized(header: string | null) {
  const config = await readJson<{ token: string }>(path.join(conferenceServiceDir(), "worker-key.json"));
  if (!config?.token || !header?.startsWith("Bearer ")) return false;
  const expected = Buffer.from(config.token), supplied = Buffer.from(header.slice(7));
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
export async function boundedJson(req: Request, limit = 2_000_000): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw Error("Missing request body.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  for (;;) { const r = await reader.read(); if (r.done) break; bytes += r.value.length; if (bytes > limit) { await reader.cancel(); throw Error("Request too large."); } chunks.push(r.value); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function stockCatalog(): Promise<{ symbol: string; name: string }[]> {
  const dirs = await fs.readdir(path.join(process.cwd(), "data"), { withFileTypes: true });
  const stocks = new Map<string, { symbol: string; name: string }>();
  for (const dir of dirs.filter(d => d.isDirectory())) {
    const snap = await readJson<{ stocks?: { symbol: string; name: string }[] }>(path.join(process.cwd(), "data", dir.name, "snapshot.json"));
    for (const s of snap?.stocks || []) if (validSymbol(s.symbol)) stocks.set(s.symbol, { symbol: s.symbol, name: s.name });
  }
  return [...stocks.values()];
}
const companyName = (name: string) => name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(incorporated|inc|corporation|corp|plc|limited|ltd|company|co|sa|nv|ag)\b/g, "").replace(/\s/g, "");
export function matchCompany(name: string, stocks: { symbol: string; name: string }[]): string | undefined {
  const matches = [...new Set(stocks.filter(s => companyName(s.name) === companyName(name)).map(s => s.symbol))];
  return matches.length === 1 ? matches[0] : undefined;
}
export async function publishConferenceRecord(job: PortalJob, talk: PortalTalk, record: CallRecord, stocks: { symbol: string; name: string }[]) {
  const symbol = job.mappings[talk.id] || matchCompany(talk.name, stocks);
  if (!symbol || !stocks.some(s => s.symbol === symbol)) return false;
  const period = `conference-${job.id}-${talk.id}`;
  if (!/^\d{1,16}$/.test(talk.id) || record.fiscalPeriod !== period || record.eventType !== "conference" || typeof record.transcript?.text !== "string" || record.transcript.text.length < 200 || record.transcript.text.length > 1_000_000 || !/^\d{4}-\d{2}-\d{2}$/.test(record.callDate)) throw Error("Invalid conference record.");
  if (!record.digest?.tldr || !Array.isArray(record.digest.kpis) || record.digest.kpis.some(k => typeof k !== "string") || !record.digest.guidance) throw Error("A complete summary is required before publication.");
  const digest = sanitizeDigest(record.digest, record.transcript.text, { eventType: "conference", symbol, name: talk.name, sector: record.digest.sector || null, marketCap: record.digest.marketCap || null, callDate: record.callDate, title: record.title, url: record.url, source: record.source, chars: record.transcript.text.length, chunks: record.digest.chunks || 1, model: record.digest.model || "conference-worker", digestedAt: record.digestedAt || new Date().toISOString() });
  if (!digest) throw Error("Summary did not pass publication validation.");
  const sourceUrl = webcastUrl(record.url);
  if (sourceUrl.searchParams.get("ei") !== talk.id) throw Error("Presentation URL mismatch.");
  const file = path.join(conferenceRecordsDir(), symbol, `${period}.json`);
  const old = await readJson<CallRecord>(file);
  // Compare against the existing archive too: preserve reviewed, newer summaries.
  const archive = await readJson<CallRecord>(path.join(process.cwd(), "data", "calls", symbol, `${period}.json`));
  const existing = old || archive;
  if (!existing || (record.digestedAt || "") > (existing.digestedAt || "")) {
    await writeJson(file, { ...record, symbol, digest, transcript: { text: record.transcript.text, chars: record.transcript.text.length } });
  } else if (!old) await writeJson(file, existing);
  talk.symbol = symbol; talk.published = true;
  return true;
}
