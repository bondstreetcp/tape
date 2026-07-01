/**
 * Biotech Catalysts — a binary-event radar built from ClinicalTrials.gov: recent status changes on
 * Phase 2/3, industry-sponsored trials (enrollment done, completed, terminated), mapped to the sponsor's
 * public ticker, with the LLM naming the catalyst + timing. Built by scripts/refresh-biotech.ts.
 *
 * CLIENT-SAFE: types + pure helpers (no fs). Not advice.
 */

export interface BioCatalyst {
  id: string; // NCT id
  ticker: string;
  company: string; // sponsor
  drug: string;
  condition: string;
  phase: string; // "Phase 3"
  status: string; // human status
  statusKind: "readout" | "enrolling-done" | "failed" | "other";
  primaryCompletion: string | null; // ISO date of the primary-endpoint readout (est.)
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
  k === "failed" ? "#ef4444" : k === "readout" ? "#f59e0b" : k === "enrolling-done" ? "#60a5fa" : "var(--text-2)";
export const statusLabel = (k: BioCatalyst["statusKind"]): string =>
  k === "failed" ? "Failed/stopped" : k === "readout" ? "Readout" : k === "enrolling-done" ? "Enrollment done" : "Update";

// Days until (or since) the primary-endpoint readout — the binary event clock.
export function daysToReadout(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.round((t - Date.now()) / 86_400_000) : null;
}
