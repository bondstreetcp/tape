import { NextRequest, NextResponse } from "next/server";
import { promises as fsp } from "fs";
import path from "path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { currentUser, supabaseEnabled } from "@/lib/supabase/server";
import { sanitizeScanFilename } from "@/lib/staplesScanner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Upload portal for the licensed NielsenIQ / sell-side scan PDFs (2026-09-08 review #18): drop a PDF from
// the browser instead of SSH-ing it into the watched folder. It lands in STAPLES_SCAN_DIR (the same folder
// scripts/refresh-staples-scanner.ts reads) and is ingested on the next nightly scan. The raw PDF is NEVER
// served back — it stays in the gitignored, outside-data/ folder; only the derived numbers are ever exposed.
// The watched folder the scanner reads. Written as a STATICALLY-SCOPED subfolder of cwd so the file tracer
// doesn't treat it as "trace the whole project" (an env-var path would). This matches the deployment default
// (envManifest STAPLES_SCAN_DIR = "./staples-scans"); if that env is ever pointed elsewhere on the host, the
// scanner reads there but the upload lands here — keep them aligned (or the scanner won't find the upload).
const SCAN_DIR = path.join(process.cwd(), "staples-scans");
const MAX_BYTES = 30 * 1024 * 1024;

export async function POST(req: NextRequest) {
  // Licensed content → require a signed-in user when auth is configured (defense-in-depth over any edge
  // protection). When Supabase isn't wired up, match the posture of /api/research/upload (no extra gate).
  if (supabaseEnabled && !(await currentUser())) {
    return NextResponse.json({ error: "Sign in to upload scans." }, { status: 401 });
  }

  let file: File | null = null;
  try { file = (await req.formData()).get("file") as File | null; } catch { /* not multipart */ }
  if (!file || typeof file.arrayBuffer !== "function") return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return NextResponse.json({ error: "PDF files only." }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) return NextResponse.json({ error: "File too large (max 30 MB)." }, { status: 400 });
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return NextResponse.json({ error: "That doesn't look like a PDF." }, { status: 400 });

  // The scanner reads the PDF's TEXT layer — reject a scanned image up front so it doesn't silently no-op.
  try {
    const parsed: { text?: string } = await pdfParse(buf);
    if (!parsed?.text || parsed.text.replace(/\s+/g, " ").trim().length < 400) {
      return NextResponse.json({ error: "No extractable text — is this a scanned image? The scanner needs a text-layer PDF." }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Couldn't read the PDF." }, { status: 400 });
  }

  const fileName = sanitizeScanFilename(file.name);
  try {
    await fsp.mkdir(SCAN_DIR, { recursive: true });
    await fsp.writeFile(path.join(SCAN_DIR, fileName), buf);
  } catch (e) {
    // The watched folder only exists on a writable-FS deployment (the NAS); a read-only host can't accept it.
    return NextResponse.json({ error: `Couldn't save the file — the server's scan folder isn't writable here. (${String((e as Error)?.message || e).slice(0, 100)})` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, fileName, queued: true });
}
