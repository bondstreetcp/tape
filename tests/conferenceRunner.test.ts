import { test } from "node:test";
import assert from "node:assert/strict";
import { agendaDate, resolveSymbol, runTalkStages, safeError, speakerLink, streamForTalk, webcastUrl, type StageActions } from "../lib/conferenceRunner";

test("conference adapter reads the observed Barclays company/day link shapes", () => {
  assert.deepEqual(speakerLink("showSpeaker('https://event.webcasts.com/starthere.jsp?ei=1773017&amp;tp_key=417fe15654','');"), { id: "1773017", url: "https://event.webcasts.com/starthere.jsp?ei=1773017&tp_key=417fe15654" });
  assert.equal(agendaDate("changeday('9/8/2026')"), "2026-09-08");
  assert.equal(agendaDate("changeday('2/30/2026')"), null);
  assert.equal(speakerLink("doSomethingElse()"), null);
});

test("conference links reject unrelated hosts and nonnumeric IDs", () => {
  for (const url of ["https://event.webcasts.com.evil.test/?ei=123", "file:///tmp/a?ei=123", "https://event.webcasts.com/?ei=../foo"]) assert.throws(() => webcastUrl(url));
  assert.equal(speakerLink("showSpeaker('https://example.org/?ei=123','')"), null);
});

test("only a stream for the selected talk is captured; stale player and lookalike hosts are rejected", () => {
  const good = "https://od.cdn.webcasts.com/securehds/_definst_/mp4:conf001/1773017/audio.m4a/playlist.m3u8?t=secret";
  assert.equal(streamForTalk(good, "1773017"), true);
  assert.equal(streamForTalk(good, "1773002"), false);
  assert.equal(streamForTalk(good.replace("webcasts.com", "webcasts.com.evil.test"), "1773017"), false);
  assert.equal(streamForTalk(good.replace("https:", "http:"), "1773017"), false);
});

test("company matching uses explicit mappings or unambiguous exact names, never guesses", () => {
  assert.equal(resolveSymbol("Freshpet", { Freshpet: "frpt" }, []), "FRPT");
  assert.equal(resolveSymbol("Private Company", {}, []), undefined);
  assert.equal(resolveSymbol("Acme", {}, [{ name: "Acme", symbol: "A" }, { name: "Acme", symbol: "B" }]), undefined);
  assert.equal(resolveSymbol("Acme", {}, [{ name: "Acme", symbol: "A" }, { name: "Acme", symbol: "A" }]), "A");
  assert.throws(() => resolveSymbol("Acme", { Acme: "../../elsewhere" }, []));
});

test("manifest errors redact signed URLs", () => {
  assert.equal(safeError(new Error("failed https://cdn.webcasts.com/audio?t=secret")), "failed [URL redacted]");
});

const paths = { audio: "audio.mp3", transcript: "transcript.txt", digest: "digest.json" };
function harness(initial: string[] = [], fail?: "audio" | "transcript" | "digest") {
  const files = new Set(initial);
  const calls: string[] = [];
  const actions: StageActions = {
    exists: async file => files.has(file),
    capture: async () => { calls.push("capture"); if (fail === "audio") throw new Error("expired"); files.add(paths.audio); },
    transcribe: async () => { calls.push("transcribe"); if (fail === "transcript") throw new Error("ASR unavailable"); files.add(paths.transcript); },
    digest: async () => { calls.push("digest"); if (fail === "digest") throw new Error("LLM unavailable"); files.add(paths.digest); },
    checkpoint: async stage => { calls.push(`saved:${stage}`); },
  };
  return { files, calls, actions };
}

test("pipeline commits stages in order, without treating queued capture as success", async () => {
  const h = harness();
  await runTalkStages(paths, h.actions);
  assert.deepEqual(h.calls, ["capture", "saved:audio", "transcribe", "saved:transcript", "digest", "saved:digest"]);
});

test("expired download stops downstream work and does not mark audio complete", async () => {
  const h = harness([], "audio");
  await assert.rejects(runTalkStages(paths, h.actions), /expired/);
  assert.deepEqual(h.calls, ["capture"]);
});

test("ASR failure keeps downloaded audio; a rerun resumes at transcription", async () => {
  const h = harness([], "transcript");
  await assert.rejects(runTalkStages(paths, h.actions), /ASR unavailable/);
  const resume = harness([...h.files]);
  await runTalkStages(paths, resume.actions);
  assert.equal(resume.calls.includes("capture"), false);
  assert.equal(resume.calls.includes("transcribe"), true);
});

test("LLM failure preserves transcript; retry does not redownload/retranscribe", async () => {
  const h = harness([], "digest");
  await assert.rejects(runTalkStages(paths, h.actions), /LLM unavailable/);
  const resume = harness([...h.files]);
  await runTalkStages(paths, resume.actions);
  assert.deepEqual(resume.calls, ["saved:audio", "saved:transcript", "digest", "saved:digest"]);
});

test("complete runs do not repeat any processing", async () => {
  const h = harness(Object.values(paths));
  await runTalkStages(paths, h.actions);
  assert.deepEqual(h.calls, ["saved:audio", "saved:transcript", "saved:digest"]);
});

test("capture-only and transcribe-only stop at their requested stage", async () => {
  const audio = harness();
  await runTalkStages(paths, audio.actions, "audio");
  assert.deepEqual(audio.calls, ["capture", "saved:audio"]);
  const text = harness();
  await runTalkStages(paths, text.actions, "transcript");
  assert.equal(text.calls.includes("digest"), false);
  assert.equal(text.files.has(paths.transcript), true);
});

test("a successful child process without an artifact is a failure", async () => {
  const h = harness();
  h.actions.capture = async () => {};
  await assert.rejects(runTalkStages(paths, h.actions), /no committed artifact/);
  assert.deepEqual(h.calls, []);
});
