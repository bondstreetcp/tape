import { test } from "node:test";
import assert from "node:assert/strict";
import { renderContextTurns } from "../scripts/conference-context-speakers";
import { parseTranscriptTurns } from "../lib/transcriptTurns";
test("context boundaries preserve words and separate moderator from management", () => {
  const lines = ["Welcome. How is demand?", "Demand is improving.", "We remain cautious."];
  const turns = parseTranscriptTurns(renderContextTurns(lines, [{ line: 0, role: "moderator" }, { line: 1, role: "management" }]));
  assert.deepEqual(turns.map(t => t.side), ["analyst", "mgmt"]);
  assert.equal(turns.map(t => t.text).join(" ").replace(/\s+/g, " "), lines.join(" "));
  assert.match(turns[0].role, /inferred from transcript/);
});
test("rejects missing, unordered and out-of-range boundaries", () => {
  for (const boundaries of [[{line: 1, role: "management" as const}], [{line: 0, role: "moderator" as const}, {line: 0, role: "management" as const}], [{line: 0, role: "moderator" as const}, {line: 9, role: "management" as const}]]) {
    assert.throws(() => renderContextTurns(["one", "two"], boundaries));
  }
});
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { labelContextSpeakers } from "../scripts/conference-context-speakers";
test("invalid model boundaries retry without committing partial turns or rewriting words", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tape-speakers-"));
  const oldFetch = globalThis.fetch;
  const url = process.env.LLM_LOCAL_BASE_URL, model = process.env.LLM_LOCAL_MODEL;
  let calls = 0;
  try {
    process.env.LLM_LOCAL_BASE_URL = "http://localhost:9999/v1";
    process.env.LLM_LOCAL_MODEL = "test-model";
    const raw = "Welcome. How is demand?\nDemand is improving.";
    await fs.writeFile(path.join(dir, "transcript.txt"), raw);
    globalThis.fetch = async () => {
      calls++;
      const turns = calls === 1 ? [{line:0,role:"moderator"},{line:"management"}] : [{line:0,role:"moderator"},{line:1,role:"management"}];
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({turns})}}]}),{status:200});
    };
    assert.equal(await labelContextSpeakers(dir,{model:"test-model",local:true}),true);
    assert.equal(calls,2);
    const text = await fs.readFile(path.join(dir,"transcript.speakers.txt"),"utf8");
    assert.equal(parseTranscriptTurns(text).length,2);
    assert.equal(await fs.readFile(path.join(dir,"transcript.txt"),"utf8"),raw);
    assert.equal(await labelContextSpeakers(dir,{model:"test-model",local:true}),false);
    assert.equal(calls,2);
  } finally {
    globalThis.fetch=oldFetch;
    if(url===undefined) delete process.env.LLM_LOCAL_BASE_URL; else process.env.LLM_LOCAL_BASE_URL=url;
    if(model===undefined) delete process.env.LLM_LOCAL_MODEL; else process.env.LLM_LOCAL_MODEL=model;
    await fs.rm(dir,{recursive:true,force:true});
  }
});
