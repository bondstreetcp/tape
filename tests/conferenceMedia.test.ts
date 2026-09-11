import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nonempty, transcribeAudio, type AsrConfig } from "../scripts/conference-media";
import { digestTranscript } from "../lib/digestTranscript";

test("ASR uploads ordered chunks, rejects partial results, and commits only complete text", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tape-conf-asr-"));
  let requests = 0;
  let failSecond = true;
  const server = createServer(async (req, res) => {
    requests++;
    const buffers: Buffer[] = [];
    for await (const chunk of req) buffers.push(Buffer.from(chunk));
    const body = Buffer.concat(buffers).toString();
    assert.match(body, /name="model"/);
    assert.match(body, /name="file"; filename="part-000[01].wav"/);
    if (failSecond && requests === 2) { res.writeHead(503); res.end(); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ text: `Part ${requests}. ` + "Management discussed demand and operating trends in the presentation. ".repeat(3) }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  const config: AsrConfig = { mode: "http", url, model: "fixture", cli: "unused", language: "en" };
  // This fixture exercises actual multipart HTTP; audio conversion itself is substituted with two chunks.
  const fakeConvert = async (_binary: string, args: string[]) => {
    const template = args.at(-1)!;
    await fs.writeFile(template.replace("%04d", "0000"), "fixture audio one");
    await fs.writeFile(template.replace("%04d", "0001"), "fixture audio two");
  };
  const out = path.join(dir, "transcript.txt");
  try {
    await assert.rejects(transcribeAudio("fixture.mp3", out, "fixture-ffmpeg", config, fakeConvert), /HTTP 503/);
    assert.equal(await nonempty(out), false, "failed second chunk must not commit first chunk alone");
    assert.deepEqual(await fs.readdir(dir), [], "temporary audio chunks removed after failure");
    failSecond = false;
    requests = 0;
    await transcribeAudio("fixture.mp3", out, "fixture-ffmpeg", config, fakeConvert);
    const text = await fs.readFile(out, "utf8");
    assert.ok(text.indexOf("Part 1.") < text.indexOf("Part 2."));
    assert.deepEqual(await fs.readdir(dir), ["transcript.txt"]);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("conference LLM path sends conference context and rejects an invented quote through existing validation", async () => {
  let system = "";
  const server = createServer(async (req, res) => {
    const buffers: Buffer[] = [];
    for await (const chunk of req) buffers.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(buffers).toString());
    system = body.messages[0].content;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      tldr: "Management described continued demand growth and ongoing capacity investment.",
      tone: "measured", guidance: { action: "none", detail: "No new guidance was provided." },
      kpis: ["Sales grew 12% during the period."],
      takeaways: [{ heading: "Distribution supports growth", detail: "Distribution expansion supported demand. Capacity investment remains a priority as the company serves that demand." }],
      drivers: ["Distribution expansion supported demand.", "Capacity investment remains a priority."],
      qa: [], readThrough: [], watch: ["Watch distribution expansion."],
      quotes: [{ speaker: "Management", text: "Sales grew 12% during the period." }, { speaker: "Management", text: "We guarantee profits will triple tomorrow." }],
    }) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const previousUrl = process.env.LLM_LOCAL_BASE_URL;
  const previousModel = process.env.LLM_LOCAL_MODEL;
  process.env.LLM_LOCAL_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  process.env.LLM_LOCAL_MODEL = "fixture";
  try {
    const digest = await digestTranscript({ eventType: "conference", symbol: "FRPT", name: "Freshpet", sector: null, marketCap: null, title: "Fixture Conference", date: "2026-09-10", url: "", source: "fixture", text: "Sales grew 12% during the period. Distribution expansion supported demand. Capacity investment remains a priority. No new guidance was provided." }, { model: "fixture", local: true, retries: 1 }, "local:fixture", "2026-09-10");
    assert.match(system, /CONFERENCE PRESENTATION/);
    assert.match(system, /'takeaways' array MUST contain 4-5 ranked/);
    assert.doesNotMatch(system, /return an empty takeaways array/);
    assert.ok(digest);
    assert.equal(digest.takeaways?.[0].heading, "Distribution supports growth");
    assert.equal(digest.quotes.length, 1);
    assert.equal(digest.quotes[0].text, "Sales grew 12% during the period.");
  } finally {
    if (previousUrl == null) delete process.env.LLM_LOCAL_BASE_URL; else process.env.LLM_LOCAL_BASE_URL = previousUrl;
    if (previousModel == null) delete process.env.LLM_LOCAL_MODEL; else process.env.LLM_LOCAL_MODEL = previousModel;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
