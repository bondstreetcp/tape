/**
 * The wire registry — where the tape's rows come from, and how each source is parsed.
 *
 * WHAT IS ACTUALLY AVAILABLE, MEASURED 2026-07-29/30
 * --------------------------------------------------------------------------------------------------
 * Every source here is free, keyless, and public. That constrains latency: EDGAR's current-filings
 * feed runs a measured 4.7–12.3 minutes behind (median 5.3), and the press wires publish ~10 minutes
 * behind. So this is a ~10-minute tape, NOT the second-level tape a paid Reuters/Benzinga feed gives
 * you. Saying otherwise on the page would be a lie, and the UI states the real number.
 *
 * What we get instead, and what no free feed offers, is HISTORY — see mergeTapeAccumulate. The wires
 * expose only their newest ~20 items and forget everything else, so an archive can only be built
 * forward, one poll at a time.
 *
 * Rejected sources, so nobody re-probes them:
 *   · Business Wire  — every published RSS endpoint returned 0 items (feed retired / token-gated).
 *   · ACCESSWIRE     — HTTP 403 to non-browser clients.
 *   · Nasdaq Trader  — 679 items but exchange administrivia (ETP listings), not company news.
 *   · Google News RSS — already used by lib/news.ts for per-name browsing; it is query-shaped and
 *                       carries no timestamps precise enough for a tape.
 */
import type { TapeKind } from "./newsTape";

/** A parsed-but-untagged row, before newsTape assigns a ticker. */
export interface RawItem {
  /** Stable identity from the source itself where one exists (accession, guid); else derived. */
  id: string;
  at: string;
  headline: string;
  url: string;
  /** Publisher's own taxonomy label or code, if any. */
  category: string | null;
  /** Body snippet — searched ONLY for a wire-printed ticker, never for a company name. */
  context: string;
  /** EDGAR only: the filer's CIK, and whether it is the SUBJECT of the filing (see edgarAtom). */
  cik?: string | null;
  subjectIsFiler?: boolean;
}

export interface WireSource {
  id: string;
  name: string;
  url: string;
  kind: TapeKind;
  parse: (body: string) => RawItem[];
}

// ── XML helpers ──────────────────────────────────────────────────────────────────────────────────
const decode = (s: string) =>
  (s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const tag = (block: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? decode(m[1]) : null;
};

const allTags = (block: string, name: string): string[] =>
  [...block.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi"))].map((m) => decode(m[1]));

const blocks = (body: string, el: string): string[] =>
  [...body.matchAll(new RegExp(`<${el}(?:\\s[^>]*)?>([\\s\\S]*?)</${el}>`, "gi"))].map((m) => m[1]);

/**
 * Parse a date to a stable ISO instant, or null.
 *
 * ⚠ Returns null rather than falling back to "now". A row stamped with poll time instead of publish
 * time would sort to the top of the tape and read as breaking news forever — the exact "render state
 * as news" failure the debates ledger exists to avoid. An undateable row is dropped instead.
 */
export function parseWireDate(s: string | null): string | null {
  if (!s) return null;
  const t = Date.parse(s.trim());
  if (Number.isFinite(t)) return new Date(t).toISOString();
  // "Wed, 29 Jul 2026 22:52 GMT" — RFC-822 without seconds, which Date.parse rejects in some runtimes.
  const m = /^\w{3},\s*(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*(GMT|UTC|[+-]\d{4})?$/.exec(s.trim());
  if (m) {
    const t2 = Date.parse(`${m[1]} ${m[2]} ${m[3]} ${m[4]}:${m[5]}:${m[6] || "00"} ${m[7] && /^[+-]/.test(m[7]) ? m[7] : "GMT"}`);
    if (Number.isFinite(t2)) return new Date(t2).toISOString();
  }
  return null;
}

/** Generic RSS 2.0 `<item>` parser — covers PR Newswire and GlobeNewswire. */
function rss(sourceId: string) {
  return (body: string): RawItem[] => {
    const out: RawItem[] = [];
    for (const b of blocks(body, "item")) {
      const headline = tag(b, "title");
      const at = parseWireDate(tag(b, "pubDate") ?? tag(b, "dc:date"));
      const url = tag(b, "link") ?? "";
      if (!headline || !at) continue; // undateable ⇒ dropped, never stamped with poll time
      // dc:subject is GlobeNewswire's taxonomy and PR Newswire's 3-letter code; first one wins.
      const category = allTags(b, "dc:subject")[0] ?? tag(b, "category") ?? null;
      // guid is the publisher's own identity; fall back to the URL, then the headline+time.
      const guid = tag(b, "guid") ?? tag(b, "dc:identifier");
      out.push({
        id: `${sourceId}|${guid || url || `${at}|${headline.slice(0, 80)}`}`,
        at, headline, url, category,
        context: (tag(b, "description") ?? "").slice(0, 400),
      });
    }
    return out;
  };
}

/**
 * SEC EDGAR "latest filings" Atom feed. The best-attributed source on the tape: every entry carries a
 * form type, a company name, a CIK, and an accession number.
 *
 * ⚠ ONE FILING PRODUCES SEVERAL ENTRIES, ALL SHARING ONE ACCESSION NUMBER. EDGAR emits one entry per
 * PARTY, tagged with a trailing role marker. Role census over 100 live entries on 2026-07-30:
 * Reporting 49 · Issuer 42 · Subject 6 · Filed by 2 · Filer 1. A single 13D arrives twice —
 *
 *     SCHEDULE 13D/A - SoftVest Advisors, LLC (0001803391) (Filed by)
 *     SCHEDULE 13D/A - PERMIAN BASIN ROYALTY TRUST (0000319654) (Subject)
 *
 * — and keying rows on the accession alone silently merged them: the archive kept the FILER's headline
 * and then upgraded it with the SUBJECT's ticker, producing a row reading "SoftVest Advisors" tagged
 * PBT. Both halves were individually right; the pairing was invented. So the parse collapses each
 * accession to ONE row and picks the party a reader actually wants — the company the filing is about.
 *
 * ⚠ AND THE ROLE DECIDES WHETHER THE CIK IS EVEN A COMPANY. On Forms 3/4/5 the "Reporting" party is a
 * human insider; on a 13D the "Filed by" party is the activist fund. Their CIKs must never be resolved
 * to a ticker. Only Issuer / Subject / Filer name the registrant — and Filer qualifies precisely
 * because on ordinary corporate forms (8-K, 10-K, S-1) the filer IS the issuer.
 */
const ROLE_RANK: Record<string, number> = { issuer: 3, subject: 3, filer: 2, "filed by": 1, reporting: 1 };
/** Roles whose CIK identifies the registrant rather than a person or fund. */
const ROLE_IS_REGISTRANT = new Set(["issuer", "subject", "filer"]);

function edgarAtom(body: string): RawItem[] {
  // accession → the best entry seen so far for that filing
  const best = new Map<string, { rank: number; item: RawItem }>();
  // accession → the non-registrant party (the insider on a Form 4, the activist on a 13D). Collapsing
  // to the issuer entry is what makes the TICKER right, but it also throws away the only interesting
  // part of an ownership filing — six identical "4 — Natera, Inc." rows say nothing. The counterparty
  // is carried across from the sibling entry so one row can name both sides.
  const counterparty = new Map<string, string>();

  for (const b of blocks(body, "entry")) {
    const title = tag(b, "title");
    const at = parseWireDate(tag(b, "updated"));
    if (!title || !at) continue;
    const hrefM = /<link[^>]*href="([^"]+)"/i.exec(b);
    const url = hrefM ? hrefM[1] : "";
    // urn:tag:sec.gov,2008:accession-number=0001213900-26-083008
    const accM = /accession-number=([\d-]+)/.exec(tag(b, "id") ?? "");
    const cikM = /\((\d{7,10})\)/.exec(title) ?? /\/data\/(\d+)\//.exec(url);

    const role = (/\(([A-Za-z ]+)\)\s*$/.exec(title)?.[1] ?? "").trim().toLowerCase();
    const rank = ROLE_RANK[role] ?? 0;
    const acc = accM ? accM[1] : url || title;

    // "SCHEDULE 13D/A - PERMIAN BASIN ROYALTY TRUST (0000319654) (Subject)" reads badly on a tape.
    // Render it as "SCHEDULE 13D/A — PERMIAN BASIN ROYALTY TRUST": the role marker and the raw CIK are
    // plumbing, and leaving them in is what made the collision hard to see in the first place.
    const form = (title.split(" - ")[0] || "").trim();
    const party = title.slice(form.length + 3).replace(/\s*\(\d{7,10}\)\s*/, " ").replace(/\s*\([A-Za-z ]+\)\s*$/, "").trim();

    if (!ROLE_IS_REGISTRANT.has(role) && party) counterparty.set(acc, party);

    const item: RawItem = {
      id: `edgar|${acc}`,
      at,
      headline: party ? `${form} — ${party}` : title,
      url,
      category: form || null,
      context: tag(b, "summary") ?? "",
      cik: cikM ? cikM[1].padStart(10, "0") : null,
      subjectIsFiler: ROLE_IS_REGISTRANT.has(role),
    };

    const had = best.get(acc);
    if (!had || rank > had.rank) best.set(acc, { rank, item });
  }

  return [...best.values()].map(({ item }) => {
    const other = counterparty.get(item.id.slice("edgar|".length));
    // Only annotate when the chosen row IS the registrant — otherwise the "counterparty" is the
    // registrant and appending it would restate the same name twice.
    return other && item.subjectIsFiler ? { ...item, headline: `${item.headline} · ${other}` } : item;
  });
}

export const WIRE_SOURCES: WireSource[] = [
  {
    id: "edgar", name: "SEC EDGAR", kind: "filing",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&company=&dateb=&owner=include&count=100&output=atom",
    parse: edgarAtom,
  },
  /**
   * A SECOND, 8-K-ONLY EDGAR PULL — not redundancy, a crowd-out guard. The unfiltered feed returns
   * only the newest 100 filings and 49% of them were Form 4s in a quiet overnight sample; in the
   * 16:00–18:00 ET insider-filing rush it is nearly all Form 4s. An 8-K is the single most
   * market-moving thing on this tape and it must not be evictable by a flood of option-grant
   * paperwork. Rows dedupe against the general feed for free — both key on the accession number.
   */
  {
    id: "edgar8k", name: "SEC EDGAR", kind: "filing",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=100&output=atom",
    parse: edgarAtom,
  },
  {
    id: "prn", name: "PR Newswire", kind: "press",
    url: "https://www.prnewswire.com/rss/news-releases-list.rss",
    parse: rss("prn"),
  },
  {
    id: "gnw", name: "GlobeNewswire", kind: "press",
    url: "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies",
    parse: rss("gnw"),
  },
  {
    id: "secpr", name: "SEC Press", kind: "macro",
    url: "https://www.sec.gov/news/pressreleases.rss",
    parse: rss("secpr"),
  },
  {
    id: "fed", name: "Federal Reserve", kind: "macro",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    parse: rss("fed"),
  },
];
