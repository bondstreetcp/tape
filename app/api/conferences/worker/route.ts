import { NextResponse } from "next/server";
import path from "node:path";
import { boundedJson, conferenceServiceDir, jobPath, listJobs, publishConferenceRecord, readJson, serialize, stockCatalog, workerAuthorized, writeJson, type PortalJob, type PortalTalk } from "@/lib/conferencePortal";
import type { CallRecord } from "@/lib/callsArchive";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!await workerAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await writeJson(path.join(conferenceServiceDir(), "heartbeat.json"), { updatedAt: new Date().toISOString() });
  return NextResponse.json({ jobs: await listJobs() }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: Request) {
  if (!await workerAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await boundedJson(req) as { id: string; revision: number; title?: string; state?: PortalJob["state"]; phase?: string; message?: string; talks?: PortalTalk[]; talkId?: string; record?: CallRecord };
    return await serialize(async () => {
      const job = await readJson<PortalJob>(jobPath(body.id));
      if (!job || job.revision !== body.revision) return NextResponse.json({ error: "Stale job revision." }, { status: 409 });
      if (body.record) {
        const talk = job.talks.find(t => t.id === body.talkId);
        if (!talk) throw Error("Unknown presentation.");
        await publishConferenceRecord(job, talk, body.record, await stockCatalog());
      } else {
        if (body.title) job.title = body.title.slice(0, 240);
        if (body.state && ["queued", "running", "attention", "complete"].includes(body.state)) job.state = body.state;
        job.phase = (body.phase || job.phase).slice(0, 100); job.message = body.message?.slice(0, 400);
        if (body.talks) {
          if (!Array.isArray(body.talks) || body.talks.length > 500 || body.talks.some(t => !/^\d{1,16}$/.test(t.id) || typeof t.name !== "string")) throw Error("Invalid presentation list.");
          job.talks = body.talks.map(t => {
            const prior = job.talks.find(p => p.id === t.id);
            return { id: t.id, name: t.name.slice(0, 240), audio: !!t.audio, transcript: !!t.transcript, summary: !!t.summary, error: t.error?.slice(0, 350), symbol: prior?.symbol, published: prior?.published };
          });
        }
      }
      if (job.state === "complete" && job.talks.some(t => !t.published)) { job.state = "attention"; job.message = "Some presentations need a ticker match or another processing attempt."; }
      job.updatedAt = new Date().toISOString(); await writeJson(jobPath(job.id), job);
      return NextResponse.json({ ok: true, talk: job.talks.find(t => t.id === body.talkId) });
    });
  } catch (e) { console.error("Conference worker request:", (e as Error).message); return NextResponse.json({ error: "Unable to accept conference update." }, { status: 400 }); }
}
