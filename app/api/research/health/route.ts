import { NextResponse } from "next/server";
import { dbCorpusIndex } from "@/lib/research/store.db";
import { blobConfigured, storageHealth } from "@/lib/research/blob";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Research Desk wiring check — confirms the three env vars resolve, the Postgres (pgvector) store is
// reachable (ensureSchema runs idempotently), and the Supabase Storage secret key works. Returns
// only booleans + counts + sliced error strings (never the secret values). 200 = all good, 503 = not.
export async function GET() {
  const configured = {
    db: !!process.env.RESEARCH_DATABASE_URL,
    supabaseUrl: !!process.env.SUPABASE_URL,
    secret: !!process.env.SUPABASE_SECRET_KEY,
  };

  let db: { ok: boolean; tickers?: number; docs?: number; error?: string };
  if (!configured.db) {
    db = { ok: false, error: "RESEARCH_DATABASE_URL not set" };
  } else {
    try {
      const idx = await dbCorpusIndex(); // runs ensureSchema (create extension + tables) + an aggregate
      db = { ok: true, tickers: idx.length, docs: idx.reduce((n, x) => n + x.count, 0) };
    } catch (e: any) {
      db = { ok: false, error: String(e?.message || e).slice(0, 200) };
    }
  }

  const storage = blobConfigured() ? await storageHealth() : { ok: false, error: "SUPABASE_URL / SUPABASE_SECRET_KEY not set" };
  const ok = db.ok && storage.ok;
  return NextResponse.json({ ok, configured, db, storage }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
