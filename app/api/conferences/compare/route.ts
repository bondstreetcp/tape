import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadSymbolCalls } from "@/lib/callsArchive";
import { COMPARISON_PROMPT, COMPARISON_VERSION, precedingEarnings, verifiedChanges, type CallComparison } from "@/lib/callComparison";
import { boundedJson, conferenceServiceDir, readJson, writeJson } from "@/lib/conferencePortal";
import { portalUser } from "@/lib/conferencePortalAuth";
import { chatJSON, PRO_MODEL, NO_ADVICE } from "@/lib/llm";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
const pending = new Map<string, Promise<CallComparison>>();
async function pair(symbol: string, period: string) {
  if (!/^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(symbol) || !/^(\d{4}-Q[1-4]|conference-\d+-\d+)$/.test(period)) throw Error("Invalid company or presentation.");
  const calls = await loadSymbolCalls(symbol), after = calls.find(c => c.fiscalPeriod === period);
  if (!after) throw Error("Transcript not found.");
  const before = precedingEarnings(calls, after); if (!before) throw Error("No earlier earnings transcript is available for this comparison.");
  if (!before.transcript.text || !after.transcript.text) throw Error("Both transcripts are required.");
  const hash = createHash("sha256").update(JSON.stringify([COMPARISON_VERSION,symbol,before.fiscalPeriod,before.callDate,before.transcript.text,after.fiscalPeriod,after.callDate,after.transcript.text])).digest("hex");
  return { before, after, hash, file: path.join(conferenceServiceDir(), "comparisons", `${hash}.json`) };
}
export async function GET(req: Request) {
  try {
    const url = new URL(req.url), p = await pair(url.searchParams.get("symbol") || "", url.searchParams.get("period") || "");
    return NextResponse.json({ comparison: await readJson<CallComparison>(p.file), before: p.before.fiscalPeriod }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
export async function POST(req: Request) {
  if (!await portalUser(req)) return NextResponse.json({ error: "Unlock the Conferences page first to generate comparisons." }, { status: 401 });
  if (req.headers.get("origin") !== new URL(req.url).origin && req.headers.get("origin") !== `https://${req.headers.get("host")}`) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const body = await boundedJson(req, 2000) as { symbol: string; period: string };
    const p = await pair(body.symbol, body.period), existing = await readJson<CallComparison>(p.file);
    if (existing) return NextResponse.json({ comparison: existing });
    if (!pending.has(p.hash)) {
      if (pending.size >= 2) return NextResponse.json({ error: "Two comparisons are running. Try again shortly." }, { status: 429 });
      if (p.before.transcript.text.length + p.after.transcript.text.length > 300_000) throw Error("These transcripts need a longer-document comparison. No partial comparison was generated.");
      const generate = async () => {
        const raw = await chatJSON<unknown>(COMPARISON_PROMPT + NO_ADVICE,
          `EARLIER: ${p.before.title}, ${p.before.callDate}\n${p.before.transcript.text}\n\nLATER: ${p.after.title}, ${p.after.callDate}\n${p.after.transcript.text}`, { model: PRO_MODEL, local: false, maxTokens: 6500, timeoutMs: 65000, retries: 1 });
        const changes = verifiedChanges(raw, p.before.transcript.text, p.after.transcript.text);
        if (changes.length < 3) throw Error("The model did not provide enough verifiable comparisons. Try again later.");
        const result: CallComparison = { before: { period:p.before.fiscalPeriod,date:p.before.callDate,title:p.before.title }, after: { period:p.after.fiscalPeriod,date:p.after.callDate,title:p.after.title }, changes, generatedAt:new Date().toISOString() };
        await writeJson(p.file,result); return result;
      };
      const task = generate().finally(() => pending.delete(p.hash)); pending.set(p.hash,task);
    }
    return NextResponse.json({ comparison: await pending.get(p.hash) });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}

