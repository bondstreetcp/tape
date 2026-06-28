// StockTwits retail chatter — recent message volume + bull/bear sentiment + the top posts, to
// help explain why a name is moving (a sentiment shift or a posting-rate spike often accompanies
// a move). Fetched live per stock page (no snapshot — it's real-time and per-name). The public
// streams endpoint covers US listings + many ADRs; intl-suffixed tickers usually won't resolve.

export interface StockTwitsMessage {
  id: number;
  body: string;
  sentiment: "Bullish" | "Bearish" | null;
  createdAt: string;
  user: string;
  likes: number;
}

export interface StockTwitsInfo {
  symbol: string;
  title: string | null;
  watchlistCount: number | null; // how many StockTwits users follow the name (popularity)
  total: number; // messages sampled (≤30)
  bullish: number;
  bearish: number;
  neutral: number;
  bullishPct: number | null; // bullish ÷ (bullish+bearish), 0–100; null if nobody tagged a side
  perHour: number | null; // recent posting rate — a spike means something's happening
  messages: StockTwitsMessage[]; // substantive recent posts (cashtag-only spam dropped), newest first
}

// Our intl universe suffixes — StockTwits' US stream won't resolve these, so skip the fetch.
const NON_US = /\.(PA|AS|L|DE|SW|TO|MX|KS|KQ|T|HK|MI|MC|F|SS|SZ|AX|NZ|SI|TW|SA|BR|VI|ST|HE|CO|OL|NS|BO)$/i;

// Strip cashtags / links / @mentions to judge whether a post actually says anything.
const cleanBody = (b: string) =>
  b.replace(/\$[A-Za-z.\-]+/g, "").replace(/https?:\/\/\S+/g, "").replace(/@\w+/g, "").replace(/\s+/g, " ").trim();

export interface RawMsg {
  body: string;
  sentiment: "Bullish" | "Bearish" | null;
  createdAt: string;
}

// Paginated fetch of a name's recent substantive posts (for the day/week AI summary). Walks the
// `cursor.max` pages until it reaches ~maxDays old or maxPages, whichever first. Returns null on a
// hard failure (intl / network).
export async function fetchStockTwitsWindow(symbol: string, maxPages = 5, maxDays = 8): Promise<RawMsg[] | null> {
  const s = decodeURIComponent(symbol).trim().toUpperCase();
  if (!s || NON_US.test(s)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 16000);
  const out: RawMsg[] = [];
  const cutoff = Date.now() - maxDays * 86_400_000;
  try {
    let max: number | undefined;
    for (let p = 0; p < maxPages; p++) {
      const url = `https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(s)}.json${max ? `?max=${max}` : ""}`;
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Tape research)", Accept: "application/json" }, signal: ctrl.signal });
      if (!r.ok) break;
      const j: any = await r.json();
      const msgs: any[] = Array.isArray(j?.messages) ? j.messages : [];
      if (!msgs.length) break;
      for (const m of msgs) {
        const body = String(m?.body || "").trim();
        if (cleanBody(body).length > 10) out.push({ body, sentiment: (m?.entities?.sentiment?.basic ?? null) as RawMsg["sentiment"], createdAt: m?.created_at || "" });
      }
      max = j?.cursor?.max;
      const oldest = Date.parse(msgs[msgs.length - 1]?.created_at);
      if (!max || (!Number.isNaN(oldest) && oldest < cutoff)) break;
    }
    return out.length ? out : null;
  } catch {
    return out.length ? out : null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getStockTwits(symbol: string): Promise<StockTwitsInfo | null> {
  const s = decodeURIComponent(symbol).trim().toUpperCase();
  if (!s || NON_US.test(s)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(s)}.json`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Tape research)", Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!r.ok) return null; // 404 (unknown ticker) / 429 (rate-limited) → treat as no data
    const j: any = await r.json();
    const msgs: any[] = Array.isArray(j?.messages) ? j.messages : [];
    if (!msgs.length) return null;

    let bullish = 0, bearish = 0, neutral = 0;
    const substantive: StockTwitsMessage[] = [];
    for (const m of msgs) {
      const sent = m?.entities?.sentiment?.basic ?? null;
      if (sent === "Bullish") bullish++;
      else if (sent === "Bearish") bearish++;
      else neutral++;
      const body = String(m?.body || "").trim();
      if (cleanBody(body).length > 12) {
        substantive.push({
          id: Number(m?.id) || 0,
          body,
          sentiment: sent === "Bullish" || sent === "Bearish" ? sent : null,
          createdAt: m?.created_at || "",
          user: m?.user?.username || "",
          likes: Number(m?.likes?.total) || 0,
        });
      }
    }

    const tagged = bullish + bearish;
    // Posting rate over the sampled window (messages are newest-first).
    let perHour: number | null = null;
    const times = msgs.map((m) => Date.parse(m?.created_at)).filter((t) => !Number.isNaN(t));
    if (times.length >= 2) {
      const spanHrs = (Math.max(...times) - Math.min(...times)) / 3.6e6;
      if (spanHrs > 0.01) perHour = msgs.length / spanHrs;
    }

    return {
      symbol: j?.symbol?.symbol || s,
      title: j?.symbol?.title || null,
      watchlistCount: j?.symbol?.watchlist_count != null ? Number(j.symbol.watchlist_count) : null,
      total: msgs.length,
      bullish,
      bearish,
      neutral,
      bullishPct: tagged ? Math.round((bullish / tagged) * 100) : null,
      perHour,
      messages: substantive.slice(0, 10),
    };
  } catch {
    return null; // network / abort / parse — no data
  } finally {
    clearTimeout(timer);
  }
}
