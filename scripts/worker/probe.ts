/**
 * Is this box's IP clean enough to be the worker? Probes the two sources the NAS can't reach through the
 * same client the jobs use (Investing.com via the system curl, Yahoo via yahoo-finance2). Exit 1 on a block.
 *   npx tsx scripts/worker/probe.ts
 */
import { investingReachable } from "../../lib/transcriptSources";

async function main() {
  const inv = await investingReachable();
  console.log(`investing.com: ${inv ? "ok" : "BLOCKED (403) — this IP cannot be the worker"}`);
  let yahoo = false;
  try {
    const { default: YahooFinance } = await import("yahoo-finance2");
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
    const q: any = await yf.quote("AAPL");
    yahoo = !!q?.regularMarketPrice;
  } catch { yahoo = false; }
  console.log(`yahoo: ${yahoo ? "ok" : "FAILED — throttled or blocked"}`);
  if (!inv || !yahoo) process.exit(1);
}
main().catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
