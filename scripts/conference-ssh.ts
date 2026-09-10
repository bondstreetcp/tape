import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { shellQuote, sshOptions, whisperRemoteCommand, type SshAsrConfig } from "../lib/conferenceSsh";

type Execute = (binary: string, args: string[], timeoutMs?: number) => Promise<void>;

/** SSH/SFTP to the Mac's existing whisper.cpp CLI. No daemon, open port, credential changes or HTTP service. */
export async function transcribeRemoteChunk(input: string, scratch: string, config: { ssh?: SshAsrConfig; cli: string; modelPath?: string; language: string }, execute: Execute): Promise<string> {
  if (!config.ssh || !config.modelPath) throw new Error("Set asr.ssh.target and asr.modelPath for the Mac's Whisper installation.");
  const options = sshOptions(config.ssh);
  const ssh = config.ssh.binary || "ssh";
  const scp = config.ssh.copyBinary || "scp";
  const target = config.ssh.target;
  const remote = `/tmp/tape-asr-${randomUUID()}`;
  const command = whisperRemoteCommand(config.cli, config.modelPath, config.language, remote);
  const localText = path.join(scratch, `${path.basename(remote)}.txt`);
  let created = false;
  try {
    await execute(ssh, [...options, target, `umask 077; mkdir ${shellQuote(remote)}`], 30000);
    created = true;
    await execute(scp, [...options, input, `${target}:${remote}/input.wav`], 5 * 60_000);
    await execute(ssh, [...options, target, command], 60 * 60_000);
    await execute(scp, [...options, `${target}:${remote}/out.txt`, localText], 5 * 60_000);
    return await fs.readFile(localText, "utf8");
  } finally {
    if (created) {
      await execute(ssh, [...options, target, `rm -rf ${shellQuote(remote)}`], 30000)
        .catch(() => console.warn(`  Remote cleanup failed; temporary audio may remain at ${target}:${remote}`));
    }
  }
}
