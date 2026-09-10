import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { currentUser } from "./supabase/server";
import { conferenceServiceDir, readJson } from "./conferencePortal";
export const PORTAL_COOKIE = "tape_conferences";
type AccessConfig = { codeHash: string; sessionKey: string };
const config = () => readJson<AccessConfig>(path.join(conferenceServiceDir(), "access.json"));
const equal = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x,y); };
export async function portalUser(req: Request): Promise<string | null> {
  const user = await currentUser(); if (user) return user.id;
  const value = (req.headers.get("cookie") || "").split(";").map(x => x.trim()).find(x => x.startsWith(`${PORTAL_COOKIE}=`))?.slice(PORTAL_COOKIE.length + 1);
  const match = value?.match(/^(\d+)\.([a-f0-9]{64})$/); if (!match || Number(match[1]) < Date.now()) return null;
  const cfg = await config(); if (!cfg?.sessionKey) return null;
  return equal(match[2], createHmac("sha256", cfg.sessionKey).update(`conference:${match[1]}`).digest("hex")) ? "conference-owner" : null;
}
const attempts = new Map<string, { count: number; until: number }>();
export async function unlockPortal(code: string, client: string): Promise<string | null> {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  const bucket = attempts.get(client) || { count: 0, until: now + 60_000 };
  bucket.count++; attempts.set(client, bucket);
  if (bucket.count > 5 || attempts.size > 1000) return null;
  const cfg = await config(); if (!cfg?.codeHash || !cfg.sessionKey || code.length > 200 || !equal(createHash("sha256").update(code).digest("hex"), cfg.codeHash)) return null;
  const expires = String(now + 30 * 86_400_000);
  return `${expires}.${createHmac("sha256", cfg.sessionKey).update(`conference:${expires}`).digest("hex")}`;
}
