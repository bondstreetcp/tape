import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { extractResearch, extractConfigured } from "@/lib/research/extract";
import { saveDoc } from "@/lib/research/store";
import { uploadPdf } from "@/lib/research/blob";
import type { StoredDoc } from "@/lib/research/types";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

// POST multipart (file=<pdf>) → parse → Gemini structured extraction → store the raw PDF
// (Supabase Storage) + the extracted fields (Postgres or local FS) → { doc }.
export async function POST(req: NextRequest) {
  if (!extractConfigured()) return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 400 });
  let file: File | null = null;
  try { file = (await req.formData()).get("file") as File | null; } catch { /* not multipart */ }
  if (!file || typeof file.arrayBuffer !== "function") return NextResponse.json({ error: "no file" }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    const data: any = await pdfParse(buf);
    const text = data.text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 400) return NextResponse.json({ error: "no extractable text (scanned PDF?)" });
    const id = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
    const doc = await extractResearch(text);
    if (!doc) return NextResponse.json({ error: "extraction failed" });
    const blobKey = await uploadPdf(id, buf);
    const stored: StoredDoc = { ...doc, id, fileName: file.name, pageCount: data.numpages, charCount: text.length, ingestedAt: new Date().toISOString(), blobKey, text };
    await saveDoc(stored);
    return NextResponse.json({ ok: true, doc: stored });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) });
  }
}
