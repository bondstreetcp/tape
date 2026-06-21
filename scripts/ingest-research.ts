/**
 * Batch-ingest research PDFs into the local research store (dev tool / the same logic
 * the upload endpoint runs). For each PDF: parse text → Gemini structured extraction →
 * write the StoredDoc JSON to data/.research/docs/<id>.json (gitignored — the corpus is
 * licensed and never committed). The raw PDFs are read in place, not copied.
 *
 *   npx tsx scripts/ingest-research.ts [file1.pdf file2.pdf ...]
 *
 * With no args it ingests the sample MU reports from Downloads.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

// Load .env.local so GEMINI_API_KEY is available (scripts don't get Next's env).
try {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env.local */ }

const DOWNLOADS = "C:/Users/TruPorch Homes/Downloads/";
const SAMPLE = [
  "20260615_RBC_Capital_MU_MU-_DRAM_Upcycle_Has_Room_to_Run.pdf",
  "20260615_TD_Cowen_MU_MU_Preview-_Follow_the_GW_Content-_PT_to_-1-500.pdf",
  "20260617_Apple-s_Price_Increases_Point_to_More_Memory_Prepayments-_React.pdf",
  "20260617_Citi_MU_Micron_Technology_Inc_-MU.O--_Preview_Investor_Focus.pdf",
  "20260617_Stifel_MU_MU-_F3Q_Preview_Amidst_dynamic_demand_and_stagnant_s.pdf",
  "20260618_Micron-s_AI_Tailwinds_Position_It_for_Sales_Upside-_3Q_Preview.pdf",
].map((f) => DOWNLOADS + f);

const OUT = path.join(process.cwd(), "data", ".research", "docs");

(async () => {
  const { extractResearch, extractConfigured } = await import("../lib/research/extract");
  if (!extractConfigured()) { console.error("GEMINI_API_KEY not set (.env.local)"); process.exit(1); }
  const paths = process.argv.slice(2).length ? process.argv.slice(2) : SAMPLE;
  fs.mkdirSync(OUT, { recursive: true });
  for (const p of paths) {
    try {
      const buf = fs.readFileSync(p);
      const data: any = await pdfParse(buf);
      const text = data.text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      const id = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
      const doc = await extractResearch(text);
      if (!doc) { console.log("  extract failed:", path.basename(p)); continue; }
      const stored = { ...doc, id, fileName: path.basename(p), pageCount: data.numpages, charCount: text.length, ingestedAt: new Date().toISOString(), blobKey: null, text };
      fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(stored, null, 2));
      const pt = doc.priceTarget != null ? `$${doc.priceTarget}` : "—";
      const ptp = doc.priceTargetPrior != null ? `$${doc.priceTargetPrior}` : "—";
      console.log(`  ok  ${doc.source.padEnd(22)} ${(doc.rating || "—").padEnd(11)} PT ${ptp}→${pt}  est:${doc.estimates.length}  ${doc.entitlement ? "[entitled]" : ""}`);
    } catch (e: any) {
      console.log("  FAIL", path.basename(p), String(e?.message || e).slice(0, 80));
    }
  }
  console.log(`\nwrote → ${OUT}`);
})();
