import { NextResponse } from "next/server";
import { notifyAlert } from "@/lib/alertNotify";

/**
 * Feedback intake — the missing half of the reporting loop.
 *
 * Feedback has been arriving verbally ("the earnings section isn't loading", "it hasn't updated since
 * Wednesday") without the context that makes it actionable: WHICH page, WHICH build, WHICH universe,
 * and what the data looked like at that moment. Every one of those took a diagnostic round-trip to
 * recover. This captures them at the source and pushes the note straight to the ops webhook — the same
 * channel the freshness and rebuild alerts use, so it lands where they are already watched.
 *
 * Deliberately NOT persisted to data/: that tree is overwritten wholesale by the nightly R2 hydrate,
 * so anything written there is destroyed on the next rebuild. The webhook is the durable sink.
 *
 * Honest failure: when no webhook is configured the route says so (503 + a reason the UI shows)
 * rather than returning 200 and dropping the message — silently swallowing feedback is worse than
 * refusing it, because the sender believes it was received.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_MESSAGE = 4000;
const MAX_CONTEXT = 400;

export async function POST(req: Request) {
  let body: { message?: unknown; kind?: unknown; page?: unknown; build?: unknown; universe?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE) : "";
  if (!message) return NextResponse.json({ ok: false, error: "Say something first." }, { status: 400 });

  const kind = body.kind === "bug" || body.kind === "idea" || body.kind === "data" ? body.kind : "note";
  const clip = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, MAX_CONTEXT) : "");
  const page = clip(body.page), build = clip(body.build), universe = clip(body.universe);

  const LABEL: Record<string, string> = { bug: "🐞 BUG", idea: "💡 IDEA", data: "📉 DATA LOOKS WRONG", note: "📝 NOTE" };
  const text = [
    `${LABEL[kind]} — Tape feedback`,
    "",
    message,
    "",
    `page: ${page || "(unknown)"}${universe ? ` · universe: ${universe}` : ""}`,
    `build: ${build || "(unknown)"} · sent: ${new Date().toISOString()}`,
  ].join("\n");

  const target = process.env.FEEDBACK_WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL;
  if (!target) {
    return NextResponse.json(
      { ok: false, error: "Feedback isn't wired up on this server yet (no FEEDBACK_WEBHOOK_URL or ALERT_WEBHOOK_URL set)." },
      { status: 503 },
    );
  }

  try {
    await notifyAlert(text, "Tape feedback", target);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Couldn't deliver: ${String(e?.message || e).slice(0, 120)}` }, { status: 502 });
  }
}
