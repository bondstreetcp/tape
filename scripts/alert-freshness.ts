/**
 * Staleness ALERT for the R2 data pipeline. The nightly refresh (.github/workflows/refresh-data.yml)
 * runs in GitHub's cloud and pushes data to R2; if it silently fails, the deployed site quietly serves
 * stale prices + a frozen options/earnings desk. This check pings you so YOU know to re-run it manually.
 *
 * It reads `site-data/full-heartbeat.json` — an object data-to-r2 writes ONLY on the FULL nightly run.
 * (The main manifest can't be used: every 2-hourly intraday tick refreshes it, so a manifest can look
 * fresh while the FULL run — which alone rebuilds the options/earnings feeds — has been dead for days.)
 *
 * Runs from .github/workflows/freshness-alert.yml on Tue-Sat 03:30 UTC — the mornings AFTER each
 * Mon-Fri 22:47 UTC FULL run has had its full timeout window to finish. No weekend false alarms: we
 * never check on a morning that isn't preceded by a scheduled FULL run.
 *
 * On staleness: POST to ALERT_WEBHOOK_URL (Slack / Discord / ntfy.sh auto-detected) AND exit(1) — a
 * failed run gives GitHub's built-in "scheduled workflow failed" email for free, so the webhook is
 * optional belt-and-suspenders. Inert (exit 0) without the LAKE_S3_* creds or before the first FULL run.
 */
import { getObject, r2Configured } from "../lib/r2";

const KEY_HEARTBEAT = "site-data/full-heartbeat.json";
// Healthy: the last FULL ran ~5h before this 03:30 check. A miss means the previous FULL is ~29h back.
// 28h cleanly separates the two and tolerates a slow FULL run. Override via FRESH_MAX_HOURS.
const MAX_HOURS = Number(process.env.FRESH_MAX_HOURS || 28);

async function notify(msg: string): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) {
    console.log("(no ALERT_WEBHOOK_URL set — relying on GitHub's failed-run email)");
    return;
  }
  const isNtfy = /(^|\/\/)ntfy\.sh\//.test(url) || /\/\/ntfy\./.test(url);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: isNtfy
        ? { Title: "Tape data is stale", Priority: "high", Tags: "warning" }
        : { "Content-Type": "application/json" },
      // Slack wants {text}, Discord wants {content}; ntfy wants the raw string. Send all shapes at once.
      body: isNtfy ? msg : JSON.stringify({ text: msg, content: msg }),
    });
    console.log(res.ok ? "alert-freshness: webhook notified." : `alert-freshness: webhook HTTP ${res.status}`);
  } catch (e) {
    console.error("alert-freshness: webhook POST failed:", String((e as Error)?.message || e));
  }
}

async function main(): Promise<void> {
  if (!r2Configured()) {
    console.log("alert-freshness: R2 not configured (LAKE_S3_*) — skipping.");
    return;
  }

  let hb: { generatedAt?: string };
  try {
    hb = JSON.parse((await getObject(KEY_HEARTBEAT)).toString());
  } catch {
    // Written on the next FULL run — until then there is nothing to judge; don't cry wolf.
    console.log(`alert-freshness: no ${KEY_HEARTBEAT} yet (written on the next FULL run) — skipping.`);
    return;
  }

  const ts = Date.parse(hb?.generatedAt || "");
  if (!Number.isFinite(ts)) {
    const msg = "⚠️ Tape data alert: full-heartbeat.json has no valid generatedAt — the nightly refresh may be broken. Check https://github.com/bondstreetcp/tape/actions";
    await notify(msg);
    console.error(msg);
    process.exit(1);
  }

  const ageH = (Date.now() - ts) / 3600000;
  console.log(`alert-freshness: last FULL refresh ${hb.generatedAt} (${ageH.toFixed(1)}h ago) · threshold ${MAX_HOURS}h`);

  if (ageH > MAX_HOURS) {
    const msg =
      `⚠️ Tape data is STALE — the last full nightly refresh was ${ageH.toFixed(0)}h ago ` +
      `(${hb.generatedAt}). Last night's refresh-data run likely failed, so the site is serving old ` +
      `prices + a frozen options/earnings desk. Re-run it: https://github.com/bondstreetcp/tape/actions/workflows/refresh-data.yml`;
    await notify(msg);
    console.error(msg);
    process.exit(1);
  }

  console.log("alert-freshness: ✓ data is fresh.");
}

main().catch((e) => {
  console.error("alert-freshness:", String((e as Error)?.message || e));
  process.exit(1);
});
