/**
 * Extract a sell-side research PDF's text into the canonical ResearchDoc shape using
 * Gemini's structured-output mode (responseSchema), so the model reads the whole note
 * — including the run-together financial-summary grids that defeat regex — and returns
 * clean, typed fields. Needs GEMINI_API_KEY (the same key the rest of the app uses).
 */
import type { ResearchDoc } from "./types";

// Read env lazily (inside calls) so both the Next runtime and CLI scripts that load
// .env.local at startup see the key.
export const extractConfigured = () => !!process.env.GEMINI_API_KEY;

// OpenAPI-subset schema Gemini returns against. `nullable` lets the model omit a rating
// or target for research providers (e.g. Bloomberg Intelligence) that don't issue them.
const SCHEMA = {
  type: "object",
  properties: {
    ticker: { type: "string" },
    company: { type: "string" },
    source: { type: "string" },
    analysts: { type: "array", items: { type: "string" } },
    publishDate: { type: "string", description: "ISO date YYYY-MM-DD" },
    docType: { type: "string", enum: ["rating-change", "initiation", "preview", "earnings-review", "event-reaction", "industry-research", "idea", "note", "other"] },
    title: { type: "string" },
    rating: { type: "string", nullable: true },
    ratingPrior: { type: "string", nullable: true },
    priceTarget: { type: "number", nullable: true },
    priceTargetPrior: { type: "number", nullable: true },
    targetBasis: { type: "string", nullable: true },
    thesis: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    catalysts: { type: "array", items: { type: "string" } },
    managementInsights: { type: "array", items: { type: "string" } },
    estimates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          metric: { type: "string" },
          period: { type: "string" },
          value: { type: "number", nullable: true },
          unit: { type: "string", nullable: true },
          priorValue: { type: "number", nullable: true },
          vsConsensus: { type: "string", nullable: true },
        },
        required: ["metric", "period"],
      },
    },
    summary: { type: "string" },
    entitlement: { type: "string", nullable: true },
  },
  required: ["ticker", "company", "source", "publishDate", "docType", "title", "thesis", "risks", "catalysts", "managementInsights", "estimates", "summary"],
};

const INSTRUCTION =
  `Extract structured data from this equity-research report into the schema. Rules:\n` +
  `- source: the PUBLISHING firm (e.g. "RBC Capital", "TD Securities", "Citi", "Stifel", "Bloomberg Intelligence"), not the covered company.\n` +
  `- For community / buy-side idea write-ups (e.g. Value Investors Club, independent theses, internal memos): set docType to "idea", source to the platform or author (e.g. "Value Investors Club"), and analysts to the author/username. These usually carry no formal rating or 12-month price target — leave those null unless explicitly stated — and their edge is the variant perception (why the market is wrong): capture that in thesis, and any fair-value/target in estimates.\n` +
  `- For research providers that don't issue ratings/price targets (e.g. Bloomberg Intelligence), set rating, ratingPrior, priceTarget, priceTargetPrior to null.\n` +
  `- priceTarget / priceTargetPrior: the NEW and PRIOR 12-month price targets as plain numbers (1500, not "$1,500.00").\n` +
  `- estimates: the key forward numbers — EPS, Revenue, Gross margin, ASP — each with its period (F3Q26, FY26, FY27, CY27, etc.), the priorValue when a revision is shown, and vsConsensus if the report states how it compares to the Street. The financial-summary tables often appear as run-together text (e.g. "Target Price$550.00$1,500.00" means prior $550, current $1,500) — parse current vs prior carefully. Express revenue in $B, EPS in $/share, margins in %.\n` +
  `- thesis: 3–5 concise bullets capturing the argument. risks: the key risks. catalysts: upcoming events / what-to-watch.\n` +
  `- managementInsights: takeaways the analyst attributes to DIRECT ACCESS — management meetings, management commentary/guidance, fireside chats, non-deal roadshows (NDRs), or expert/industry/channel checks. Each a concise point of what was actually learned from that primary source (this is the conviction signal, distinct from the analyst's own modelling). Empty array if the note has no such access.\n` +
  `- entitlement: any "for the exclusive use of <name/firm>" or "not for redistribution" watermark text, else null.\n` +
  `- summary: a tight 3–4 sentence buy-side takeaway. Base everything strictly on the report; never invent numbers.`;

export async function extractResearch(text: string): Promise<ResearchDoc | null> {
  const KEY = process.env.GEMINI_API_KEY;
  const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";
  if (!KEY) return null;
  const prompt = `${INSTRUCTION}\n\n=== REPORT TEXT ===\n${text.slice(0, 120_000)}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
        temperature: 0.1,
        // Bound thinking and give the JSON ample room — extraction needs little
        // reasoning, and unbounded thinking on a long note can truncate the output.
        maxOutputTokens: 16384,
        thinkingConfig: { thinkingBudget: 2048 },
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  const raw = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text).filter(Boolean).join("").trim();
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
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
