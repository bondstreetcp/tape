/** Mac-only outgoing HTTPS bridge. The existing local queue owns capture/Whisper/LLM. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { hostname } from "node:os";
import { createHash } from "node:crypto";
import { atomicWrite, nonempty } from "./conference-media";
import { safeError, webcastUrl, type ConferenceTalk } from "../lib/conferenceRunner";
import type { PortalJob, PortalTalk } from "../lib/conferencePortal";
import type { CallDigest } from "../lib/callDigests";

const root = path.resolve(".conference-runner");
async function read<T>(file: string): Promise<T | null> { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; } }
interface LocalJob { id: string; url: string; state: string; phase: string; attempts: number; updatedAt: string; nextAttemptAt?: number; childPid?: number; error?: string }
interface BridgeState { revisions: Record<string, number>; published: Record<string, string> }
async function main() {
  const config = await read<{ url: string; token: string }>(path.join(root, "portal.json"));
  if (!config?.token || new URL(config.url).protocol !== "https:") throw Error("Configure a private .conference-runner/portal.json with Tape's HTTPS URL and worker token.");
  const endpoint = new URL("/api/conferences/worker", config.url).href;
  async function request(body?: unknown) {
    const response = await fetch(endpoint, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${config!.token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000), redirect: "error" });
    if (!response.ok) throw Error(`Tape conference service returned ${response.status}.`);
    return response.json();
  }
  const statePath = path.join(root, "portal-state.json");
  const state = await read<BridgeState>(statePath) || { revisions: {}, published: {} };
  await fs.mkdir(path.join(root, "queue"), { recursive: true });
  // launchd singleton; refuse a second bridge to avoid two publishers.
  const lock = path.join(root, "portal.lock");
  const prior = await read<{ pid: number; host: string }>(lock);
  if (prior) {
    if (prior.host !== hostname()) throw Error("Another host owns the bridge.");
    try { process.kill(prior.pid, 0); throw Error("A bridge is already running."); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; }
    await fs.unlink(lock);
  }
  await fs.writeFile(lock, JSON.stringify({ pid: process.pid, host: hostname() }), { flag: "wx", mode: 0o600 });
  async function sync(job: PortalJob) {
    if (job.state === "complete") return;
    const url = webcastUrl(job.url); if (url.searchParams.get("ei") !== job.id || !/^\d{1,16}$/.test(job.id)) throw Error("Invalid job identity.");
    const localPath = path.join(root, "queue", `${job.id}.json`);
    let local = await read<LocalJob>(localPath);
    if (!local) {
      local = { id: job.id, url: url.href, phase: "capture", state: "queued", attempts: 0, updatedAt: new Date().toISOString() };
      await fs.writeFile(localPath, JSON.stringify(local), { flag: "wx", mode: 0o600 });
    } else if (state.revisions[job.id] !== job.revision && local.state === "failed") {
      // Only an explicit website retry resets exhausted attempts; never interrupt a running child.
      local.state = "queued"; local.attempts = 0; delete local.nextAttemptAt; delete local.error;
      await atomicWrite(localPath, JSON.stringify(local));
    }
    state.revisions[job.id] = job.revision;
    const dir = path.join(root, "runs", job.id);
    const manifest = await read<{ title: string; talks: (ConferenceTalk & { error?: string })[] }>(path.join(dir, "manifest.json"));
    const talks: PortalTalk[] = [];
    for (const talk of manifest?.talks || []) {
      if (!/^\d{1,16}$/.test(talk.id)) continue;
      const td = path.join(dir, talk.id);
      talks.push({ id: talk.id, name: talk.name, audio: await nonempty(path.join(td, "audio.mp3")), transcript: await nonempty(path.join(td, "transcript.txt")), summary: await nonempty(path.join(td, "digest.json")), error: talk.error ? safeError(talk.error) : undefined });
    }
    const waitingLogin = local.phase === "capture" && !manifest && local.state === "running";
    const portalState = local.state === "failed" ? "attention" : local.state === "complete" ? "complete" : "running";
    await request({ id: job.id, revision: job.revision, title: manifest?.title, state: portalState, phase: local.phase === "capture" ? "Capturing presentations" : "Transcribing and summarizing", talks,
      message: waitingLogin ? "Opening the agenda on the Mac. If registration appears, sign in in the worker's Chrome window." : local.state === "failed" ? "Processing stopped after retries. Saved recordings and transcripts are retained; resolve the presentation errors below, then resume." : undefined });
    for (const talk of talks.filter(t => t.summary && t.transcript)) {
      try {
      const original = manifest!.talks.find(t => t.id === talk.id)!;
      const td = path.join(dir, talk.id);
      const labeled = path.join(td, "transcript.speakers.txt");
      const text = await fs.readFile(await nonempty(labeled) ? labeled : path.join(td, "transcript.txt"), "utf8");
      const digest = await read<CallDigest>(path.join(td, "digest.json"));
      if (!digest) continue;
      const key = `${job.id}-${talk.id}`;
      const hash = createHash("sha256").update(text).update(JSON.stringify(digest)).update(job.mappings[talk.id] || "").digest("hex");
      if (state.published[key] === hash && job.talks.some(t => t.id === talk.id && t.published)) continue;
      const result = await request({ id: job.id, revision: job.revision, talkId: talk.id, record: {
        symbol: original.symbol || "", fiscalPeriod: `conference-${key}`, eventType: "conference", callDate: original.date,
        title: `${original.name} — ${manifest!.title}`, url: original.url, source: manifest!.title,
        transcript: { text, chars: text.length }, digest, fetchedAt: digest.digestedAt, digestedAt: digest.digestedAt,
      } });
      if (result.talk?.published) state.published[key] = hash;
      } catch (e) { console.error(`Presentation ${talk.id}: ${safeError(e)}`); }
    }
  }
  try {
    for (;;) {
      try {
        const { jobs } = await request() as { jobs: PortalJob[] };
        for (const job of jobs) { try { await sync(job); } catch (e) { console.error(`Conference ${job.id}: ${safeError(e)}`); } }
        await atomicWrite(statePath, JSON.stringify(state));
      } catch (e) { console.error(safeError(e)); }
      if (process.argv.includes("--once")) break;
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
  } finally { await fs.unlink(lock); }
}
main().catch(e => { console.error(safeError(e)); process.exitCode = 1; });
