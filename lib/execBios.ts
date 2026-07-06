// Shared types for the executive-bio drill-down (API route + the client card). The route grounds every
// field in the company's SEC filings (DEF 14A proxy + 10-K exec-officers section); a null/empty field
// means the filing didn't disclose it — never a fabrication.

export interface ExecBio {
  found: boolean; // was this person's bio located in the filings?
  since: number | null; // year they took their current role, if stated
  priorRoles: string[]; // prior positions / employers
  education: string[]; // degrees + schools, only if the filing states them
  otherBoards: string[]; // other public-company / institutional boards
  summary: string | null; // one-line plain-English synthesis, grounded in the bio
}

export interface ExecBiosResponse {
  symbol: string;
  proxy: { url: string; date: string } | null; // the DEF 14A source (for "verify →")
  bios: Record<string, ExecBio>; // keyed by the profile roster name
  note?: string;
}

/** True if a bio has anything worth expanding beyond the roster row. */
export function bioHasDetail(b: ExecBio | undefined | null): boolean {
  return !!b && b.found && !!(b.summary || b.since || b.priorRoles.length || b.education.length || b.otherBoards.length);
}
