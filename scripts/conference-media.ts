import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { BrowserContext } from "playwright-core";
import type { CapturedStream } from "./conference-browser";
import type { SshAsrConfig } from "../lib/conferenceSsh";
import { transcribeRemoteChunk } from "./conference-ssh";

export async function runCommand(binary: string, args: string[], timeoutMs = 30 * 60_000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, shell: false });
    // Provider/downloader logs can contain signed URLs, so report only binary + exit status.
    child.stderr.resume();
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else child.kill("SIGKILL");
      reject(new Error(`${path.basename(binary)} timed out`));
    }, timeoutMs);
    child.once("error", () => { clearTimeout(timer); reject(new Error(`Cannot start ${path.basename(binary)}. Check its configured path/install.`)); });
    child.once("close", code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`${path.basename(binary)} exited ${code}; source may be unavailable or session token rejected`)); });
  });
}

export async function nonempty(file: string): Promise<boolean> {
  return fs.stat(file).then(s => s.isFile() && s.size > 0, () => false);
}

export async function atomicWrite(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, text, { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
}

export async function downloadAudio(stream: CapturedStream, context: BrowserContext, output: string, bins: { ytdlp: string; ffmpeg: string }): Promise<void> {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const scratch = await fs.mkdtemp(path.join(path.dirname(output), ".download-"));
  try {
    // Use only cookies relevant to this webcast CDN. Temporary jar is removed even when the download fails.
    const cookies = await context.cookies(stream.url);
    const jar = path.join(scratch, "cookies.txt");
    const rows = cookies.map(c => [c.domain, c.domain.startsWith(".") ? "TRUE" : "FALSE", c.path, c.secure ? "TRUE" : "FALSE", Math.max(0, Math.floor(c.expires)), c.name, c.value].join("\t"));
    await fs.writeFile(jar, `# Netscape HTTP Cookie File\n${rows.join("\n")}\n`, { mode: 0o600 });
    const ffmpegLocation = bins.ffmpeg === "ffmpeg" ? [] : ["--ffmpeg-location", bins.ffmpeg];
    await runCommand(bins.ytdlp, ["--no-playlist", "--match-filter", "!is_live", "--quiet", "--no-warnings", "--retries", "1", "--fragment-retries", "2", "--abort-on-unavailable-fragments", "--socket-timeout", "30", "--cookies", jar, "--referer", stream.referer, "--user-agent", stream.userAgent, ...ffmpegLocation, "-x", "--audio-format", "mp3", "-o", path.join(scratch, "audio.%(ext)s"), "--", stream.url]);
    const audio = path.join(scratch, "audio.mp3");
    if (!await nonempty(audio)) throw new Error("Downloader returned no audio.");
    // Decode the whole artifact before committing it; truncated/broken files are not restart checkpoints.
    await runCommand(bins.ffmpeg, ["-nostdin", "-v", "error", "-xerror", "-i", audio, "-f", "null", "-"], 5 * 60_000);
    await fs.rename(audio, output);
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}

export interface AsrConfig {
  mode: "http" | "whispercpp" | "ssh";
  ssh?: SshAsrConfig;
  url: string;
  model: string;
  keyEnv?: string;
  cli: string;
  modelPath?: string;
  language: string;
}

export async function transcribeAudio(audio: string, output: string, ffmpeg: string, config: AsrConfig, execute = runCommand): Promise<void> {
  const scratch = await fs.mkdtemp(path.join(path.dirname(output), ".asr-"));
  try {
    // Ten-minute chunks avoid common HTTP upload limits and keep local decoding memory bounded.
    await execute(ffmpeg, ["-nostdin", "-v", "error", "-y", "-i", audio, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-f", "segment", "-segment_time", "600", path.join(scratch, "part-%04d.wav")]);
    const parts = (await fs.readdir(scratch)).filter(n => n.endsWith(".wav")).sort();
    if (!parts.length) throw new Error("No audio chunks produced.");
    const texts: string[] = [];
    for (const [index, part] of parts.entries()) {
      console.log(`  transcription ${index + 1}/${parts.length}`);
      const input = path.join(scratch, part);
      let text: string;
      if (config.mode === "ssh") {
        text = await transcribeRemoteChunk(input, scratch, config, execute);
      } else if (config.mode === "whispercpp") {
        if (!config.modelPath) throw new Error("Set asr.modelPath for whisper.cpp.");
        const out = path.join(scratch, "text");
        await execute(config.cli, ["-m", config.modelPath, "-f", input, "-l", config.language, "-otxt", "-of", out], 60 * 60_000);
        text = await fs.readFile(`${out}.txt`, "utf8");
      } else {
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(await fs.readFile(input))], { type: "audio/wav" }), part);
        form.append("model", config.model);
        form.append("language", config.language);
        form.append("response_format", "json");
        const key = config.keyEnv ? process.env[config.keyEnv] : undefined;
        const response = await fetch(`${config.url.replace(/\/$/, "")}/audio/transcriptions`, { method: "POST", body: form, headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(30 * 60_000) });
        if (!response.ok) throw new Error(`ASR returned HTTP ${response.status} for chunk ${index + 1}`);
        const result = await response.json() as { text?: unknown };
        if (typeof result.text !== "string") throw new Error(`ASR chunk ${index + 1} has no text`);
        text = result.text;
      }
      texts.push(text.trim());
    }
    const text = texts.join("\n\n").trim();
    if (text.length < 100) throw new Error("Transcript too short; not marking it complete.");
    await atomicWrite(output, text);
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}
