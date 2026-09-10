import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const loader = pathToFileURL(require.resolve("tsx")).href;
const worker = path.resolve("scripts/conference-worker.ts");
test("durable queue rejects duplicates, retries capture, then completes processing", { timeout: 30000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tape-queue-"));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    await fs.symlink(path.resolve("node_modules"), path.join(dir, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    await fs.mkdir(path.join(dir, "scripts"));
    await fs.writeFile(path.join(dir, "scripts/conference-runner.ts"), `
      const fs = require('node:fs');
      fs.writeFileSync('.conference-runner/run.lock', String(process.pid));
      if (process.argv.includes('--capture-only') && !fs.existsSync('capture-attempted')) {
        fs.writeFileSync('capture-attempted', 'yes'); process.exit(1);
      }
      fs.appendFileSync('phases.txt', process.argv.at(-1) + '\\n');
      fs.unlinkSync('.conference-runner/run.lock');
    `);
    const run = (...args: string[]) => exec(process.execPath, ["--import", loader, worker, ...args], { cwd: dir });
    await assert.rejects(run("enqueue", "https://example.com/?ei=123"));
    await run("enqueue", "https://event.webcasts.com/viewer/agenda.jsp?ei=123");
    await assert.rejects(run("enqueue", "https://event.webcasts.com/viewer/agenda.jsp?ei=123"));
    child = spawn(process.execPath, ["--import", loader, worker, "run"], { cwd: dir, stdio: "ignore" });
    const jobPath = path.join(dir, ".conference-runner/queue/123.json");
    let sawRetry = false;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const job = JSON.parse(await fs.readFile(jobPath, "utf8"));
      if (job.state === "retry" && !sawRetry) {
        sawRetry = true;
        // Avoid waiting a real minute in the fixture; the worker's retry is durably scheduled.
        assert.ok(job.nextAttemptAt > Date.now());
        job.nextAttemptAt = 0;
        await fs.writeFile(jobPath, JSON.stringify(job));
      }
      if (job.state === "complete") break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(sawRetry);
    const status = JSON.parse((await run("status")).stdout.trim());
    assert.equal(status.state, "complete");
    assert.equal(await fs.readFile(path.join(dir, "phases.txt"), "utf8"), "--capture-only\n--process-only\n");
    await assert.rejects(fs.access(path.join(dir, ".conference-runner/run.lock")));
  } finally {
    if (child && child.exitCode === null) {
      const closed = new Promise(r => child!.once("close", r)); child.kill(); await closed;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
});
