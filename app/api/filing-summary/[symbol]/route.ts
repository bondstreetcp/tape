import { NextRequest, NextResponse } from "next/server";
import { summarizeText, financialSnapshot } from "@/lib/ask";
import { llmConfigured } from "@/lib/llm";
import { getFilingDoc, type FilingForm } from "@/lib/filingDoc";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Buy-side research-memo brief. The model reads the whole filing, so it locates the
// MD&A, guidance and risk sections itself — we just tell it what to pull out.
function instruction(form: string, longName: string): string {
  return (
    `You are a buy-side analyst reading a company's latest ${longName} (SEC ${form}). ` +
    `Write a tight research memo in markdown with these sections:\n` +
    `**Bottom line** — 1–2 sentences: how the business is actually performing and the single most important takeaway.\n` +
    `**Results & drivers** — the key reported numbers (revenue, margins, operating income, EPS, and segment performance) with YoY / sequential direction, and what management's discussion (MD&A) attributes the moves to. Use the REPORTED FINANCIALS block for the hard income-statement and cash-flow figures if the filing text doesn't restate them, and the filing's MD&A for the qualitative drivers. Be specific with figures.\n` +
    `**Outlook & guidance** — any forward guidance, targets, backlog, or demand commentary management provides.\n` +
    `**Liquidity & capital** — cash and debt position, cash flow from operations, capex, and buybacks/dividends.\n` +
    `**Risks & changes** — the most material risk factors, calling out anything that reads as newly added or escalated versus routine boilerplate.\n` +
    `**Watch items** — 2–4 things a sharp analyst would flag (one-offs, accounting choices, segment weakness, rising costs, dilution, contingencies/litigation).\n\n` +
    `Lead with substance and cite specific numbers from the filing. If the filing text appears truncated and a section isn't present, say so briefly rather than inventing it.`
  );
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const form: FilingForm = (req.nextUrl.searchParams.get("form") || "10-K").toUpperCase() === "10-Q" ? "10-Q" : "10-K";
  if (!(await llmConfigured())) return NextResponse.json({ configured: false });
  try {
    const [doc, snapshot] = await Promise.all([
      getFilingDoc(sym, form),
      financialSnapshot(sym).catch(() => ""),
    ]);
    if (!doc || doc.text.length < 1000) return NextResponse.json({ configured: true, available: false, form });
    const longName = form === "10-Q" ? "quarterly report" : "annual report";
    // Pair the structured reported financials (so the income-statement numbers are
    // always present) with the filing's own narrative (drivers, guidance, risks).
    const source =
      (snapshot ? `=== REPORTED FINANCIALS (structured market data) ===\n${snapshot}\n\n` : "") +
      `=== ${doc.form} FILING TEXT ===\n${doc.text}`;
    const result = await summarizeText(`${sym} ${doc.form} filed ${doc.date}`, instruction(form, longName), source, 185_000);
    return NextResponse.json({
      configured: true,
      available: true,
      form: doc.form,
      date: doc.date,
      url: doc.url,
      summary: result?.answer ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ configured: true, available: false, form, error: String(e?.message || e).slice(0, 200) });
  }
}
