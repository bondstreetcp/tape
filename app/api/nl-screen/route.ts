import { NextRequest, NextResponse } from "next/server";
import { SCREEN_FIELDS, FIELD_KEYS, GICS_SECTORS, type ScreenSpec } from "@/lib/nlScreen";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KEY = process.env.GEMINI_API_KEY;
// Structured parsing is a fast, deterministic task → flash (no reasoning needed).
const MODEL = "gemini-2.5-flash";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    filters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string", enum: FIELD_KEYS },
          op: { type: "string", enum: ["lt", "lte", "gt", "gte"] },
          value: { type: "number" },
        },
        required: ["field", "op", "value"],
      },
    },
    sectors: { type: "array", items: { type: "string", enum: GICS_SECTORS } },
    sortBy: { type: "string", enum: FIELD_KEYS },
    sortDir: { type: "string", enum: ["asc", "desc"] },
    limit: { type: "number" },
    interpretation: { type: "string" },
  },
  required: ["filters", "interpretation"],
};

export async function POST(req: NextRequest) {
  if (!KEY) return NextResponse.json({ configured: false });
  let body: { query?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const query = (body.query || "").trim();
  if (!query) return NextResponse.json({ configured: true, error: "Describe what you're looking for." });

  const fieldList = SCREEN_FIELDS.map((f) => `- ${f.key}: ${f.desc}`).join("\n");
  const system =
    `You convert a plain-English stock-screen request into a JSON filter spec. ` +
    `Each filter compares ONE field (use the exact keys below) with an operator ` +
    `(lt, lte, gt, gte) and a numeric value IN THE UNITS DESCRIBED.\n\nFIELDS:\n${fieldList}\n\n` +
    `SECTORS (optional, exact names): ${GICS_SECTORS.join(", ")}.\n\n` +
    `Guidance: "profitable" → netMarginPct gt 0. "cheap"/"value" → a low trailingPE (e.g. lt 15) or low priceToBook. ` +
    `"growing"/"growth" → revGrowthPct gt a threshold (e.g. 15-20). "high margin" → opMarginPct or grossMarginPct gt a threshold. ` +
    `"low debt" → netDebtEbitda lt ~1, or "net cash" → netDebtEbitda lt 0. "beaten down" → pctFromHigh lt -20. ` +
    `"quality" → roePct gt ~15. "large cap" → marketCapB gt 10; "mega cap" → gt 200; "small cap" → lt 2. ` +
    `Pick a sensible sortBy/sortDir to surface the best matches, and set limit (default 50, max 100). ` +
    `interpretation: one concise sentence describing the screen you built.`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: query }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const j: any = await res.json();
    const txt = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text).filter(Boolean).join("");
    const spec = JSON.parse(txt) as ScreenSpec;
    if (!Array.isArray(spec.filters)) throw new Error("bad spec");
    return NextResponse.json({ configured: true, spec });
  } catch (e: any) {
    return NextResponse.json({ configured: true, error: String(e?.message || e).slice(0, 200) });
  }
}
