import { NextResponse } from "next/server";
import { upsertPushSub, deletePushSub, sendNtfy, TOPIC_RE } from "@/lib/pushSubs";
import { normalizeSyms } from "@/lib/watchlistWire";

export const dynamic = "force-dynamic";

// Push-subscription registry (P3). POST {topic, symbols[]} upserts (the client re-syncs whenever
// its My Names union changes); {topic, test: true} sends a test notification instead. DELETE
// {topic} unsubscribes. The topic is the identity AND the secret (ntfy's model) — no accounts.
// Symbols revalidate server-side; the DB being unreachable degrades to a plain 503, never a hang.

export async function POST(req: Request) {
  let body: any = null;
  try { body = await req.json(); } catch { /* not json */ }
  const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
  if (!TOPIC_RE.test(topic)) return NextResponse.json({ error: "bad topic" }, { status: 400 });

  if (body?.test === true) {
    const ok = await sendNtfy(topic, "Tape — test alert", "Push alerts are wired up. You'll hear about preannouncements, new deals/13Ds on your names, and prints within ~36h.", { tags: "white_check_mark" });
    return NextResponse.json(ok ? { ok: true } : { error: "ntfy send failed" }, { status: ok ? 200 : 502 });
  }

  const symbols = normalizeSyms(Array.isArray(body?.symbols) ? body.symbols.join(",") : "", 80);
  try {
    const ok = await upsertPushSub(topic, symbols);
    return NextResponse.json(ok ? { ok: true, symbols: symbols.length } : { error: "store not configured" }, { status: ok ? 200 : 503 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 120) }, { status: 503 });
  }
}

export async function DELETE(req: Request) {
  let body: any = null;
  try { body = await req.json(); } catch { /* not json */ }
  const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
  if (!TOPIC_RE.test(topic)) return NextResponse.json({ error: "bad topic" }, { status: 400 });
  try {
    const ok = await deletePushSub(topic);
    return NextResponse.json(ok ? { ok: true } : { error: "store not configured" }, { status: ok ? 200 : 503 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 120) }, { status: 503 });
  }
}
