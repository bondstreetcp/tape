/**
 * Research-DB keep-alive — one trivial query per nightly FULL tick so the Supabase free tier never
 * sees 7 idle days and auto-pauses the project (the 2026-07-19 incident: the research desk, the
 * pre-print card, and the spin preview's enrichment were silently corpus-less for ~2 weeks because
 * nothing touches this DB except live UI visits). Any authenticated query counts as activity; Mon-Fri
 * FULL runs leave a max weekend gap of ~3 days — well inside the window.
 *
 * MUST use the transaction-POOLER connection string (postgres.<ref>@…pooler.supabase.com:6543): the
 * direct db.<ref>.supabase.co hostname is IPv6-ONLY and unreachable from IPv4 networks (the NAS, most
 * home boxes). Skips cleanly when RESEARCH_DATABASE_URL isn't set — never fails the tick.
 */
import fs from "node:fs";
import postgres from "postgres";

// .env.local for local runs; CI/NAS provide the env directly.
try {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env.local */ }

async function main() {
  const dsn = process.env.RESEARCH_DATABASE_URL;
  if (!dsn) { console.log("ping-research-db: RESEARCH_DATABASE_URL not set — skipping (nothing to keep alive)."); return; }
  const sql = postgres(dsn, { prepare: false, max: 1, connect_timeout: 15 });
  try {
    const rows = await sql`select count(*)::int as n from research_docs`;
    console.log(`ping-research-db: alive — ${rows[0].n} docs in the corpus (pause timer reset).`);
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 140);
    // "tenant/user not found" from every pooler = the project PAUSED anyway (or the URL points at the
    // wrong cluster); ENOTFOUND on a db.<ref> host = the IPv6-only direct hostname on an IPv4 network.
    console.warn(`ping-research-db: UNREACHABLE — ${msg}`);
    console.warn("  → if this says 'tenant/user not found', the Supabase project is likely PAUSED — restore it in the dashboard.");
  } finally {
    await sql.end().catch(() => {});
  }
}

main();
