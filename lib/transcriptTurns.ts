/**
 * Parse a stored transcript's speaker-labeled text (data/calls CallRecord.transcript.text, "Speaker: said\n\n…")
 * into classified turns for the human reader UI (components/TranscriptReader) — an iMessage-style thread where
 * management speaks on one side and analysts/operator on the other. Pure + fs-free (route-safe, tested).
 */
export type TurnSide = "mgmt" | "analyst" | "operator";
export interface TranscriptTurn { speaker: string; role: string; side: TurnSide; text: string }

// Role/keyword hints. MarketBeat labels glue name+role ("Howard TubinVP of Investor Relations at Lululemon").
const ROLE_RE = /\b(chief|officer|CEO|CFO|COO|CTO|president|chair(man)?|founder|treasurer|controller|investor relations|head of|managing director|EVP|SVP|\bVP\b|vice president|executive|director of)\b/i;
const ANALYST_RE = /\banalyst\b|\bresearch\b|securities|capital|partners|\bbank\b|morgan|goldman|barclays|citi(group)?|wells fargo|jpmorgan|jp morgan|jefferies|cowen|piper|baird|stifel|raymond james|evercore|bernstein|\bUBS\b|\bRBC\b|\bBMO\b|mizuho|wolfe|guggenheim|oppenheimer|needham|truist|keybanc|deutsche|\bHSBC\b|william blair|scotiabank|canaccord|benchmark|rosenblatt|melius|redburn|new street|d\.?a\.? davidson|td (securities|cowen)/i;

/** Which side of the thread a speaker sits on. Pure. Operator = system; management = the company; else analyst.
 *  Unlabeled/unknown speakers lean management (prepared remarks are management). */
export function classifySpeaker(label: string): TurnSide {
  const s = (label || "").trim();
  if (!s || /^operator\b/i.test(s)) return s ? "operator" : "mgmt";
  if (ANALYST_RE.test(s) && !ROLE_RE.test(s)) return "analyst"; // a firm/analyst with no exec role
  if (ROLE_RE.test(s)) return "mgmt";
  if (ANALYST_RE.test(s)) return "analyst";
  return "mgmt";
}

// Role words that begin a title — used to un-glue "TubinVP" and to find where the name ends.
// \b-bounded so an abbreviation never matches inside a name (e.g. "COO" must not hit the "coo" in "Cook").
const ROLE_START = /\b(chief|officer|CEO|CFO|COO|CTO|CMO|CIO|president|chair(?:man|woman|person)?|founder|treasurer|controller|investor relations|head of|managing director|EVP|SVP|VP|vice president|executive|director of|senior vice|analyst|partner|research)\b/i;
const GLUED = /([a-z])((?:VP|Chief|President|CEO|CFO|COO|CTO|Chair|Founder|Treasurer|Controller|Head|Managing|EVP|SVP|Executive|Vice|Director|Investor|Analyst|Partner|Research)\b)/g;

/** Best-effort split of a "Name Role at Company" label into {name, role}. Handles MarketBeat's glued form
 *  ("Howard TubinVP of Investor Relations…"). Pure. */
export function splitNameRole(label: string): { name: string; role: string } {
  const s = (label || "").replace(/\s+/g, " ").trim().replace(GLUED, "$1 $2");
  if (!s) return { name: "", role: "" };
  const idx = s.search(ROLE_START);
  if (idx > 0) return { name: s.slice(0, idx).replace(/[,\-–—\s]+$/, "").trim(), role: s.slice(idx).trim() };
  return { name: s, role: "" };
}

/** Management's first substantive passage from a transcript — the CEO/CFO's own framing of the quarter + outlook,
 *  which is what the AI move-explainer / earnings-setup read most needs. Prefers the first exec turn (role names a
 *  chief/CEO/CFO/…), else the first non-boilerplate turn, skipping the IR safe-harbour preamble. A cheap stand-in
 *  for a not-yet-ingested call. Pure; capped to `max` chars on a word boundary. "" when there's no usable turn. */
export function callExcerpt(text: string, max = 550): string {
  const mgmt = parseTranscriptTurns(text).filter((t) => t.side === "mgmt" && t.text.length > 150);
  if (!mgmt.length) return "";
  const isExec = (t: TranscriptTurn) => /\b(chief|CEO|CFO|COO|CTO|president|founder)\b/i.test(t.role);
  const isBoiler = (t: TranscriptTurn) =>
    /investor relations/i.test(t.role) || /forward-looking|safe harbor|risk factors discussed|non-?GAAP|replay of (this|the) call|call is being recorded/i.test(t.text);
  const pick = mgmt.find(isExec) || mgmt.find((t) => !isBoiler(t)) || mgmt[0];
  const s = pick.text.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, "") + "…" : s;
}

/** Split ONE speaker's turn into reader-friendly chat bubbles so prepared remarks read as a sequence of short
 *  messages instead of one wall of text: paragraphs (blank-line breaks) first, then any long paragraph into
 *  ~2-3 sentence groups under `maxChars`. Pure. A single over-long sentence stays whole (never mid-sentence). */
export function splitIntoBubbles(text: string, maxChars = 320): string[] {
  const paras = (text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const para of paras) {
    if (para.length <= maxChars) { out.push(para); continue; }
    const sentences = para.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [para];
    let buf = "";
    for (const s of sentences) {
      if (buf && buf.length + s.length > maxChars) { out.push(buf.trim()); buf = ""; }
      buf += s;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

/** Split the labeled transcript into classified turns. Continuations / unlabeled blocks attach to the prior turn. */
export function parseTranscriptTurns(text: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const block of (text || "").split(/\n{2,}/)) {
    const b = block.trim();
    if (!b) continue;
    const m = b.match(/^([^:\n]{1,140}?):\s+([\s\S]+)$/); // "Speaker label: said …"
    if (m) {
      const { name, role } = splitNameRole(m[1]);
      turns.push({ speaker: name, role, side: classifySpeaker(m[1]), text: m[2].trim() });
    } else if (turns.length) {
      turns[turns.length - 1].text += "\n\n" + b; // a wrapped continuation of the prior speaker
    } else {
      turns.push({ speaker: "", role: "", side: "mgmt", text: b });
    }
  }
  return turns;
}
