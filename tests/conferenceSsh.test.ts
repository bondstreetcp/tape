import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { shellQuote, sshOptions, whisperRemoteCommand } from "../lib/conferenceSsh";
import { transcribeRemoteChunk } from "../scripts/conference-ssh";

test("SSH transcription keeps existing host verification and rejects option injection", () => {
  assert.throws(() => sshOptions({ target: "-oProxyCommand=evil" }));
  assert.throws(() => sshOptions({ target: "user@host;other" }));
  const opts = sshOptions({ target: "user@100.112.4.30", identityFile: "C:/keys/my key" });
  assert.ok(opts.includes("StrictHostKeyChecking=yes"));
  assert.ok(opts.includes("BatchMode=yes"));
  assert.ok(opts.includes("C:/keys/my key"));
});

test("model/CLI paths are quoted remote argv and job cleanup stays in the generated namespace", () => {
  assert.equal(shellQuote("a'b"), "'a'\"'\"'b'");
  assert.throws(() => whisperRemoteCommand("whisper-cli", "/models/m.bin", "en", "/tmp/tape-asr-abcd"));
  assert.throws(() => whisperRemoteCommand("/bin/whisper-cli", "/models/m.bin", "en", "/tmp/elsewhere"));
  const cmd = whisperRemoteCommand("/opt/homebrew/bin/whisper-cli", "/models/model $(touch wrong)'s.bin", "en", "/tmp/tape-asr-abcd");
  assert.ok(cmd.includes(shellQuote("/models/model $(touch wrong)'s.bin")));
});

test("remote ASR transfers one chunk, fetches its text, and cleans up on success or model failure", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tape-ssh-test-"));
  const config = { ssh: { target: "user@100.112.4.30" }, cli: "/opt/homebrew/bin/whisper-cli", modelPath: "/Users/user/whisper-models/ggml.bin", language: "en" };
  try {
    for (const fail of [false, true]) {
      const calls: { binary: string; args: string[] }[] = [];
      const execute = async (binary: string, args: string[]) => {
        calls.push({ binary, args });
        if (fail && args.at(-1)?.includes("'-m'")) throw new Error("remote model unavailable");
        if (binary === "scp" && args.at(-2)?.endsWith("/out.txt")) await fs.writeFile(args.at(-1)!, "This is the remote transcript.");
      };
      const task = transcribeRemoteChunk("C:/fixture/input.wav", dir, config, execute);
      if (fail) await assert.rejects(task, /remote model unavailable/);
      else assert.equal(await task, "This is the remote transcript.");
      assert.ok(calls.at(-1)!.args.at(-1)!.startsWith("rm -rf '/tmp/tape-asr-"));
      assert.equal(calls.filter(c => c.binary === "scp").length, fail ? 1 : 2);
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("failed authentication never triggers remote deletion or upload", async () => {
  let calls = 0;
  await assert.rejects(transcribeRemoteChunk("input", ".", { ssh: { target: "user@host" }, cli: "/bin/whisper", modelPath: "/models/m.bin", language: "en" }, async () => { calls++; throw new Error("SSH permission denied"); }), /permission denied/);
  assert.equal(calls, 1);
});
