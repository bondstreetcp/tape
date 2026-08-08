/**
 * Supabase/Postgres backend for the research corpus (production — Vercel serverless can't
 * use the local FS). Direct postgres.js connection via RESEARCH_DATABASE_URL; pgvector is
 * enabled for a future chunk-embedding table. The extracted fields + full report text live
 * in one `research_docs` table (arrays/objects as jsonb). For Vercel scale, point
 * RESEARCH_DATABASE_URL at Supabase's transaction pooler (port 6543).
 */
import postgres from "postgres";
import type { StoredDoc } from "./types";

let _sql: ReturnType<typeof postgres> | null = null;
function db() {
  // max 3 (was 1): with a single connection, ONE stalled statement queued every other query in the
  // process behind it — the 2026-08 NAS incident, where an upload's INSERT stalled mid-payload on a
  // dead socket and health/uploads/desk all hung indefinitely. max_lifetime recycles sockets every
  // 10 min so a half-dead one can't persist.
  if (!_sql) _sql = postgres(process.env.RESEARCH_DATABASE_URL!, { max: 3, idle_timeout: 20, connect_timeout: 15, max_lifetime: 600, prepare: false });
  return _sql;
}

/**
 * Race a postgres.js query against a wall clock; on expiry CANCEL it (postgres cancel protocol —
 * frees the server-side statement AND rejects the pending promise, which releases the pool slot)
 * and throw. Without this, a write stalled on a black-holed socket holds its pool slot forever:
 * idle_timeout only covers idle connections and connect_timeout only covers dialing — neither
 * applies mid-statement, which is exactly where the big research-doc payloads die on a bad uplink.
 * Writes only; reads are small and now have pool headroom.
 */
function withCancel<T>(q: { cancel?: () => void } & PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      try { q.cancel?.(); } catch { /* already settled */ }
      reject(new Error(`${label} timed out after ${ms}ms (statement cancelled)`));
    }, ms);
    q.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

let schemaReady = false;
export async function ensureSchema(): Promise<void> {
  const sql = db();
  await sql`create extension if not exists vector`;
  await sql`create table if not exists research_docs (
    id text primary key,
    ticker text not null,
    company text,
    source text,
    analysts jsonb,
    publish_date text,
    doc_type text,
    title text,
    rating text,
    rating_prior text,
    price_target double precision,
    price_target_prior double precision,
    target_basis text,
    thesis jsonb,
    risks jsonb,
    catalysts jsonb,
    management_insights jsonb,
    estimates jsonb,
    summary text,
    entitlement text,
    file_name text,
    page_count int,
    char_count int,
    ingested_at timestamptz default now(),
    blob_key text,
    body text
  )`;
  await sql`create index if not exists research_docs_ticker_idx on research_docs (ticker)`;
  await sql`create table if not exists research_chunks (
    doc_id text references research_docs(id) on delete cascade,
    ordinal int not null,
    ticker text,
    text text,
    embedding vector(768),
    primary key (doc_id, ordinal)
  )`;
  await sql`create index if not exists research_chunks_ticker_idx on research_chunks (ticker)`;
  schemaReady = true;
}
async function ready() { if (!schemaReady) await ensureSchema(); }

const toDoc = (r: any): StoredDoc => ({
  id: r.id, ticker: r.ticker, company: r.company || "", source: r.source || "", analysts: r.analysts || [],
  publishDate: r.publish_date || "", docType: r.doc_type || "other", title: r.title || "",
  rating: r.rating ?? null, ratingPrior: r.rating_prior ?? null, priceTarget: r.price_target ?? null,
  priceTargetPrior: r.price_target_prior ?? null, targetBasis: r.target_basis ?? null,
  thesis: r.thesis || [], risks: r.risks || [], catalysts: r.catalysts || [], managementInsights: r.management_insights || [],
  estimates: r.estimates || [], summary: r.summary || "", entitlement: r.entitlement ?? null,
  fileName: r.file_name || "", pageCount: r.page_count || 0, charCount: r.char_count || 0,
  ingestedAt: r.ingested_at ? new Date(r.ingested_at).toISOString() : "", blobKey: r.blob_key ?? null, text: r.body ?? undefined,
});

export async function dbSaveDoc(d: StoredDoc): Promise<void> {
  await ready();
  const sql = db();
  const J = (v: any) => sql.json(v); // postgres.js jsonb helper (loosen the strict JSONValue type)
  // The doc row carries the FULL note text — the largest single write in the app and the one that
  // stalled the NAS. 60s is generous for a healthy path; a stall cancels instead of wedging.
  await withCancel(sql`
    insert into research_docs (id,ticker,company,source,analysts,publish_date,doc_type,title,rating,rating_prior,price_target,price_target_prior,target_basis,thesis,risks,catalysts,management_insights,estimates,summary,entitlement,file_name,page_count,char_count,blob_key,body)
    values (${d.id},${d.ticker},${d.company},${d.source},${J(d.analysts)},${d.publishDate},${d.docType},${d.title},${d.rating},${d.ratingPrior},${d.priceTarget},${d.priceTargetPrior},${d.targetBasis},${J(d.thesis)},${J(d.risks)},${J(d.catalysts)},${J(d.managementInsights)},${J(d.estimates)},${d.summary},${d.entitlement},${d.fileName},${d.pageCount},${d.charCount},${d.blobKey},${d.text ?? null})
    on conflict (id) do update set
      ticker=excluded.ticker, company=excluded.company, source=excluded.source, analysts=excluded.analysts,
      publish_date=excluded.publish_date, doc_type=excluded.doc_type, title=excluded.title, rating=excluded.rating,
      rating_prior=excluded.rating_prior, price_target=excluded.price_target, price_target_prior=excluded.price_target_prior,
      target_basis=excluded.target_basis, thesis=excluded.thesis, risks=excluded.risks, catalysts=excluded.catalysts,
      management_insights=excluded.management_insights, estimates=excluded.estimates, summary=excluded.summary,
      entitlement=excluded.entitlement, file_name=excluded.file_name, page_count=excluded.page_count,
      char_count=excluded.char_count, blob_key=excluded.blob_key, body=excluded.body
  `, 60_000, `research: save doc ${d.id}`);
}

export async function dbListDocs(ticker?: string): Promise<StoredDoc[]> {
  await ready();
  const sql = db();
  const rows = ticker
    ? await sql`select * from research_docs where ticker = ${ticker} order by publish_date desc`
    : await sql`select * from research_docs order by publish_date desc`;
  return rows.map(toDoc);
}

export async function dbGetDoc(id: string): Promise<StoredDoc | null> {
  await ready();
  const sql = db();
  const rows = await sql`select * from research_docs where id = ${id} limit 1`;
  return rows.length ? toDoc(rows[0]) : null;
}

export async function dbCorpusIndex(): Promise<{ ticker: string; company: string; count: number; latest: string }[]> {
  await ready();
  const sql = db();
  const rows = await sql`select ticker, max(company) as company, count(*)::int as count, max(publish_date) as latest from research_docs group by ticker order by count desc`;
  return rows.map((r: any) => ({ ticker: r.ticker, company: r.company || "", count: r.count, latest: r.latest || "" }));
}

const vlit = (v: number[]) => "[" + v.join(",") + "]";

export async function dbSaveChunks(docId: string, ticker: string, rows: { ordinal: number; text: string; embedding: number[] }[]): Promise<void> {
  await ready();
  const sql = db();
  // BATCHED multi-row inserts (25/statement): a ~300-chunk doc used to be ~300 sequential round
  // trips — 45-90s+ on the NAS uplink, which blew past the Cloudflare Tunnel's ~100s ceiling and
  // made the site uploader report "failed" for docs that actually saved. 12 statements finish in
  // seconds. Per-statement cancel + an overall budget so a stalled socket degrades to one failed
  // doc's embeddings (best-effort at every call site), never a wedged pool slot.
  const deadline = Date.now() + 120_000;
  await withCancel(sql`delete from research_chunks where doc_id = ${docId}`, 30_000, `research: clear chunks ${docId}`);
  const B = 25;
  for (let i = 0; i < rows.length; i += B) {
    if (Date.now() > deadline) throw new Error(`research: chunk inserts for ${docId} exceeded 120s budget at ${i}/${rows.length}`);
    const grp = rows.slice(i, i + B);
    const vals: string[] = [];
    const params: (string | number)[] = [];
    grp.forEach((r, j) => {
      const o = j * 5;
      vals.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5}::vector)`);
      params.push(docId, r.ordinal, ticker, r.text, vlit(r.embedding));
    });
    await withCancel(
      sql.unsafe(`insert into research_chunks (doc_id, ordinal, ticker, text, embedding) values ${vals.join(",")}`, params as any[]),
      30_000,
      `research: chunks ${docId} @${i}`,
    );
  }
}

export interface ChunkHit { docId: string; ordinal: number; ticker: string; text: string; score: number }

/** Top-k chunks by cosine similarity to the query embedding (optionally scoped to a ticker). */
export async function dbSearchChunks(queryEmbedding: number[], ticker: string | undefined, k: number): Promise<ChunkHit[]> {
  await ready();
  const sql = db();
  const q = vlit(queryEmbedding);
  const rows = ticker
    ? await sql`select doc_id, ordinal, ticker, text, 1 - (embedding <=> ${q}::vector) as score from research_chunks where ticker = ${ticker} order by embedding <=> ${q}::vector limit ${k}`
    : await sql`select doc_id, ordinal, ticker, text, 1 - (embedding <=> ${q}::vector) as score from research_chunks order by embedding <=> ${q}::vector limit ${k}`;
  return rows.map((r: any) => ({ docId: r.doc_id, ordinal: r.ordinal, ticker: r.ticker, text: r.text, score: Number(r.score) }));
}
