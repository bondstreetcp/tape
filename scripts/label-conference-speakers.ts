/** Enrich one saved recording without downloading it or invoking the LLM. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { labelConferenceSpeakers, type DiarizationConfig } from "./conference-speakers";
import type { AsrConfig } from "./conference-media";
async function main() {
  const [conference, talk] = process.argv.slice(2);
  if (!/^\d+$/.test(conference || "") || !/^\d+$/.test(talk || "")) throw new Error("Usage: npm run conference:speakers -- CONFERENCE_ID TALK_ID");
  const config = JSON.parse(await fs.readFile(".conference-runner/config.json","utf8")) as {ffmpeg:string;asr:AsrConfig;diarization?:DiarizationConfig};
  if (!config.diarization) throw new Error("Configure diarization in .conference-runner/config.json first");
  await labelConferenceSpeakers(path.resolve(".conference-runner/runs",conference,talk),config.ffmpeg,config.asr,config.diarization);
  console.log("Speaker transcript saved. Raw transcript preserved; publication is separate.");
}
main().catch(error=>{console.error((error as Error).message);process.exitCode=1;});
