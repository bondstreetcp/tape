import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { atomicWrite, nonempty, runCommand, type AsrConfig } from "./conference-media";

export interface DiarizationConfig { python: string; segmentationModel: string; embeddingModel: string; threshold?: number }
interface VoiceLabel { name: string; role: string; evidence: string }
interface Settings { numSpeakers?: number; labels?: Record<string, VoiceLabel>; reviewedBoundaries?: { sourceHash: string; turns: { start: string; speaker: string }[] } }
interface Turns { matchedWordFraction: number; turns: { speaker: string; text: string; start: number | null }[] }

/** Audio clustering is separate from person identification. Names require reviewed, source-grounded labels. */
async function buildSpeakerTranscript(talkDir: string, ffmpeg: string, asr: AsrConfig, config: DiarizationConfig) {
  if (asr.mode !== "whispercpp" || !asr.modelPath) throw new Error("Speaker separation currently requires local whisper.cpp on the processing Mac.");
  const dir = path.join(talkDir, "speakers");
  await fs.mkdir(dir, { recursive: true });
  const settings: Settings = await fs.readFile(path.join(dir, "settings.json"), "utf8").then(JSON.parse).catch((e: NodeJS.ErrnoException) => { if(e.code === "ENOENT") return {}; throw e; });
  if (settings.numSpeakers != null && (!Number.isInteger(settings.numSpeakers) || settings.numSpeakers < 1 || settings.numSpeakers > 20)) throw new Error("Invalid known speaker count");
  const raw = await fs.readFile(path.join(talkDir, "transcript.txt"), "utf8");
  const sourceHash = createHash("sha256").update(raw).digest("hex");
  const signature = createHash("sha256").update(JSON.stringify({ sourceHash, settings, config })).digest("hex");
  const stampFile = path.join(dir, "completed.json");
  const prior = await fs.readFile(stampFile, "utf8").then(JSON.parse).catch(() => null);
  const labeled = path.join(talkDir, "transcript.speakers.txt");
  if (prior?.signature === signature && await nonempty(labeled)) return;
  const wav = path.join(dir, "audio.wav");
  if (!await nonempty(wav)) await runCommand(ffmpeg, ["-nostdin", "-v", "error", "-i", path.join(talkDir,"audio.mp3"), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
  const timed = path.join(dir, "whisper.json");
  if (!await nonempty(timed)) await runCommand(asr.cli, ["-m", asr.modelPath, "-f", wav, "-l", asr.language, "-ojf", "-ml", "1", "-sow", "-of", path.join(dir, "whisper")], 2*60*60_000);
  const diarization = path.join(dir, "diarization.json");
  const modelKey = JSON.stringify({ ...config, numSpeakers: settings.numSpeakers ?? -1 });
  const modelStamp = path.join(dir,"model-config.json");
  if (!await nonempty(diarization) || await fs.readFile(modelStamp,"utf8").catch(()=>"") !== modelKey) {
    await runCommand(config.python, ["scripts/diarize-conference.py", wav, diarization, "--segmentation", config.segmentationModel, "--embedding", config.embeddingModel, "--threshold", String(config.threshold ?? 0.8), "--speakers", String(settings.numSpeakers ?? -1)], 2*60*60_000);
    await atomicWrite(modelStamp,modelKey);
  }
  const turnsFile = path.join(dir, "turns.json");
  await runCommand(config.python,["scripts/align-conference-speakers.py",path.join(talkDir,"transcript.txt"),timed,diarization,turnsFile]);
  const result = JSON.parse(await fs.readFile(turnsFile,"utf8")) as Turns;
  if (settings.reviewedBoundaries) {
    if (settings.reviewedBoundaries.sourceHash !== sourceHash) throw new Error("Reviewed boundaries belong to a different raw transcript");
    let previous = -1;
    const boundaries = settings.reviewedBoundaries.turns.map(turn => {
      const offset = raw.indexOf(turn.start,previous+1);
      if (offset < 0 || !turn.start.trim() || (turn.speaker !== "unknown" && !settings.labels?.[turn.speaker])) throw new Error("Invalid reviewed speaker boundary");
      previous = offset; return {...turn,offset};
    });
    if (boundaries[0]?.offset !== 0) throw new Error("Reviewed boundaries must cover the complete transcript");
    result.turns = boundaries.map((turn,i)=>({speaker:turn.speaker,text:raw.slice(turn.offset,boundaries[i+1]?.offset ?? raw.length).trim(),start:null}));
    await atomicWrite(path.join(dir,"turns.reviewed.json"),JSON.stringify(result,null,2));
  }
  const normalize = (s: string) => s.replace(/\s+/g," ").trim();
  if (normalize(result.turns.map(t=>t.text).join(" ")) !== normalize(raw)) throw new Error("Speaker alignment changed transcript words");
  const out = result.turns.map(turn => {
    const label = settings.labels?.[turn.speaker];
    if (label && (!label.evidence || !normalize(raw).includes(normalize(label.evidence)))) throw new Error(`Missing attribution evidence for ${turn.speaker}`);
    const header = label ? `${label.name}, ${label.role}` : turn.speaker === "unknown" ? "Unidentified speaker" : `Speaker ${Number(turn.speaker.replace("speaker_", "")) + 1} (identity unconfirmed)`;
    if (header.length > 140 || /[:\n\r]/.test(header)) throw new Error("Invalid speaker label");
    return `${header}: ${turn.text}`;
  }).join("\n\n");
  await atomicWrite(labeled,out);
  await atomicWrite(stampFile,JSON.stringify({ signature, sourceHash, method:settings.reviewedBoundaries ? "audio-alignment-with-reviewed-contextual-speaker-boundaries" : "audio-diarization-with-reviewed-identity-labels", matchedWordFraction:result.matchedWordFraction, turns:result.turns.length, namedSpeakers:Object.keys(settings.labels || {}).length },null,2));
}

export async function labelConferenceSpeakers(talkDir: string, ffmpeg: string, asr: AsrConfig, config: DiarizationConfig) {
  await fs.mkdir(talkDir,{recursive:true});
  const lock = path.join(talkDir,"speakers.lock");
  const owner = await fs.open(lock,"wx");
  await owner.writeFile(String(process.pid)); await owner.close();
  try { await buildSpeakerTranscript(talkDir,ffmpeg,asr,config); }
  finally { await fs.unlink(lock); }
}
