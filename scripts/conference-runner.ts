/** Interactive, resumable conference → audio → text → grounded LLM notes. See docs/conference-runner.md. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { ConferenceBrowser } from "./conference-browser";
import { labelConferenceSpeakers, type DiarizationConfig } from "./conference-speakers";
import { atomicWrite, downloadAudio, nonempty, runCommand, transcribeAudio, type AsrConfig } from "./conference-media";
import { resolveSymbol, runTalkStages, safeError, webcastUrl, type ConferenceTalk } from "../lib/conferenceRunner";

interface Config {
  contextSpeakers?: boolean;
  priorityTalks?: string[];
  diarization?: DiarizationConfig;
  channel: string;
  ytdlp: string;
  ffmpeg: string;
  loginTimeoutMs: number;
  streamTimeoutMs: number;
  asr: AsrConfig;
  llm: { mode: "local" | "cloud"; url?: string; model?: string };
  symbols: Record<string, string>;
}
interface TalkState extends ConferenceTalk { stage?: "audio" | "transcript" | "digest"; archived?: boolean; error?: string }
interface Manifest { version: 1; id: string; title: string; url: string; updatedAt: string; talks: TalkState[] }

const DEFAULTS: Config = {
  contextSpeakers: true,
  channel: process.platform === "win32" ? "msedge" : "chrome",
  ytdlp: "yt-dlp", ffmpeg: "ffmpeg", loginTimeoutMs: 10 * 60_000, streamTimeoutMs: 45_000,
  asr: { mode: "http", url: "http://127.0.0.1:8000/v1", model: "whisper-1", cli: "whisper-cli", language: "en" },
  llm: { mode: "local" }, symbols: {},
};

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    config: { type: "string" }, only: { type: "string" }, limit: { type: "string" },
    "capture-only": { type: "boolean" }, "transcribe-only": { type: "boolean" },
    "process-only": { type: "boolean" }, discover: { type: "boolean" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("npm run conference -- [conference-url] [--config file] [--only Freshpet] [--limit 1]\n  --discover          save agenda only\n  --capture-only      download audio only\n  --transcribe-only   download + transcribe, skip LLM\n  --process-only      use saved agenda/audio without opening a browser\nRe-run the same URL to resume. Local settings: .conference-runner/config.json");
    return;
  }
  if (values["capture-only"] && values["transcribe-only"]) throw new Error("Choose capture-only OR transcribe-only.");
  const limit = values.limit == null ? Infinity : Number(values.limit);
  if (!(limit > 0) || (limit !== Infinity && !Number.isInteger(limit))) throw new Error("--limit must be a positive integer.");
  const privateDir = path.resolve(".conference-runner");
  const supplied = await readJson<Partial<Config>>(path.resolve(values.config || path.join(privateDir, "config.json"))) || {};
  const config: Config = { ...DEFAULTS, ...supplied, asr: { ...DEFAULTS.asr, ...supplied.asr }, llm: { ...DEFAULTS.llm, ...supplied.llm } };
  if (!["local", "cloud"].includes(config.llm.mode) || !["http", "whispercpp", "ssh"].includes(config.asr.mode)) throw new Error("Invalid ASR or LLM mode in config.");
  // Node's env loader makes existing Tape endpoints/keys available, without storing secrets in config or manifests.
  try { process.loadEnvFile(".env.local"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let input = positionals[0];
  if (!input) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { input = await prompt.question("Conference link: "); } finally { prompt.close(); }
  }
  const url = webcastUrl(input.trim());
  const id = url.searchParams.get("ei")!;
  // Private working files live OUTSIDE data/: recordings/sessions must not ride Tape's normal R2 data upload.
  const dir = path.join(privateDir, "runs", id);
  await fs.mkdir(dir, { recursive: true });
  // One browser profile and one writer at a time. An interrupted process leaves an explicit, inspectable lock.
  const lock = path.join(privateDir, "run.lock");
  const owner = await fs.open(lock, "wx").catch(() => { throw new Error(`A runner lock already exists at ${lock}. If no runner is active, remove that stale lock before retrying.`); });
  await owner.writeFile(String(process.pid));
  await owner.close();
  let browser: ConferenceBrowser | undefined;
  try {
    const manifestFile = path.join(dir, "manifest.json");
    let manifest = await readJson<Manifest>(manifestFile);
    const save = () => { manifest!.updatedAt = new Date().toISOString(); return atomicWrite(manifestFile, JSON.stringify(manifest, null, 2)); };
    if (!values["process-only"]) {
      if (!values.discover) {
        await runCommand(config.ytdlp, ["--version"], 15000);
        await runCommand(config.ffmpeg, ["-version"], 15000);
      }
      browser = await ConferenceBrowser.open({ profile: path.join(privateDir, "browser-profile"), channel: config.channel, loginTimeoutMs: config.loginTimeoutMs, streamTimeoutMs: config.streamTimeoutMs });
      const discovered = await browser.discover(url.href);
      const prior = new Map((manifest?.talks || []).map(t => [t.id, t]));
      const talks = discovered.talks.map(t => ({ ...prior.get(t.id), ...t }));
      // Keep prior records if a later agenda stops listing a talk; never discard completed work.
      for (const previous of prior.values()) if (!talks.some(t => t.id === previous.id)) talks.push(previous);
      manifest = { version: 1, id, title: discovered.title, url: url.href, updatedAt: "", talks };
      await save();
    }
    if (!manifest) throw new Error("No saved manifest; run --discover or capture first.");
    if (manifest.id !== id || manifest.version !== 1) throw new Error("Manifest identity/version mismatch.");
    console.log(`${manifest.title}: ${manifest.talks.length} talks. Files: ${dir}`);
    if (values.discover) return;
    const stocks: { name: string; symbol: string }[] = [];
    for (const universe of await fs.readdir("data", { withFileTypes: true }).catch(() => [])) {
      if (!universe.isDirectory()) continue;
      const snapshot = await readJson<{ stocks?: { name: string; symbol: string }[] }>(path.join("data", universe.name, "snapshot.json"));
      if (Array.isArray(snapshot?.stocks)) stocks.push(...snapshot.stocks);
    }
    const until = values["capture-only"] ? "audio" : values["transcribe-only"] ? "transcript" : "digest";
    const { digestTranscript } = await import("../lib/digestTranscript");
    const { scopedLocalEnv } = await import("../lib/callDigests");
    const scoped = scopedLocalEnv(process.env);
    if (scoped) Object.assign(process.env, scoped);
    if (config.llm.mode === "local") {
      if (config.llm.url) process.env.LLM_LOCAL_BASE_URL = config.llm.url;
      if (config.llm.model) process.env.LLM_LOCAL_MODEL = config.llm.model;
    }
    const { FLASH_MODEL, llmConfigured } = await import("../lib/llm");
    const { loadCallRecord, saveCallRecord } = await import("../lib/callsArchive");
    let summaryUnavailable = "";
    if (until === "digest" && config.llm.mode === "local" && process.env.LLM_LOCAL_BASE_URL) {
      try {
        const response = await fetch(`${process.env.LLM_LOCAL_BASE_URL.replace(/\/$/, "")}/models`, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw Error(`Summary server returned HTTP ${response.status}.`);
      } catch (error) {
        const code = (error as { cause?: { code?: string } }).cause?.code;
        summaryUnavailable = code === "EHOSTUNREACH" && process.platform === "darwin"
          ? "The Mac cannot reach the summary server. Check Node/Tape Local Network permission in macOS and the server connection, then resume. Transcripts are saved."
          : "The summary server is unavailable. Check its connection and running model, then resume. Transcripts are saved.";
      }
      await atomicWrite(path.join(privateDir, "summary-health.json"), JSON.stringify({ ok: !summaryUnavailable, message: summaryUnavailable, checkedAt: new Date().toISOString() }));
    }
    const queue = manifest.talks.filter(t => !values.only || t.id === values.only || t.name.toLowerCase().includes(values.only.toLowerCase())).sort((a, b) => { const rank = (id: string) => { const n = config.priorityTalks?.indexOf(id) ?? -1; return n < 0 ? 999 : n; }; return rank(a.id) - rank(b.id); }).slice(0, limit);
    if (!queue.length) throw new Error("No talks matched --only.");
    if (summaryUnavailable && (await Promise.all(queue.map(t => nonempty(path.join(dir, t.id, "transcript.txt"))))).every(Boolean)) {
      console.error(summaryUnavailable); process.exitCode = 78; return;
    }
    let failed = 0;
    for (const talk of queue) {
      console.log(`\n${talk.name} (${talk.date}; webcast ${talk.id})`);
      const talkDir = path.join(dir, talk.id);
      await fs.mkdir(talkDir, { recursive: true });
      const paths = { audio: path.join(talkDir, "audio.mp3"), transcript: path.join(talkDir, "transcript.txt"), digest: path.join(talkDir, "digest.json") };
      const archive = async () => {
        if (!talk.symbol) return;
        const fiscalPeriod = `conference-${id}-${talk.id}`;
        const existing = await loadCallRecord(talk.symbol, fiscalPeriod);
        const speakerText = path.join(talkDir, "transcript.speakers.txt");
        const text = await fs.readFile(await nonempty(speakerText) ? speakerText : paths.transcript, "utf8");
        const digest = await readJson<import("../lib/callDigests").CallDigest>(paths.digest);
        const selectedDigest = digest ? { ...digest, symbol: talk.symbol } : existing?.transcript.text === text ? existing.digest : null;
        await saveCallRecord({ symbol: talk.symbol, fiscalPeriod, callDate: talk.date, title: `${talk.name} — ${manifest!.title}`, url: talk.url, source: manifest!.title, eventType: "conference", transcript: { text, chars: text.length }, digest: selectedDigest, fetchedAt: existing?.fetchedAt || new Date().toISOString(), digestedAt: selectedDigest?.digestedAt || null });
        talk.archived = true;
      };
      try {
        talk.symbol = resolveSymbol(talk.name, config.symbols, stocks) || talk.symbol;
        const priorDigest = await readJson<import("../lib/callDigests").CallDigest>(paths.digest);
        // Preserve the manually reviewed Freshpet legacy narrative while upgrading statistic-only digests.
        const reviewedNarrative = (priorDigest?.kpis || []).filter(k => k.length > 220).length >= 4;
        const speakerStat = await fs.stat(path.join(talkDir, "transcript.speakers.txt")).catch(() => null);
        const digestStat = await fs.stat(paths.digest).catch(() => null);
        const pendingSpeakerSummary = !!speakerStat && !!digestStat && speakerStat.mtimeMs > digestStat.mtimeMs;
        let refreshDigest = pendingSpeakerSummary || !!priorDigest && !reviewedNarrative && (priorDigest.takeaways?.length || 0) < 4;
        await runTalkStages(paths, {
          exists: file => file === paths.digest && refreshDigest ? Promise.resolve(false) : nonempty(file),
          checkpoint: async stage => {
            if (stage === "transcript" && config.diarization && !summaryUnavailable) {
              console.log("  aligning speaker turns");
              await labelConferenceSpeakers(talkDir, config.ffmpeg, config.asr, config.diarization);
            }
            if (stage === "transcript" && !config.diarization && config.contextSpeakers && !summaryUnavailable && until === "digest") {
              const { labelContextSpeakers } = await import("./conference-context-speakers");
              console.log("  checking contextual moderator/management turns");
              const changed = await labelContextSpeakers(talkDir, { model: config.llm.model || FLASH_MODEL, local: config.llm.mode === "local", timeoutMs: 600_000, retries: 1 });
              refreshDigest ||= changed;
            }
            talk.stage = stage;
            delete talk.error;
            // Raw text reaches the reader before LLM processing, even if inference fails later.
            if (stage !== "audio") await archive();
            await save();
          },
          capture: async () => {
            if (!browser) throw new Error("Missing audio; --process-only cannot capture it.");
            for (let attempt = 1; ; attempt++) {
              try {
                await browser.capture(talk, (stream, context) => downloadAudio(stream, context, paths.audio, config));
                break;
              } catch (error) {
                if (attempt >= 2) throw error;
                console.log("  capture failed; reopening the player for a fresh token (attempt 2/2)");
              }
            }
          },
          transcribe: () => transcribeAudio(paths.audio, paths.transcript, config.ffmpeg, config.asr),
          digest: async () => {
            if (summaryUnavailable) throw Error(summaryUnavailable);
            const local = config.llm.mode === "local";
            if (local && !(process.env.LLM_LOCAL_BASE_URL && process.env.LLM_LOCAL_MODEL)) throw new Error("Set the local LLM URL/model in config or CALL_DIGEST_LOCAL_URL/MODEL in .env.local. Audio and transcript are saved.");
            if (!await llmConfigured()) throw new Error("No LLM configured; transcript is saved.");
            const speakerText = path.join(talkDir, "transcript.speakers.txt");
            const text = await fs.readFile(await nonempty(speakerText) ? speakerText : paths.transcript, "utf8");
            const model = config.llm.model || FLASH_MODEL;
            const digest = await digestTranscript({ symbol: talk.symbol || "", name: talk.name, sector: null, marketCap: null, title: `${talk.name} — ${manifest!.title}`, date: talk.date, url: talk.url, source: manifest!.title, text, eventType: "conference" }, { model, local, timeoutMs: 600_000, retries: 1 }, local ? `local:${process.env.LLM_LOCAL_MODEL}` : model, talk.date);
            if (!digest || (digest.takeaways?.length || 0) < 4) throw new Error("LLM returned no validated digest; transcript retained for retry.");
            await atomicWrite(paths.digest, JSON.stringify(digest, null, 2));
            refreshDigest = false;
          },
        }, until);
        console.log(`  saved through ${talk.stage}${talk.archived ? `; archived under ${talk.symbol}` : "; files kept by webcast ID"}`);
      } catch (error) {
        failed++;
        talk.error = safeError(error);
        await save();
        console.error(`  FAILED: ${talk.error}`);
      }
    }
    console.log(`\n${queue.length - failed}/${queue.length} talks completed through ${until}; ${failed} failed. Re-run to resume. No R2 upload performed.`);
    if (failed) process.exitCode = summaryUnavailable ? 78 : 1;
  } finally {
    try { await browser?.close(); } finally { await fs.unlink(lock); }
  }
}

main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
