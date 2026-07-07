/**
 * Weekly binary-events push digest. Builds the impact-ranked binary-week board (the next 7 days, widened
 * to 14 if sparse) and delivers it as a push message. Channel-flexible + OPT-IN, exactly like the ops
 * alerts — inert (logs only) until you configure a channel:
 *   • DIGEST_WEBHOOK_URL (falls back to ALERT_WEBHOOK_URL) — Slack / Discord / ntfy.sh (auto-detected).
 *   • RESEND_API_KEY + DIGEST_EMAIL_TO — email via Resend (https://resend.com), from DIGEST_EMAIL_FROM.
 *   • SITE_URL — optional; adds a "full board" link.
 * It ALWAYS prints the digest to the run log, so the Actions run shows it even with no channel set.
 *
 * Run from .github/workflows/binary-digest.yml (weekly, Monday pre-market). Not advice.
 */
import { promises as fsp } from "fs";
import path from "path";
import { buildBinaryWeek } from "../lib/binaryWeek";
import { buildDigest } from "../lib/binaryDigest";
import { notifyAlert } from "../lib/alertNotify";

const DATA = path.join(process.cwd(), "data");
const read = (f: string): Promise<any> => fsp.readFile(path.join(DATA, f), "utf8").then((s) => JSON.parse(s)).catch(() => null);

// This week's Monday (UTC) — the digest is a "week of" view.
function mondayOf(nowMs: number): string {
  const d = new Date(nowMs);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const back = (dow + 6) % 7; // days since Monday
  return new Date(nowMs - back * 86_400_000).toISOString().slice(0, 10);
}

async function sendEmail(subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY, to = process.env.DIGEST_EMAIL_TO;
  if (!key || !to) return;
  const from = process.env.DIGEST_EMAIL_FROM || "Tape <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: to.split(",").map((s) => s.trim()), subject, html }),
    });
    console.log(res.ok ? `email: sent to ${to}` : `email: Resend HTTP ${res.status} ${await res.text().catch(() => "")}`.slice(0, 200));
  } catch (e) {
    console.error("email: send failed:", String((e as Error)?.message || e));
  }
}

async function main() {
  const now = Date.now();
  const [earnings, investorDays, biotech, biotechVol, lockups] = await Promise.all([
    read("earnings-move.json"), read("catalyst-vol.json"), read("biotech-catalysts.json"), read("biotech-vol.json"), read("ipo-monitor.json"),
  ]);
  const feeds = { earnings: earnings?.rows, investorDays: investorDays?.rows, biotech: biotech?.items, biotechVol: biotechVol?.rows, lockups: lockups?.events };

  // 7 days ("this week"); widen to 14 if it's a quiet week (< 5 events) so the digest isn't near-empty.
  let events = buildBinaryWeek(feeds, now, { horizonDays: 7 });
  if (events.length < 5) events = buildBinaryWeek(feeds, now, { horizonDays: 14 });

  if (!events.length) { console.log("binary-digest: no dated binary events in the window — nothing to send."); return; }

  const digest = buildDigest(events, { weekOf: mondayOf(now), baseUrl: process.env.SITE_URL, max: 20 });
  console.log(`\n${"=".repeat(60)}\n${digest.markdown}\n${"=".repeat(60)}\n`);
  console.log(`binary-digest: ${digest.count} events (${digest.hardCount} hard binaries).`);

  await notifyAlert(digest.markdown, digest.title, process.env.DIGEST_WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL);
  await sendEmail(digest.title, digest.html);
}

main().catch((e) => { console.error(e); process.exit(1); });
