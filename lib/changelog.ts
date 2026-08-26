/**
 * The user-facing "What's new" changelog. Newest entry first. Bump the TOP entry's `id` whenever you
 * want the splash to re-appear for everyone (it's keyed on that id in localStorage), so routine deploys
 * don't nag — only a real, summarized release does. CLIENT-SAFE: plain data, imported by <WhatsNew/>.
 */
export interface ChangelogEntry {
  id: string; // stable key for the "seen" check — bump to re-show the splash
  date: string; // YYYY-MM-DD
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-08-25",
    date: "2026-08-25",
    title: "Staples Scanner, a live news wire & sharper earnings tools",
    items: [
      "New Staples Scanner (Screens → Staples Scanner) — NielsenIQ US retail demand & share for consumer staples: an AI desk read, sortable inline momentum sparklines, a ~2-week-lagged leading read on each name's quarter, and a new alert (Alerts → Signal → “Staples scanner inflection”) when a name accelerates or decelerates into its print.",
      "New Market Wire (Markets → Market Wire, plus tabs on Daily Desk & Macro and a scrolling ticker on every page) — Walter Bloomberg's curated flashes leading, then Reuters / Bloomberg / CNBC / WSJ. Clickable $tickers jump to the stock, it refreshes ~every 2 min with NEW flags, and the flashes now feed the AI daily brief.",
      "Macro — live “Recent releases” straight from BEA & BLS (GDP, CPI, jobs, PCE), the moment they print; plus a new “Real economy” tab tracking free freight (rail carloads/intermodal + a truck-freight index), air travel (TSA throughput), and housing (starts, permits, construction spend) — the alt-data that leads the hard prints (hotel is a lodging-CPI proxy, not licensed RevPAR).",
      "Earnings — plain-English AI reads of “what are the options positioned for?” and the “technical setup” into the print (now flagging relative strength vs the stock’s sector — leading or lagging); the AI preview factors in the Nielsen scanner for staples names; the expected-move chart no longer clips outlier prints; and the whole tab is reorganized into clear, scannable sections — the setup, how it trades the print, and the AI desk reads (which now fold away until you want them).",
      "Fixes across the board — realized-vol cone & dislocation sorting, IPO lockups, the backtest timeframe toggle, spin-off returns, merger-arb links, and the catalyst calendar.",
    ],
  },
];

export const LATEST = CHANGELOG[0];
