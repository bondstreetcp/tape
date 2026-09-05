/**
 * Push-alert evaluator (P3, docs/SPEC-MY-NAMES-MONITOR.md) — nightly, AFTER the feeds it reads
 * (merger-arb / campaigns / earnings-move) have refreshed. Reads the push_subs registry
 * (Supabase), evaluates lib/pushAlerts' three rules against the fresh feeds, and sends via ntfy.
 *
 * SINGLE-SENDER GATE: only the PRIMARY WRITER sends (TAPE_WRITER=nas — run-tick sets it on this
 * step; the GitHub mirror step evaluates and logs but never sends, so a standdown fail-open can't
 * double-notify). PUSH_ALERTS_FORCE=1 overrides for a supervised local test.
 *
 * Once-only: data/.tmp/push-sent.json (topic|key → date). data/.tmp is excluded from the R2
 * tarball and the runner's volume persists, so re-runs and hourly ticks can't re-send. Pruned at
 * 90d. Everything degrades: no DB → exit 0; a failed send just stays unsent (retried next run).
 */
import { promises as fs } from "fs";
import path from "path";
import { listPushSubs, sendNtfy } from "../lib/pushSubs";
import { evalPushRules, type PushFeeds } from "../lib/pushAlerts";
import { detectPreannounce } from "../lib/preannounce";
import { pool } from "../lib/edgar";
import { readJson } from "../lib/scriptKit";

const DATA = path.join(process.cwd(), "data");
const SENT_PATH = path.join(DATA, ".tmp", "push-sent.json");
const DAY = 86_400_000;


async function main() {
  const isSender = process.env.TAPE_WRITER === "nas" || process.env.PUSH_ALERTS_FORCE === "1";
  const subs = await listPushSubs().catch((e) => { console.warn(`push-alerts: subs unreachable (${String(e?.message || e).slice(0, 80)}) — skipping.`); return []; });
  if (!subs.length) { console.log("push-alerts: no subscriptions — nothing to do."); return; }

  const [ma, camp, emove] = await Promise.all([
    readJson<{ targets?: PushFeeds["targets"] }>("merger-arb.json"),
    readJson<{ campaigns?: PushFeeds["campaigns"] }>("campaigns.json"),
    readJson<{ rows?: PushFeeds["earnRows"] }>("earnings-move.json"),
  ]);

  // Preannounce facts for the UNION of subscribed symbols that have a scheduled print on file —
  // one submissions check per name (memoized in-process), pooled politely.
  const union = [...new Set(subs.flatMap((s) => s.symbols.map((x) => x.toUpperCase())))];
  const earnBy = new Map((emove?.rows ?? []).map((r) => [r.symbol.toUpperCase(), r]));
  const preannounced: PushFeeds["preannounced"] = {};
  await pool(union.filter((s) => earnBy.has(s)), 4, async (sym) => {
    const er = earnBy.get(sym)!;
    const pre = await detectPreannounce(sym, er.earningsDate ?? null).catch(() => null);
    if (pre) preannounced[sym] = { date: pre.date };
  });

  let sentMap: Record<string, string> = {};
  try { sentMap = JSON.parse(await fs.readFile(SENT_PATH, "utf8")); } catch { /* first run */ }
  const now = Date.now();
  for (const [k, v] of Object.entries(sentMap)) if (now - Date.parse(v) > 90 * DAY) delete sentMap[k];

  const todayDay = new Date().toISOString().slice(0, 10);
  const msgs = evalPushRules(
    subs,
    { targets: ma?.targets ?? [], campaigns: camp?.campaigns ?? [], earnRows: emove?.rows ?? [], preannounced },
    new Set(Object.keys(sentMap)),
    todayDay,
  );
  console.log(`push-alerts: ${subs.length} sub(s), ${union.length} names → ${msgs.length} new alert(s)${isSender ? "" : " [NOT the primary writer — evaluate-only, nothing sent]"}`);
  if (!isSender || !msgs.length) return;

  let sent = 0;
  for (const m of msgs) {
    const ok = await sendNtfy(m.topic, m.title, m.body, { tags: m.tags, priority: m.priority, clickPath: `/u/sp500/stock/${encodeURIComponent(m.symbol)}` });
    if (ok) { sentMap[`${m.topic}|${m.key}`] = new Date().toISOString(); sent++; }
    else console.warn(`push-alerts: send failed for ${m.symbol} (${m.key}) — will retry next run.`);
  }
  await fs.mkdir(path.dirname(SENT_PATH), { recursive: true });
  await fs.writeFile(SENT_PATH, JSON.stringify(sentMap));
  console.log(`push-alerts: sent ${sent}/${msgs.length}.`);
}

main().catch((e) => { console.error("push-alerts:", String(e?.message || e)); process.exit(1); });
