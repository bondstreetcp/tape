/**
 * President Trump's disclosed securities trades — OGE Form 278-T Periodic Transaction Reports.
 *
 * The President files with the U.S. Office of Government Ethics (not the Congressional eFD/House
 * Clerk feeds the rest of the congress scraper uses). The filings are SCANNED PDFs: the 2/26 and
 * 4/20 reports are pure images, but the big 5/8/2026 report carries a (garbled) OCR text layer
 * with all of Q1-2026's transactions. We pdf-parse that layer and use Gemini to repair the OCR +
 * map company names to tickers into structured trades, written to data/trump-trades.json in the
 * CongressTrade shape (chamber "Executive") so the Congress view folds them in.
 *
 * Run: npm run refresh-trump   (needs GEMINI_API_KEY). CHUNK_LIMIT=N caps chunks for a test pass.
 */
import { promises as fs } from "fs";
import path from "path";
import type { CongressTrade } from "../lib/congress";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdf = require("pdf-parse");

let KEY = process.env.GEMINI_API_KEY || "";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash"; // flash is plenty for OCR-cleanup extraction
const DATA_DIR = path.join(process.cwd(), "data");
const UA = "Tape research (stock-chart-screener) jameslyeh@gmail.com";
const CHUNK_LIMIT = process.env.CHUNK_LIMIT ? Number(process.env.CHUNK_LIMIT) : Infinity;

// OGE 278-T filings. The 5/8 report is the one with an OCR text layer (the others are image-only).
const FILINGS = [
  {
    filed: "2026-05-08",
    url: "https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index/405E4EC4E27BE8D185258DF7002DD1C0/$FILE/Trump,%20Donald%20J.-05.08.2026-278T(2).pdf",
  },
];

interface RawTrade {
  company: string;
  ticker: string | null;
  type: "buy" | "sell" | "exchange";
  date: string; // YYYY-MM-DD
  amountLow: number;
  amountHigh: number;
}

const SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      company: { type: "string" },
      ticker: { type: "string", nullable: true },
      type: { type: "string", enum: ["buy", "sell", "exchange"] },
      date: { type: "string", description: "YYYY-MM-DD" },
      amountLow: { type: "number" },
      amountHigh: { type: "number" },
    },
    required: ["company", "type", "date", "amountLow", "amountHigh"],
  },
} as const;

async function extractChunk(lines: string[], idx: number): Promise<RawTrade[]> {
  const prompt = `These lines are OCR'd, garbled rows from an OGE Form 278-T Periodic Transaction Report (President Trump's securities trades, Jan–Mar 2026). Each transaction row has an asset/company name, a transaction type (often mangled as "ourchose"/"ourchasc"/"Purchase"/"Sale"/"Sold"/"Exchange"/"UNSOLICITED purchase"), a date (M/D/YYYY), and a dollar amount range (e.g. "$500,001 • $1,000,000" where • is a dash).

Extract every securities transaction you can confidently read. Repair OCR errors in the company name (e.g. "DATAOOG"→"Datadog", "Eculnbt"→"Equinix", "ALPHABET INC CL A"→"Alphabet Inc") and return it in clean Title Case. For EVERY row, identify the issuer and provide its primary U.S.-listed ticker — recognizable public companies and ETFs must ALWAYS be tickered regardless of OCR casing (e.g. MICROSOFT CORP→MSFT, EBAY INC→EBAY, META PLATFORMS INC CL A→META, COSTCO WHSL CORP→COST, KIMBERLY-CLARK CORP→KMB, LENNOX INTL→LII, EMCOR GROUP→EME, ISHARES CORE MSCI EMERGING MARKETS→IEMG). Use null ONLY for a genuinely unidentifiable asset. type = buy (purchase), sell (sale/sold), or exchange. Normalize date to YYYY-MM-DD and the amount range to two integers (low, high).

Skip anything that isn't clearly a securities transaction (form headers, page numbers, totals, and money-market sweep funds such as "FIDELITY GOVT MMKT"/"money market"). Do NOT invent rows or guess values you cannot read.

Return ONLY a JSON array. Rows:
${lines.join("\n")}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
            responseSchema: SCHEMA,
            thinkingConfig: { thinkingBudget: 0 }, // mechanical extraction — no reasoning budget
          },
        }),
      });
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
      if (!res.ok) { console.warn(`  chunk ${idx}: Gemini ${res.status} ${(await res.text()).slice(0, 120)}`); return []; }
      const j: any = await res.json();
      const txt = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text).join("");
      const arr = JSON.parse(txt) as RawTrade[];
      return Array.isArray(arr) ? arr : [];
    } catch (e: any) {
      if (attempt === 2) { console.warn(`  chunk ${idx}: ${e?.message}`); return []; }
      await sleep(1500);
    }
  }
  return [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Keep lines that plausibly belong to a transaction row (a date, a $ amount, a type word, or an
// upper-case company-ish name) — drops most of the repeated form boilerplate to cut tokens/cost.
function keepLine(l: string): boolean {
  if (l.length < 2 || l.length > 140) return false;
  if (/\d{1,2}\/\d{1,2}\/20\d{2}/.test(l)) return true; // date
  if (/\$[\d,]/.test(l)) return true; // amount
  if (/purch|ourch|sale|sold|exchang|unsolicit/i.test(l)) return true; // type (incl. OCR garble)
  if (/[A-Z]{2,}.*[A-Z]{2,}/.test(l) && /(INC|CORP|CO|LTD|PLC|ETF|TRUST|HLDGS?|GROUP|TECH|COM|CL [A-C]|REIT|FUND|N V|S A)/i.test(l)) return true; // company name
  return false;
}

async function main() {
  if (!KEY) {
    // tsx doesn't auto-load .env.local — read the key from it for local runs (CI injects the env var).
    const env = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf8").catch(() => "");
    KEY = (env.match(/^GEMINI_API_KEY\s*=\s*(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
  }
  if (!KEY) { console.error("GEMINI_API_KEY not set (env or .env.local) — cannot extract. Aborting."); process.exit(1); }
  const all: CongressTrade[] = [];
  let filedDate = "";

  for (const f of FILINGS) {
    filedDate = f.filed;
    console.log(`Downloading ${f.url.slice(0, 70)}…`);
    const res = await fetch(f.url, { headers: { "User-Agent": UA } });
    if (!res.ok) { console.warn(`  download failed ${res.status}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const data = await pdf(buf);
    const lines = String(data.text || "").split("\n").map((l: string) => l.trim()).filter(keepLine);
    console.log(`  ${data.numpages} pages → ${lines.length} candidate lines`);

    const CHUNK = 150;
    const chunks: string[][] = [];
    for (let i = 0; i < lines.length; i += CHUNK) chunks.push(lines.slice(i, i + CHUNK));
    const n = Math.min(chunks.length, CHUNK_LIMIT);
    console.log(`  extracting ${n}/${chunks.length} chunks via ${MODEL}…`);

    for (let i = 0; i < n; i++) {
      const raws = await extractChunk(chunks[i], i);
      for (const r of raws) {
        const txDate = (r.date || "").slice(0, 10);
        if (!/^2026-0[1-3]-\d{2}$/.test(txDate)) continue; // Q1-2026 only; drops OCR-misread dates
        if (!(r.amountLow > 0) || !(r.amountHigh >= r.amountLow)) continue;
        const lag = Math.round((Date.parse(f.filed) - Date.parse(txDate)) / 86400000);
        all.push({
          member: "Donald J. Trump",
          chamber: "Executive" as any,
          ticker: (r.ticker || "").toUpperCase().replace(/[^A-Z.]/g, ""),
          asset: r.company || "",
          type: r.type,
          txDate,
          filedDate: f.filed,
          lagDays: lag >= 0 ? lag : 0,
          amountLow: Math.round(r.amountLow),
          amountHigh: Math.round(r.amountHigh),
          owner: "Self",
        });
      }
      if ((i + 1) % 10 === 0 || i === n - 1) console.log(`    ${i + 1}/${n} chunks · ${all.length} trades so far`);
    }
  }

  // Dedup (OCR + chunk overlap can double-report a row) by date|ticker-or-company|type|amount.
  const seen = new Set<string>();
  const trades = all.filter((t) => {
    const k = `${t.txDate}|${t.ticker || t.asset.toLowerCase()}|${t.type}|${t.amountLow}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  trades.sort((a, b) => b.txDate.localeCompare(a.txDate) || a.asset.localeCompare(b.asset));

  const buys = trades.filter((t) => t.type === "buy").length;
  const sells = trades.filter((t) => t.type === "sell").length;
  const out = {
    generatedAt: new Date().toISOString(),
    filed: filedDate,
    source: "OGE Form 278-T",
    since: trades.reduce((m, t) => (t.txDate < m ? t.txDate : m), "2026-12-31"),
    totals: {
      count: trades.length,
      buys,
      sells,
      notionalLow: trades.reduce((a, t) => a + t.amountLow, 0),
      notionalHigh: trades.reduce((a, t) => a + t.amountHigh, 0),
    },
    trades,
  };
  await fs.writeFile(path.join(DATA_DIR, "trump-trades.json"), JSON.stringify(out));
  console.log(`\nDone. ${trades.length} trades (${buys} buys / ${sells} sells), $${(out.totals.notionalLow / 1e6).toFixed(0)}M–$${(out.totals.notionalHigh / 1e6).toFixed(0)}M → data/trump-trades.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
