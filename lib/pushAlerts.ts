/**
 * Push alerts — P3 of docs/SPEC-MY-NAMES-MONITOR.md. Pure rule evaluation for the ONLY three
 * event classes that earn a notification (everything else stays pull, on the Change Ledger):
 *
 *   1. reports-soon  — a monitored name prints within ~36h, with the options-priced move
 *   2. deal / 13D    — a definitive merger proxy or an activist SCHEDULE 13D lands on a monitored name
 *   3. preannounce   — a results 8-K ahead of the scheduled print (the known-event trap)
 *
 * Pure and testable: feeds in, messages out; the once-only guarantee is the caller's sent-set
 * (topic|key), persisted by the evaluator script. No LLM anywhere — every alert is a filing or a
 * calendar fact with a deep link home.
 */

export interface PushSub { topic: string; symbols: string[] }

export interface PushFeeds {
  /** merger-arb `targets` — every DEFM14A filer in window */
  targets: { ticker: string; name?: string | null; filedAt: string }[];
  /** campaigns feed — activist 13Ds etc. */
  campaigns: { id?: string; ticker?: string | null; type?: string; form?: string; date?: string; campaigner?: string | null }[];
  /** earnings-move rows — the ≤16d reporters with the priced move */
  earnRows: { symbol: string; earningsDate?: string | null; impliedMovePct?: number | null }[];
  /** preannouncement facts resolved by the caller (network) — sym → filing date */
  preannounced: Record<string, { date: string }>;
}

export interface PushMsg {
  topic: string;
  key: string; // once-only identity: kind|sym|date — the sent-set stores `${topic}|${key}`
  symbol: string;
  title: string;
  body: string;
  tags: string; // ntfy tags (emoji shortcodes)
  priority: "default" | "high";
}

const DAY = 86_400_000;
/** Calendar-square day difference (target − today); null when unparseable. */
const daysFromToday = (dayISO: string | null | undefined, todayDay: string): number | null => {
  if (!dayISO) return null;
  const t = Date.parse(dayISO.slice(0, 10));
  const n = Date.parse(todayDay);
  return Number.isFinite(t) && Number.isFinite(n) ? Math.round((t - n) / DAY) : null;
};

/** 13D-family forms only — a 13G is passive and doesn't earn a push. */
const is13D = (form?: string) => !!form && /13D/i.test(form) && !/13G/i.test(form);

export function evalPushRules(subs: PushSub[], feeds: PushFeeds, sent: Set<string>, todayDay: string): PushMsg[] {
  const out: PushMsg[] = [];
  const targetsBy = new Map(feeds.targets.map((t) => [t.ticker.toUpperCase(), t]));
  const earnBy = new Map(feeds.earnRows.map((r) => [r.symbol.toUpperCase(), r]));
  const campBy = new Map<string, PushFeeds["campaigns"]>();
  for (const c of feeds.campaigns) {
    const k = c.ticker?.toUpperCase();
    if (!k) continue;
    if (!campBy.has(k)) campBy.set(k, []);
    campBy.get(k)!.push(c);
  }

  for (const sub of subs) {
    const push = (m: Omit<PushMsg, "topic">) => {
      if (sent.has(`${sub.topic}|${m.key}`)) return;
      out.push({ topic: sub.topic, ...m });
    };
    for (const raw of sub.symbols) {
      const sym = raw.toUpperCase();

      // 1. reports within ~36h, with the priced move when the chain gave one
      const er = earnBy.get(sym);
      const dte = daysFromToday(er?.earningsDate, todayDay);
      if (er && dte != null && dte >= 0 && dte <= 1) {
        const day = er.earningsDate!.slice(0, 10);
        push({
          key: `rep|${sym}|${day}`,
          symbol: sym,
          title: `${sym} reports ${dte === 0 ? "today" : "tomorrow"}`,
          body: er.impliedMovePct != null ? `Options price a ±${er.impliedMovePct.toFixed(1)}% move.` : "No options-priced move on file.",
          tags: "calendar",
          priority: "default",
        });
      }

      // 2a. definitive deal on a monitored name — only while the proxy is FRESH (≤7d); the sent-set
      // dedupes forever after, but without the freshness gate a NEW subscriber would get pinged for
      // every months-old deal in the window on their first night.
      const tgt = targetsBy.get(sym);
      const dealAge = tgt ? daysFromToday(todayDay, tgt.filedAt.slice(0, 10)) : null; // today − filed: +N = N days old
      if (tgt && dealAge != null && dealAge >= 0 && dealAge <= 7) {
        push({
          key: `deal|${sym}|${tgt.filedAt.slice(0, 10)}`,
          symbol: sym,
          title: `${sym}: definitive merger proxy filed`,
          body: `${tgt.name ?? sym} filed a DEFM14A ${tgt.filedAt.slice(0, 10)} — under agreement to be acquired.`,
          tags: "handshake",
          priority: "high",
        });
      }

      // 2b. activist 13D — same 7-day freshness gate, same reasoning
      for (const c of campBy.get(sym) ?? []) {
        if (!is13D(c.form)) continue;
        const age = c.date ? daysFromToday(todayDay, c.date.slice(0, 10)) : null; // today − filed
        if (age == null || age < 0 || age > 7) continue;
        push({
          key: `13d|${sym}|${(c.id ?? c.date ?? "").slice(0, 40)}`,
          symbol: sym,
          title: `${sym}: SCHEDULE 13D filed`,
          body: `${c.campaigner ?? "An activist"} disclosed an active stake (${c.date?.slice(0, 10) ?? "recent"}).`,
          tags: "loudspeaker",
          priority: "high",
        });
      }

      // 3. preannouncement ahead of the scheduled print
      const pre = feeds.preannounced[sym];
      if (pre) {
        push({
          key: `pre|${sym}|${pre.date}`,
          symbol: sym,
          title: `${sym} preannounced`,
          body: `Results 8-K filed ${pre.date}, ahead of the scheduled print — the print is no longer a normal event.`,
          tags: "warning",
          priority: "high",
        });
      }
    }
  }
  return out;
}
