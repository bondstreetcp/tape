/**
 * ingest-slack — backfill a Slack workspace EXPORT into the research corpus, so the notes you've
 * been dropping in Slack (StreetAccount, merger-arb, your own commentary) surface on each ticker's
 * Research tab + the cross-corpus semantic search. No Slack app/token needed — just the export.
 *
 * Get the export: Slack admin → Settings & administration → Workspace settings → Import/Export Data
 * → Export → download the .zip → unzip it. Then:
 *
 *   npx tsx scripts/ingest-slack.ts <path-to-unzipped-export-dir>
 *   npx tsx scripts/ingest-slack.ts <dir> --only=merger-arb        # one channel
 *   npx tsx scripts/ingest-slack.ts <dir> --no-embed               # fast pass, skip embeddings
 *   npx tsx scripts/ingest-slack.ts <dir> --dry                    # parse + report, don't write
 *
 * Channel → ticker: a channel NAMED after a ticker (#dkng, #amt, #gis…) tags every message to it;
 * a topical channel (#merger-arb, #biotech, #spins) extracts the tickers mentioned in each message
 * (bold *RKLB* or line-leading symbols) and tags the note to each. Writes to the SAME Supabase the
 * deployed app reads (via RESEARCH_DATABASE_URL in .env.local).
 */
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import { UNIVERSES } from "../lib/universes";

const DATA_DIR = path.join(process.cwd(), "data");
const SKIP_CHANNELS = new Set(["general", "random", "tape", "huddles", "incoming-webhooks"]);

// tsx doesn't auto-load .env.local — load it so the store talks to Supabase (not the local FS).
async function loadEnvLocal() {
  try {
    const txt = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* none — falls back to local FS store */ }
}

// ---- universe symbol set (for resolving channel names + in-message tickers) ----
async function loadSymbols(): Promise<{ set: Set<string>; name: Map<string, string> }> {
  const set = new Set<string>();
  const name = new Map<string, string>();
  for (const u of UNIVERSES) {
    try {
      const snap = JSON.parse(await fs.readFile(path.join(DATA_DIR, u.id, "snapshot.json"), "utf8"));
      for (const s of snap.stocks || []) {
        const sym = String(s.symbol || "").toUpperCase();
        if (sym) { set.add(sym); if (s.name && !name.has(sym)) name.set(sym, s.name); }
      }
    } catch { /* universe not present locally */ }
  }
  return { set, name };
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Tickers mentioned in a topical-channel message: bold *RKLB* and line-leading symbols (the deal-note
// format leads each line with the ticker). Conservative — avoids matching common uppercase words.
function extractTickers(raw: string, set: Set<string>): string[] {
  const found = new Set<string>();
  for (const m of raw.matchAll(/\*([A-Z]{1,5})\*/g)) if (set.has(m[1])) found.add(m[1]);
  for (const line of raw.split(/\n/)) {
    const m = line.match(/^\s*\*?\s*([A-Z]{2,5})\b/);
    if (m && set.has(m[1])) found.add(m[1]);
  }
  return [...found];
}

// Slack markup → readable text. Resolve user/channel mentions + links, unescape entities.
function clean(raw: string, users: Map<string, string>): string {
  return raw
    .replace(/<@([A-Z0-9]+)>/g, (_, id) => "@" + (users.get(id) || "user"))
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();
}

const dateOf = (ts: string) => new Date(Math.floor(parseFloat(ts) * 1000)).toISOString();

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.split("=")[1] : null;
  const noEmbed = args.includes("--no-embed");
  const dry = args.includes("--dry");
  if (!dir) { console.error("Usage: npx tsx scripts/ingest-slack.ts <unzipped-export-dir> [--only=ch] [--no-embed] [--dry]"); process.exit(1); }

  await loadEnvLocal();
  const { set: symbols, name: companyOf } = await loadSymbols();
  console.log(`Loaded ${symbols.size} known symbols. Reading export: ${dir}`);

  // users.json → id → display name
  const users = new Map<string, string>();
  try {
    const u = JSON.parse(await fs.readFile(path.join(dir, "users.json"), "utf8"));
    for (const x of u) users.set(x.id, x?.profile?.display_name || x?.real_name || x?.name || "user");
  } catch { console.warn("  (no users.json — author names will be generic)"); }

  // the store (dynamic import AFTER env load so it picks the DB backend)
  const store = dry ? null : await import("../lib/research/store");
  const embed = dry || noEmbed ? null : await import("../lib/research/embed");
  const dbMode = !!process.env.RESEARCH_DATABASE_URL;
  if (!dry) console.log(`  store backend: ${dbMode ? "Supabase/Postgres" : "local FS (RESEARCH_DATABASE_URL not set)"}${noEmbed ? " · embeddings OFF" : ""}`);

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const channels = entries.filter((e) => e.isDirectory() && !SKIP_CHANNELS.has(e.name) && (!only || e.name === only));

  let docs = 0, msgs = 0, embedded = 0;
  const perTicker = new Map<string, number>();

  for (const ch of channels) {
    const chName = ch.name;
    const chTicker = symbols.has(norm(chName)) ? norm(chName) : null; // ticker-named channel?
    const days = (await fs.readdir(path.join(dir, chName))).filter((f) => f.endsWith(".json"));
    for (const day of days) {
      let messages: any[] = [];
      try { messages = JSON.parse(await fs.readFile(path.join(dir, chName, day), "utf8")); } catch { continue; }
      for (const m of messages) {
        if (m?.type !== "message" || m?.subtype || typeof m?.text !== "string") continue; // skip joins/system/bots
        const raw = m.text.trim();
        if (raw.length < 10) continue;
        msgs++;
        const tickers = chTicker ? [chTicker] : extractTickers(raw, symbols);
        if (!tickers.length) continue;
        const body = clean(raw, users);
        const author = users.get(m.user) || "Slack";
        const when = dateOf(m.ts);
        const date = when.slice(0, 10);
        for (const ticker of tickers) {
          perTicker.set(ticker, (perTicker.get(ticker) || 0) + 1);
          const id = "slack-" + createHash("sha1").update(`${chName}:${m.ts}:${ticker}`).digest("hex").slice(0, 16);
          const doc = {
            ticker,
            company: companyOf.get(ticker) || "",
            source: `Slack #${chName}`,
            analysts: [author],
            publishDate: date,
            docType: "note" as const,
            title: `#${chName} · ${date}: ${body.replace(/\s+/g, " ").slice(0, 70)}`,
            rating: null, ratingPrior: null, priceTarget: null, priceTargetPrior: null, targetBasis: null,
            thesis: [], risks: [], catalysts: [], managementInsights: [], estimates: [],
            summary: body.replace(/\s+/g, " ").slice(0, 280),
            entitlement: null,
            id,
            fileName: `slack/${chName}/${m.ts}`,
            pageCount: 0,
            charCount: body.length,
            ingestedAt: when,
            blobKey: null,
            text: body,
          };
          if (dry) { docs++; continue; }
          try {
            await store!.saveDoc(doc as any);
            docs++;
            if (embed && body.length >= 40) {
              const rows = await embed.embedChunks(body);
              if (rows.length) { await store!.saveChunks(id, ticker, rows); embedded += rows.length; }
            }
          } catch (e: any) { console.warn(`  ! ${ticker} ${chName} ${m.ts}: ${String(e?.message || e).slice(0, 120)}`); }
        }
      }
    }
    console.log(`  #${chName}${chTicker ? ` → ${chTicker}` : " (topical)"} done`);
  }

  const top = [...perTicker.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`\n${dry ? "[dry] " : ""}Scanned ${msgs} messages → ${docs} notes across ${perTicker.size} tickers${embedded ? ` · ${embedded} chunks embedded` : ""}.`);
  console.log("Top tickers:", top.map(([t, n]) => `${t}:${n}`).join("  "));
  if (!dry && store) { try { await (store as any).closeDb?.(); } catch {} }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
