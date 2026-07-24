/**
 * check-site-health — probe the LIVE origin's SERVED data health and page on failure.
 *
 * The missing monitoring layer behind the 2026-07-24 incident: the served site drifted ~45h stale
 * while every existing alert stayed green, because they all watch the R2/pipeline side (freshness
 * gate after the FULL, alert-freshness on the R2 heartbeat) — none of them ever ask the WEB SERVER
 * what it is actually serving. This probes /api/health/data on the public hostname from GH Actions
 * every 2h. With scheduleAllowanceHours in lib/dataFreshness the endpoint no longer 503s on the
 * designed weekend gap, so ok:false here is REAL on any day of the week.
 *
 * Pages ALERT_WEBHOOK_URL (Slack/Discord/ntfy autodetected by lib/alertNotify) and exits 1 so the
 * workflow run shows red too. Three attempts 60s apart before declaring the site down — a tunnel
 * blip must not page.
 */
import { notifyAlert } from "../lib/alertNotify";

const URL = process.env.SITE_HEALTH_URL || "https://tape.truporchhomesvm.com/api/health/data";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Probe = { kind: "ok"; detail: string } | { kind: "red"; detail: string } | { kind: "down"; detail: string };

async function probe(): Promise<Probe> {
  let res: Response;
  try {
    // NB: an explicit Accept-Encoding matters — the origin currently 502s requests without one.
    res = await fetch(URL, { signal: AbortSignal.timeout(30_000), headers: { "Accept-Encoding": "gzip, br" } });
  } catch (e: any) {
    return { kind: "down", detail: `fetch failed: ${String(e?.message || e).slice(0, 120)}` };
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    return { kind: "down", detail: `HTTP ${res.status}, non-JSON body (tunnel/origin error page?)` };
  }
  if (!Array.isArray(body?.results)) return { kind: "down", detail: `HTTP ${res.status}, unexpected shape` };
  const bad = body.results.filter((r: any) => r.status !== "ok");
  if (body.ok === true) return { kind: "ok", detail: `${body.results.length} feeds ok` };
  const top = bad.slice(0, 6).map((r: any) => `${r.file} ${r.status}${r.ageHours != null ? ` ${r.ageHours}h` : ""}`).join(" · ");
  return { kind: "red", detail: `${bad.length}/${body.results.length} feeds failing: ${top}${bad.length > 6 ? " …" : ""}` };
}

async function main() {
  let last: Probe = { kind: "down", detail: "not probed" };
  for (let i = 1; i <= 3; i++) {
    last = await probe();
    console.log(`attempt ${i}: ${last.kind} — ${last.detail}`);
    if (last.kind !== "down") break; // ok and red are both definitive answers; only retry unreachable
    if (i < 3) await sleep(60_000);
  }
  if (last.kind === "ok") return;
  const msg = last.kind === "down"
    ? `SITE UNREACHABLE (3 attempts over 2 min): ${last.detail} — check the tunnel + tape-web container`
    : `SERVED DATA UNHEALTHY: ${last.detail} — the pipeline side may still look green; check the tape-web container log (rebuild loop) first`;
  await notifyAlert(msg, "Tape site health");
  console.error(`check-site-health: ${msg}`);
  // exitCode, NOT process.exit(): a hard exit right after fetch/notify trips libuv's
  // UV_HANDLE_CLOSING assertion (the documented node-fetch-then-exit trap) — let the loop drain.
  process.exitCode = 1;
}

main().catch((e) => { console.error("check-site-health:", String(e?.message || e)); process.exitCode = 1; });
