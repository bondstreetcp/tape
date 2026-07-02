/**
 * Embeddings for semantic retrieval over the research corpus. Uses Gemini
 * text-embedding-004 (768-dim). Documents and queries are embedded with the matching
 * task type so cosine similarity is meaningful. Chunking splits a report's full text into
 * overlapping passages on sentence boundaries.
 */
import { recordUsage } from "@/lib/llmUsage";

const EMBED_MODEL = "gemini-embedding-001";
export const EMBED_DIM = 768; // MRL-truncated from 3072; cosine (<=>) is scale-invariant so no re-norm needed

async function embed(text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[] | null> {
  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY || !text.trim()) return null;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: text.slice(0, 8000) }] }, taskType, outputDimensionality: EMBED_DIM }),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    recordUsage(EMBED_MODEL, j?.usageMetadata?.promptTokenCount || Math.ceil(Math.min(text.length, 8000) / 4), 0);
    const v = j?.embedding?.values;
    return Array.isArray(v) && v.length ? v : null;
  } catch {
    return null;
  }
}

export const embedDocument = (t: string) => embed(t, "RETRIEVAL_DOCUMENT");
export const embedQuery = (t: string) => embed(t, "RETRIEVAL_QUERY");

/** Chunk a report's text and embed each passage (sequential — gentle on rate limits at
 *  this corpus size). Returns rows ready for the research_chunks table. */
export async function embedChunks(text: string): Promise<{ ordinal: number; text: string; embedding: number[] }[]> {
  const chunks = chunkText(text);
  const out: { ordinal: number; text: string; embedding: number[] }[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const e = await embedDocument(chunks[i]);
    if (e) out.push({ ordinal: i, text: chunks[i], embedding: e });
  }
  return out;
}

/** Split text into ~`size`-char passages with `overlap`, preferring sentence boundaries. */
export function chunkText(text: string, size = 1400, overlap = 200): string[] {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= size) return clean.length > 40 ? [clean] : [];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(clean.length, i + size);
    if (end < clean.length) {
      const dot = clean.lastIndexOf(". ", end);
      if (dot > i + size * 0.5) end = dot + 1;
    }
    const c = clean.slice(i, end).trim();
    if (c.length > 40) chunks.push(c);
    if (end >= clean.length) break;
    i = end - overlap;
  }
  return chunks;
}
