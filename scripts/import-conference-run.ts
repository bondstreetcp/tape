/** Merge completed conference artifacts into the authoritative archive. Dry-run unless --apply. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveSymbol, webcastUrl, type ConferenceTalk } from "../lib/conferenceRunner";
import { loadCallRecord, saveCallRecord } from "../lib/callsArchive";
import type { CallDigest } from "../lib/callDigests";
async function main() {
  const dir = path.resolve(process.argv[2] || "");
  const apply = process.argv.includes("--apply");
  const read = async (file: string) => JSON.parse(await fs.readFile(file, "utf8"));
  const manifest = await read(path.join(dir, "manifest.json")) as { id: string; title: string; url: string; talks: ConferenceTalk[] };
  if (webcastUrl(manifest.url).searchParams.get("ei") !== manifest.id) throw new Error("Conference identity mismatch");
  const stocks: { name: string; symbol: string }[] = [];
  for (const entry of await fs.readdir("data", { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const snap = await read(path.join("data", entry.name, "snapshot.json")).catch(() => null);
    if (Array.isArray(snap?.stocks)) stocks.push(...snap.stocks);
  }
  let imported = 0;
  for (const talk of manifest.talks) {
    if (!/^\d+$/.test(talk.id) || webcastUrl(talk.url).searchParams.get("ei") !== talk.id) throw new Error("Invalid webcast identity");
    const talkDir = path.join(dir, talk.id);
    const digest = await read(path.join(talkDir, "digest.json")).catch(() => null) as CallDigest | null;
    if (!digest) continue;
    const symbol = resolveSymbol(talk.name, talk.symbol ? { [talk.name]: talk.symbol } : {}, stocks);
    if (!symbol) { console.log(`UNMAPPED ${talk.name} (${talk.id})`); continue; }
    const rawText = await fs.readFile(path.join(talkDir, "transcript.txt"), "utf8");
    const labeled = await fs.readFile(path.join(talkDir, "transcript.speakers.txt"), "utf8").catch((e: NodeJS.ErrnoException) => { if(e.code === "ENOENT") return null; throw e; });
    if (labeled) {
      const provenance = await read(path.join(talkDir, "speakers/completed.json"));
      if (provenance.sourceHash !== createHash("sha256").update(rawText).digest("hex")) throw new Error(`Stale speaker alignment for ${talk.name}`);
    }
    const text = labeled || rawText;
    if (text.length < 100 || !digest.tldr || !digest.digestedAt) throw new Error(`Incomplete result for ${talk.name}`);
    const period = `conference-${manifest.id}-${talk.id}`;
    const existing = await loadCallRecord(symbol, period);
    if (existing && (existing.eventType !== "conference" || (existing.transcript.text !== text && existing.transcript.text !== rawText))) throw new Error(`Conflicting archive record ${symbol}/${period}`);
    if (existing?.digest && existing.transcript.text === text && Date.parse(existing.digest.digestedAt) >= Date.parse(digest.digestedAt)) { console.log(`UNCHANGED ${symbol} ${talk.name}`); continue; }
    console.log(`${apply ? "MERGE" : "WOULD MERGE"} ${symbol} ${talk.name}`);
    const selectedDigest = existing?.digest && Date.parse(existing.digest.digestedAt) > Date.parse(digest.digestedAt) ? existing.digest : digest;
    if (apply) await saveCallRecord({ symbol, fiscalPeriod: period, callDate: talk.date, title: `${talk.name} — ${manifest.title}`, source: manifest.title, url: talk.url, eventType: "conference", transcript: {text, chars: text.length}, digest: {...selectedDigest, symbol}, fetchedAt: existing?.fetchedAt || new Date().toISOString(), digestedAt: selectedDigest.digestedAt });
    imported++;
  }
  console.log(`${apply ? "Merged" : "Ready"}: ${imported}. No upload performed.`);
}
main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
