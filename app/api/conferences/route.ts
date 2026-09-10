import { NextResponse } from "next/server";
import { portalUser, unlockPortal, PORTAL_COOKIE } from "@/lib/conferencePortalAuth";
import { boundedJson, conferenceServiceDir, enqueueConference, jobPath, listJobs, readJson, serialize, stockCatalog, writeJson, type PortalJob } from "@/lib/conferencePortal";
import path from "node:path";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!(await portalUser(req))) return NextResponse.json({ error: "Enter your conference access code, or sign in to Tape." }, { status: 401 });
  const worker = await readJson<{ updatedAt: string }>(path.join(conferenceServiceDir(), "heartbeat.json"));
  return NextResponse.json({ jobs: (await listJobs()).map(({ url: _url, owner: _owner, ...j }) => j), workerOnline: !!worker && Date.now() - Date.parse(worker.updatedAt) < 90_000 }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin && req.headers.get("origin") !== `https://${req.headers.get("host")}`) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const body = await boundedJson(req, 8000) as { code?: string; url?: string; id?: string; action?: string; talkId?: string; symbol?: string };
    if (body.action === "unlock") {
      const token = await unlockPortal(body.code || "", req.headers.get("cf-connecting-ip") || "unknown");
      if (!token) return NextResponse.json({ error: "Incorrect access code, or too many attempts. Try again in a minute." }, { status: 401 });
      const response = NextResponse.json({ ok: true });
      response.cookies.set(PORTAL_COOKIE, token, { httpOnly: true, secure: true, sameSite: "strict", path: "/api/conferences", maxAge: 30 * 86400 });
      return response;
    }
    const user = await portalUser(req);
    if (!user) return NextResponse.json({ error: "Unlock conferences first." }, { status: 401 });
    if (body.url) return NextResponse.json({ id: (await enqueueConference(body.url, user)).id });
    return await serialize(async () => {
      const job = await readJson<PortalJob>(jobPath(body.id || ""));
      if (!job || job.owner !== user) return NextResponse.json({ error: "Only the submitter can change this conference." }, { status: 403 });
      if (body.action === "retry") { if (job.state !== "attention") throw Error("This conference is already queued or running."); job.revision++; job.state = "queued"; job.phase = "Resuming saved work"; }
      else if (body.action === "map") {
        const symbol = (body.symbol || "").toUpperCase();
        if (!job.talks.some(t => t.id === body.talkId) || !(await stockCatalog()).some(s => s.symbol === symbol)) throw Error("Choose a ticker already on Tape.");
        job.mappings[body.talkId!] = symbol;
      } else throw Error("Unsupported action.");
      job.updatedAt = new Date().toISOString(); await writeJson(jobPath(job.id), job);
      return NextResponse.json({ ok: true });
    });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
