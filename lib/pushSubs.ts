/**
 * Push subscriptions — the server-side registry for P3 alerts. The topic is the ONLY identity
 * (ntfy's security model: whoever knows the topic can read it — the client generates a random one
 * and keeps it in localStorage), and the symbol list rides along so the NIGHTLY evaluator can act
 * on client-side state it could never read directly. Stored in the research Supabase (the one
 * server-side Postgres both containers already reach); no accounts, no RLS — a topic row is
 * exactly as secret as its topic string.
 *
 * Pool options mirror the research store's post-wedge hardening (max>1 + max_lifetime — one
 * stalled statement must never starve the process; see lib/research/store.db.ts, 2026-08-08).
 */
import postgres from "postgres";

export interface StoredPushSub { topic: string; symbols: string[]; updatedAt: string }

let _sql: ReturnType<typeof postgres> | null = null;
function db(): ReturnType<typeof postgres> | null {
  const url = process.env.RESEARCH_DATABASE_URL;
  if (!url) return null;
  if (!_sql) _sql = postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 15, max_lifetime: 600, prepare: false });
  return _sql;
}

let ready = false;
async function ensure(sql: NonNullable<ReturnType<typeof db>>): Promise<void> {
  if (ready) return;
  // Probe-first (the research-store lesson: create-if-not-exists DDL queues on catalog locks even
  // when the table exists); only a missing-table error runs the create.
  try {
    await sql`select 1 from push_subs limit 1`;
  } catch (e: any) {
    if (e?.code !== "42P01") throw e;
    await sql`create table if not exists push_subs (
      topic text primary key,
      symbols jsonb not null default '[]',
      updated_at timestamptz not null default now()
    )`;
  }
  ready = true;
}

export const TOPIC_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export async function upsertPushSub(topic: string, symbols: string[]): Promise<boolean> {
  const sql = db();
  if (!sql || !TOPIC_RE.test(topic)) return false;
  await ensure(sql);
  await sql`insert into push_subs (topic, symbols, updated_at) values (${topic}, ${sql.json(symbols)}, now())
    on conflict (topic) do update set symbols = excluded.symbols, updated_at = now()`;
  return true;
}

export async function deletePushSub(topic: string): Promise<boolean> {
  const sql = db();
  if (!sql || !TOPIC_RE.test(topic)) return false;
  await ensure(sql);
  await sql`delete from push_subs where topic = ${topic}`;
  return true;
}

export async function listPushSubs(): Promise<StoredPushSub[]> {
  const sql = db();
  if (!sql) return [];
  await ensure(sql);
  const rows = await sql`select topic, symbols, updated_at from push_subs`;
  return rows.map((r: any) => ({
    topic: r.topic,
    symbols: Array.isArray(r.symbols) ? r.symbols.filter((s: unknown) => typeof s === "string") : [],
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : "",
  }));
}

/** Send one ntfy message — shared by the evaluator and the test button. Best-effort boolean. */
export async function sendNtfy(topic: string, title: string, body: string, opts: { tags?: string; priority?: string; clickPath?: string } = {}): Promise<boolean> {
  if (!TOPIC_RE.test(topic)) return false;
  const base = process.env.NTFY_BASE || "https://ntfy.sh";
  const headerSafe = (s: string) => s.replace(/[^\x20-\x7E]/g, "-"); // ntfy headers are ByteStrings (the em-dash crash)
  // Tapping the notification should LAND somewhere (2026-08 UX pass): clickPath ("/u/sp500/my-names",
  // "/u/sp500/stock/EAT") + PUSH_CLICK_BASE (the site's public origin, set in the runner's
  // /app/.alert-env). Without the base configured, the ping still sends — just without the link.
  const clickBase = (process.env.PUSH_CLICK_BASE || "").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/${topic}`, {
      method: "POST",
      body,
      headers: {
        Title: headerSafe(title),
        Priority: opts.priority ?? "default",
        Tags: headerSafe(opts.tags ?? "chart_with_upwards_trend"),
        ...(clickBase && opts.clickPath ? { Click: `${clickBase}${opts.clickPath}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
