/** Pure identities/parsers shared by the conference runner and its tests. No browser/session state here. */
export interface ConferenceTalk {
  id: string;
  name: string;
  date: string;
  url: string;
  symbol?: string;
}

export function webcastUrl(value: string): URL {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.hostname !== "event.webcasts.com" || u.username || u.password || u.port || !/^\d{1,16}$/.test(u.searchParams.get("ei") || ""))
    throw new Error("Use an https://event.webcasts.com conference link with an ei event ID.");
  return u;
}

export function speakerLink(onclick: string): { id: string; url: string } | null {
  const match = onclick.match(/showSpeaker\(\s*['"]([^'"]+)['"]/);
  if (!match) return null;
  try {
    const u = webcastUrl(match[1].replace(/&amp;/g, "&"));
    return { id: u.searchParams.get("ei")!, url: u.href };
  } catch { return null; }
}

export function agendaDate(onclick: string): string | null {
  const m = onclick.match(/changeday\(\s*['"](\d{1,2})\/(\d{1,2})\/(\d{4})['"]/);
  if (!m) return null;
  const iso = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

export function streamForTalk(value: string, id: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && (u.hostname === "webcasts.com" || u.hostname.endsWith(".webcasts.com"))
      && u.pathname.endsWith(".m3u8") && u.pathname.includes(`/${id}/`);
  } catch { return false; }
}

export const companyKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export const validSymbol = (s: string): boolean => /^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(s);

/** Exact name matches only; ambiguous names stay unmapped instead of attaching research to the wrong stock. */
export function resolveSymbol(name: string, explicit: Record<string, string>, stocks: { name: string; symbol: string }[]): string | undefined {
  const override = Object.entries(explicit).find(([key]) => companyKey(key) === companyKey(name));
  if (override) {
    const symbol = override[1].toUpperCase();
    if (!validSymbol(symbol)) throw new Error(`Invalid ticker mapping for ${name}`);
    return symbol;
  }
  const candidates = [...new Set(stocks.filter(s => companyKey(s.name) === companyKey(name)).map(s => s.symbol.toUpperCase()))];
  return candidates.length === 1 && validSymbol(candidates[0]) ? candidates[0] : undefined;
}

/** Do not persist signed stream tokens, cookies, or provider response bodies in the run manifest. */
export function safeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error).replace(/https?:\/\/[^\s)"']+/g, "[URL redacted]").slice(0, 350);
}

export interface StagePaths { audio: string; transcript: string; digest: string }
export interface StageActions {
  exists(path: string): Promise<boolean>;
  capture(): Promise<void>;
  transcribe(): Promise<void>;
  digest(): Promise<void>;
  checkpoint(stage: "audio" | "transcript" | "digest"): Promise<void>;
}

/** Each committed artifact is a restart boundary. Exceptions propagate; completion is never inferred from a queue. */
export async function runTalkStages(paths: StagePaths, actions: StageActions, until: "audio" | "transcript" | "digest" = "digest"): Promise<void> {
  for (const stage of ["audio", "transcript", "digest"] as const) {
    if (!await actions.exists(paths[stage])) {
      await actions[stage === "audio" ? "capture" : stage === "transcript" ? "transcribe" : "digest"]();
      if (!await actions.exists(paths[stage])) throw new Error(`${stage} produced no committed artifact`);
    }
    await actions.checkpoint(stage);
    if (stage === until) return;
  }
}
