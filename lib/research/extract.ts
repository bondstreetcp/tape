/**
 * Extract a sell-side research PDF's text into the canonical ResearchDoc shape using
 * GLM (OpenRouter) via lib/llm's JSON mode. The schema is inlined into the prompt (GLM
 * has no responseSchema), so the model reads the whole note — including the run-together
 * financial-summary grids that defeat regex — and returns clean, typed fields. Uses
 * OPENROUTER_API_KEY (lib/llm resolves it from env or .env.local).
 */
import type { ResearchDoc } from "./types";
import { chatJSON } from "../llm";

// Read env lazily (inside calls) so both the Next runtime and CLI scripts that load
// .env.local at startup see the key. lib/llm resolves OPENROUTER_API_KEY on its own;
// this flag keeps the upload route's "is the feature configured" check working.
export const extractConfigured = () =>
  !!(process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY);

// GLM (OpenRouter) has no responseSchema, so the schema is inlined into the prompt as an
// explicit shape description. `nullable`/optional fields let the model omit a rating or
// target for research providers (e.g. Bloomberg Intelligence) that don't issue them.
const SCHEMA_DESC =
  `Return JSON with this EXACT shape (a single object — no markdown, no commentary):\n` +
  `{\n` +
  `  "ticker": string,\n` +
  `  "company": string,\n` +
  `  "source": string,\n` +
  `  "analysts": string[],\n` +
  `  "publishDate": string,            // ISO date YYYY-MM-DD\n` +
  `  "docType": "rating-change" | "initiation" | "preview" | "earnings-review" | "event-reaction" | "industry-research" | "idea" | "note" | "other",\n` +
  `  "title": string,\n` +
  `  "rating": string | null,\n` +
  `  "ratingPrior": string | null,\n` +
  `  "priceTarget": number | null,\n` +
  `  "priceTargetPrior": number | null,\n` +
  `  "targetBasis": string | null,\n` +
  `  "thesis": string[],\n` +
  `  "risks": string[],\n` +
  `  "catalysts": string[],\n` +
  `  "managementInsights": string[],\n` +
  `  "estimates": [ { "metric": string, "period": string, "value": number | null, "unit": string | null, "priorValue": number | null, "vsConsensus": string | null } ],\n` +
  `  "summary": string,\n` +
  `  "entitlement": string | null\n` +
  `}\n` +
  `Required keys (always present): ticker, company, source, publishDate, docType, title, thesis, risks, catalysts, managementInsights, estimates, summary. ` +
  `Each estimates row must have metric and period. Use null (not omitted, not "") for missing nullable values.`;

const INSTRUCTION =
  `Extract structured data from this equity-research report into the schema. Rules:\n` +
  `- source: the PUBLISHING firm (e.g. "RBC Capital", "TD Securities", "Citi", "Stifel", "Bloomberg Intelligence"), not the covered company.\n` +
  `- publishDate: the report's OWN publication/cover date (usually in the header or masthead of the first page), as ISO YYYY-MM-DD — never today's date, and not a date referenced inside the body text.\n` +
  `- For community / buy-side idea write-ups (e.g. Value Investors Club, independent theses, internal memos): set docType to "idea", source to the platform or author (e.g. "Value Investors Club"), and analysts to the author/username. These usually carry no formal rating or 12-month price target — leave those null unless explicitly stated — and their edge is the variant perception (why the market is wrong): capture that in thesis, and any fair-value/target in estimates.\n` +
  `- For research providers that don't issue ratings/price targets (e.g. Bloomberg Intelligence), set rating, ratingPrior, priceTarget, priceTargetPrior to null.\n` +
  `- priceTarget / priceTargetPrior: the NEW and PRIOR 12-month price targets as plain numbers (1500, not "$1,500.00").\n` +
  `- estimates: the key forward numbers — EPS, Revenue, Gross margin, ASP — each with its period (F3Q26, FY26, FY27, CY27, etc.), the priorValue when a revision is shown, and vsConsensus if the report states how it compares to the Street. The financial-summary tables often appear as run-together text (e.g. "Target Price$550.00$1,500.00" means prior $550, current $1,500) — parse current vs prior carefully. Express revenue in $B, EPS in $/share, margins in %.\n` +
  `- thesis: 3–5 concise bullets capturing the argument. risks: the key risks. catalysts: upcoming events / what-to-watch.\n` +
  `- managementInsights: takeaways the analyst attributes to DIRECT ACCESS — management meetings, management commentary/guidance, fireside chats, non-deal roadshows (NDRs), or expert/industry/channel checks. Each a concise point of what was actually learned from that primary source (this is the conviction signal, distinct from the analyst's own modelling). Empty array if the note has no such access.\n` +
  `- entitlement: any "for the exclusive use of <name/firm>" or "not for redistribution" watermark text, else null.\n` +
  `- summary: a tight 3–4 sentence buy-side takeaway. Base everything strictly on the report; never invent numbers.`;

export async function extractResearch(text: string): Promise<ResearchDoc | null> {
  const prompt = `${INSTRUCTION}\n\n${SCHEMA_DESC}\n\n=== REPORT TEXT ===\n${text.slice(0, 120_000)}`;
  // GLM (OpenRouter) JSON mode + lib/llm's parse/validate-retry. Generous maxTokens so
  // GLM's thinking can't truncate the JSON on a long note.
  const d: any = await chatJSON(
    "You are a precise data-extraction engine. Return only the requested JSON object.",
    prompt,
    { maxTokens: 16384 },
  );
  if (!d) return null;
  try {
    // normalise to the canonical shape with safe defaults
    return {
      ticker: String(d.ticker || "").toUpperCase().replace(/\.(O|OQ|N|A|K|P|PK|Q)$/i, ""),
      company: d.company || "",
      source: d.source || "Unknown",
      analysts: Array.isArray(d.analysts) ? d.analysts : [],
      publishDate: d.publishDate || "",
      docType: d.docType || "other",
      title: d.title || "",
      rating: d.rating ?? null,
      ratingPrior: d.ratingPrior ?? null,
      priceTarget: typeof d.priceTarget === "number" ? d.priceTarget : null,
      priceTargetPrior: typeof d.priceTargetPrior === "number" ? d.priceTargetPrior : null,
      targetBasis: d.targetBasis ?? null,
      thesis: Array.isArray(d.thesis) ? d.thesis : [],
      risks: Array.isArray(d.risks) ? d.risks : [],
      catalysts: Array.isArray(d.catalysts) ? d.catalysts : [],
      managementInsights: Array.isArray(d.managementInsights) ? d.managementInsights : [],
      estimates: Array.isArray(d.estimates) ? d.estimates.map((e: any) => ({
        metric: e.metric || "", period: e.period || "", value: typeof e.value === "number" ? e.value : null,
        unit: e.unit ?? null, priorValue: typeof e.priorValue === "number" ? e.priorValue : null, vsConsensus: e.vsConsensus ?? null,
      })) : [],
      summary: d.summary || "",
      entitlement: d.entitlement ?? null,
    };
  } catch {
    return null;
  }
}
