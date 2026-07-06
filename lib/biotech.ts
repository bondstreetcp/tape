/**
 * Biotech Catalysts — a binary-event radar built from ClinicalTrials.gov: recent status changes on
 * Phase 2/3, industry-sponsored trials (enrollment done, completed, terminated), mapped to the sponsor's
 * public ticker, with the LLM naming the catalyst + timing. Plus PDUFA rows — announced FDA action
 * dates, extracted from 8-K press releases (EDGAR full-text search) with the date code-verified against
 * the filing text. Built by scripts/refresh-biotech.ts.
 *
 * CLIENT-SAFE: types + pure helpers (no fs). Not advice.
 */

export interface BioCatalyst {
  id: string; // NCT id (trials) or EDGAR accession (PDUFA rows)
  ticker: string;
  company: string; // sponsor
  drug: string;
  condition: string;
  phase: string; // "Phase 3" — or the application type for PDUFA rows ("NDA", "BLA", "sNDA"…)
  status: string; // human status
  statusKind: "readout" | "enrolling-done" | "failed" | "pdufa" | "other";
  primaryCompletion: string | null; // ISO date of the readout (est.) — or the firm PDUFA action date
  lastUpdate: string; // ISO
  catalyst: string; // one-line LLM read: the event + why it matters
  url: string;
}

export interface BiotechData {
  generatedAt: string;
  scanned: number;
  items: BioCatalyst[]; // soonest readout first
}

export const statusColor = (k: BioCatalyst["statusKind"]): string =>
  k === "failed" ? "#ef4444" : k === "readout" ? "#f59e0b" : k === "enrolling-done" ? "#60a5fa" : k === "pdufa" ? "#a78bfa" : "var(--text-2)";
export const statusLabel = (k: BioCatalyst["statusKind"]): string =>
  k === "failed" ? "Failed/stopped" : k === "readout" ? "Readout" : k === "enrolling-done" ? "Enrollment done" : k === "pdufa" ? "FDA decision" : "Update";

// Days until (or since) the primary-endpoint readout — the binary event clock.
export function daysToReadout(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.round((t - Date.now()) / 86_400_000) : null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** Every position where the ISO date appears in the (lowercased) filing text, in a common US format.
 *  This is the anti-fabrication gate for PDUFA rows: a quarter-ish mention ("H1 2027") can never
 *  produce a full date, so the LLM can't invent one. */
export function dateMatchPositions(iso: string, textLower: string): number[] {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return [];
  const [, y, mo, d] = m;
  const moN = Number(mo), dn = Number(d);
  if (moN < 1 || moN > 12 || dn < 1 || dn > 31) return [];
  const mn = MONTHS[moN - 1];
  // only the grammatically-correct ordinal for this day (1st/2nd/3rd/…/11th-13th/…)
  const suffix = dn % 10 === 1 && dn % 100 !== 11 ? "st" : dn % 10 === 2 && dn % 100 !== 12 ? "nd" : dn % 10 === 3 && dn % 100 !== 13 ? "rd" : "th";
  const cands = [
    `${mn} ${dn}, ${y}`, `${mn} ${dn} ${y}`, `${mn} ${dn}${suffix}, ${y}`, `${mn} ${dn}${suffix} ${y}`,
    `${dn} ${mn} ${y}`, `${moN}/${dn}/${y}`, `${mo}/${d}/${y}`, iso,
  ];
  const pos: number[] = [];
  for (const c of cands) { let i = textLower.indexOf(c); while (i >= 0 && pos.length < 50) { pos.push(i); i = textLower.indexOf(c, i + 1); } }
  return pos;
}
export const dateInText = (iso: string, textLower: string): boolean => dateMatchPositions(iso, textLower).length > 0;
/** Co-location gate: the date must appear NEAR one of the anchors (the drug's name) — an 8-K can
 *  announce dates for several programs, and "the date is somewhere in the text" would let the LLM
 *  pair drug A with drug B's date. Same proximity idea as the exec-bios grounding. */
export function dateNearAnchor(iso: string, textLower: string, anchors: string[], window = 1500): boolean {
  const pos = dateMatchPositions(iso, textLower);
  const as = anchors.map((a) => a.toLowerCase().trim()).filter((a) => a.length >= 3);
  if (!pos.length || !as.length) return false;
  return pos.some((p) => { const seg = textLower.slice(Math.max(0, p - window), p + window); return as.some((a) => seg.includes(a)); });
}
