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
  if (!_sql) _sql = postgres(process.env.RESEARCH_DATABASE_URL!, { max: 1, idle_timeout: 20, connect_timeout: 15, prepare: false });
  return _sql;
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
  await sql`
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
  `;
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
