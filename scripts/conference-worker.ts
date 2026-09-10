/** Persistent single-host queue. Run under launchd; submit URLs with conference:queue. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { atomicWrite } from "./conference-media";
import { webcastUrl, safeError } from "../lib/conferenceRunner";

interface Job {
  id: string; url: string; processOnly: boolean;
  phase: "capture" | "process"; state: "queued" | "running" | "retry" | "complete" | "failed";
  attempts: number; nextAttemptAt?: number; childPid?: number; host?: string;
  updatedAt: string; error?: string;
}
const root = path.resolve(".conference-runner");
const queue = path.join(root, "queue");
const jobFile = (id: string) => path.join(queue, `${id}.json`);
const read = async (file: string) => JSON.parse(await fs.readFile(file, "utf8"));
const save = async (job: Job) => {
  job.updatedAt = new Date().toISOString();
  await atomicWrite(jobFile(job.id), JSON.stringify(job, null, 2));
};
function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}
async function releaseExitedChild(job: Job) {
  // Only clean the runner lock belonging to this queue's recorded, exited child on this host.
  if (!job.childPid || job.host !== hostname() || alive(job.childPid)) return false;
  const lock = path.join(root, "run.lock");
  const owner = await fs.readFile(lock, "utf8").catch(() => "");
  if (owner.trim() === String(job.childPid)) await fs.unlink(lock);
  return true;
}
async function execute(job: Job): Promise<number> {
  const log = await fs.open(path.join(queue, `${job.id}.log`), "a", 0o600);
  try {
    await log.write(`\n${new Date().toISOString()} ${job.phase} attempt ${job.attempts}\n`);
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/conference-runner.ts", job.url,
      job.phase === "capture" ? "--capture-only" : "--process-only"],
    { cwd: process.cwd(), stdio: ["ignore", log.fd, log.fd], shell: false });
    // Observe immediately, before any filesystem await, so fast exits/errors aren't lost.
    const finished = new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", code => resolve(code ?? 1));
    });
    void finished.catch(() => {});
    job.childPid = child.pid; job.host = hostname();
    await save(job);
    return await finished;
  } finally { await log.close(); }
}
async function main() {
  await fs.mkdir(queue, { recursive: true });
  const [command, input, ...flags] = process.argv.slice(2);
  if (command === "enqueue") {
    const url = webcastUrl(input || "");
    const id = url.searchParams.get("ei")!;
    const job: Job = { id, url: url.href, processOnly: flags.includes("--process-only"), phase: flags.includes("--process-only") ? "process" : "capture", state: "queued", attempts: 0, updatedAt: new Date().toISOString() };
    // Exclusive creation: submitting the same event never overwrites an active job.
    const file = await fs.open(jobFile(id), "wx", 0o600).catch(() => { throw new Error(`Job ${id} already exists. Inspect it with conference:status.`); });
    try { await file.writeFile(JSON.stringify(job, null, 2)); } finally { await file.close(); }
    console.log(`Queued conference ${id}.`); return;
  }
  if (command === "status") {
    for (const file of await fs.readdir(queue)) if (/^\d+\.json$/.test(file)) {
      const j = await read(path.join(queue, file)) as Job;
      const manifest = await read(path.join(root, "runs", j.id, "manifest.json")).catch(() => null);
      const counts = { audio: 0, transcript: 0, digest: 0 };
      for (const talk of manifest?.talks || []) for (const [stage, name] of Object.entries({ audio: "audio.mp3", transcript: "transcript.txt", digest: "digest.json" })) {
        const stat = await fs.stat(path.join(root, "runs", j.id, talk.id, name)).catch(() => null);
        if (stat?.isFile() && stat.size) counts[stage as keyof typeof counts]++;
      }
      console.log(JSON.stringify({ id: j.id, state: j.state, phase: j.phase, updatedAt: j.updatedAt, childAlive: !!j.childPid && j.host === hostname() && alive(j.childPid), total: manifest?.talks.length, ...counts, error: j.error }));
    }
    return;
  }
  if (command !== "run") throw new Error("Use enqueue URL [--process-only], status, or run.");
  // launchd starts exactly one instance. Reject a second manual worker too.
  const lock = path.join(root, "worker.lock");
  try {
    const prior = await read(lock);
    if (prior.host !== hostname() || alive(prior.pid)) throw new Error("A worker owns this queue.");
    await fs.unlink(lock);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const owner = await fs.open(lock, "wx", 0o600);
  await owner.writeFile(JSON.stringify({ pid: process.pid, host: hostname() })); await owner.close();
  try {
    for (;;) {
      for (const file of (await fs.readdir(queue)).filter(f => /^\d+\.json$/.test(f)).sort()) {
        const job = await read(path.join(queue, file)) as Job;
        if (job.state === "complete" || job.state === "failed" || (job.nextAttemptAt || 0) > Date.now()) continue;
        if (job.state === "running" && job.childPid) {
          if (job.host !== hostname() || alive(job.childPid)) continue;
          await releaseExitedChild(job);
        }
        if (job.attempts >= 3) { job.state = "failed"; job.error = "Three attempts exhausted; inspect the job log."; await save(job); continue; }
        job.state = "running"; job.attempts++; delete job.error; await save(job);
        let code: number;
        try { code = await execute(job); }
        catch (error) { job.error = safeError(error); code = 1; }
        await releaseExitedChild(job);
        delete job.childPid;
        if (code === 0 && job.phase === "capture") {
          job.phase = "process"; job.state = "queued"; job.attempts = 0;
        } else if (code === 0) job.state = "complete";
        else if (code === 78) { job.state = "failed"; job.error = "Summary service needs attention. Saved work is preserved; restore access and resume from Tape."; }
        else {
          job.state = job.attempts >= 3 ? "failed" : "retry";
          job.error ||= `Runner exited ${code}; see ${job.id}.log. Completed files are preserved.`;
          job.nextAttemptAt = Date.now() + job.attempts * 60_000;
        }
        await save(job);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } finally { await fs.unlink(lock); }
}
main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
