/** Build remote commands from quoted argv; never interpolate model paths or language as shell code. */
export const shellQuote = (value: string): string => "'" + value.replace(/'/g, "'\"'\"'") + "'";

export interface SshAsrConfig {
  target: string; // existing SSH alias or user@Tailscale-host
  identityFile?: string;
  binary?: string;
  copyBinary?: string;
}

export function sshOptions(config: SshAsrConfig): string[] {
  if (!/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(config.target))
    throw new Error("ASR SSH target must be a saved host alias or user@hostname/IP.");
  return ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=yes", ...(config.identityFile ? ["-o", "IdentitiesOnly=yes", "-i", config.identityFile] : [])];
}

export function whisperRemoteCommand(cli: string, model: string, language: string, jobDir: string): string {
  if (!cli.startsWith("/") || !model.startsWith("/")) throw new Error("SSH Whisper CLI and model paths must be absolute paths on the Mac.");
  if (!/^\/tmp\/tape-asr-[a-f0-9-]+$/.test(jobDir)) throw new Error("Invalid remote ASR job directory.");
  return [cli, "-m", model, "-f", `${jobDir}/input.wav`, "-l", language, "-otxt", "-of", `${jobDir}/out`].map(shellQuote).join(" ");
}
