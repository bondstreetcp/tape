import { NextResponse } from "next/server";
import crypto from "crypto";
import { getBriefings } from "@/lib/briefing";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PW = process.env.BRIEFING_PASSWORD;
const COOKIE = "brief_ok";
// Cookie value an attacker can't forge without the password (no shared session
// secret in this app), so possession of the cookie ≈ knowing the password.
const token = () => (PW ? crypto.createHash("sha256").update(`brief:${PW}`).digest("hex").slice(0, 32) : null);

function authed(req: Request): boolean {
  const t = token();
  if (!t) return false;
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)brief_ok=([a-f0-9]{32})/);
  return !!m && m[1] === t;
}

export async function GET(req: Request) {
  // Demo mode: when no BRIEFING_PASSWORD is configured, serve the briefing openly
  // (no gate) instead of locking it — so it works without env setup. Set a
  // password to re-enable the private gate.
  if (!PW || authed(req)) {
    const briefings = await getBriefings();
    return NextResponse.json({ briefings, fetchedAt: new Date().toISOString() });
  }
  return NextResponse.json({ needAuth: true }, { status: 401 });
}

export async function POST(req: Request) {
  if (!PW) return NextResponse.json({ configured: false });
  let body: { password?: unknown } = {};
  try { body = await req.json(); } catch {}
  if (typeof body.password !== "string" || body.password !== PW) {
    return NextResponse.json({ ok: false, error: "Incorrect password" }, { status: 401 });
  }
  const briefings = await getBriefings();
  const res = NextResponse.json({ ok: true, briefings, fetchedAt: new Date().toISOString() });
  res.cookies.set(COOKIE, token()!, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
