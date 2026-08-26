/**
 * diag-yahoo-quality — is Yahoo serving THIS box clean company stats, or the degraded/null payloads
 * that forced the company-cache bake onto the good-IP PC?
 *
 * Run the SAME way on the NAS and on the PC box and compare the two outputs:
 *   npx tsx scripts/diag-yahoo-quality.ts            # default liquid names
 *   npx tsx scripts/diag-yahoo-quality.ts AAPL KO    # specific names
 *
 * It reuses the exact getCompanyStats / getCompanyProfile path the bake uses (Yahoo quoteSummary), so
 * whatever degradation the bake hits shows up here identically — and it prints the box's OUTBOUND
 * PUBLIC IP, which is what actually decides the fix:
 *
 *   • NAS shows DEGRADED + PC shows CLEAN, and they have DIFFERENT IPs  → it's IP-based. Routing the
 *     NAS's Yahoo calls through a clean IP (option B) fixes it; the bake can move to the always-on NAS.
 *   • NAS shows DEGRADED but it has the SAME IP as the (clean) PC       → NOT IP-based. A proxy won't
 *     help — the cause is request volume / User-Agent / pattern (or the container's IPv6/egress), and
 *     the fix is throttling / UA / force-IPv4, not a proxy.
 *   • NAS shows CLEAN                                                   → the degradation has cleared;
 *     the bake could run on the NAS as-is (re-verify over a few nights before retiring the PC).
 *
 * Keyless (Yahoo needs no creds), read-only, writes nothing. Safe to run anywhere.
 */
import { getCompanyStats } from "../lib/companyStats";
import { getCompanyProfile } from "../lib/companyProfile";

const NAMES = process.argv.slice(2).filter((a) => /^[A-Za-z.\-]{1,8}$/.test(a));
const SYMBOLS = NAMES.length ? NAMES.map((s) => s.toUpperCase()) : ["AAPL", "MSFT", "JPM", "KO", "XOM"];

// The fields Yahoo drops when it starves a flagged IP — the same ones the bundle/stock page rely on.
const STAT_FIELDS = ["price", "marketCap", "trailingPE", "forwardPE", "recommendationKey", "targetMean", "numAnalysts", "trailingEps", "beta"] as const;
const PROFILE_FIELDS = ["sector", "industry", "employees", "description"] as const;
const filled = (obj: any, fields: readonly string[]) => fields.filter((f) => obj?.[f] != null && obj[f] !== "").length;

async function outboundIp(): Promise<string> {
  for (const url of ["https://api.ipify.org", "https://ifconfig.me/ip", "https://ipinfo.io/ip"]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r.ok) { const ip = (await r.text()).trim(); if (/^[0-9a-f.:]+$/i.test(ip)) return ip; }
    } catch { /* try next */ }
  }
  return "(couldn't determine)";
}

async function main() {
  const ip = await outboundIp();
  console.log(`\ndiag-yahoo-quality — is Yahoo serving THIS box clean stats?`);
  console.log(`outbound public IP: ${ip}   ← compare this between the NAS and the PC`);
  console.log(`probing ${SYMBOLS.length} names via the same path the bake uses:\n`);

  let cleanNames = 0, deadNames = 0, totalFill = 0;
  for (const sym of SYMBOLS) {
    const [stats, profile] = await Promise.all([
      getCompanyStats(sym).catch((e) => { console.log(`  ${sym.padEnd(6)} getCompanyStats THREW: ${String((e as Error)?.message || e).slice(0, 60)}`); return null; }),
      getCompanyProfile(sym).catch(() => null),
    ]);
    const s = filled(stats, STAT_FIELDS), p = filled(profile, PROFILE_FIELDS);
    totalFill += s;
    const verdict = s >= 6 ? "✓ clean" : s <= 2 ? "✗ DEGRADED" : "~ partial";
    if (s >= 6) cleanNames++; else if (s <= 2) deadNames++;
    console.log(`  ${sym.padEnd(6)} stats ${s}/${STAT_FIELDS.length}  profile ${p}/${PROFILE_FIELDS.length}   ${verdict}` +
      (stats ? `   (price ${stats.price ?? "—"}, mktcap ${stats.marketCap ?? "—"}, recs ${stats.recommendationKey ?? "—"})` : ""));
  }

  const avgFill = (totalFill / SYMBOLS.length / STAT_FIELDS.length * 100).toFixed(0);
  console.log(`\nSUMMARY: ${cleanNames}/${SYMBOLS.length} clean · ${deadNames}/${SYMBOLS.length} degraded · avg stat fill ${avgFill}%`);
  const verdict = cleanNames === SYMBOLS.length ? "CLEAN — Yahoo serves this box good data (bake works here)."
    : deadNames === SYMBOLS.length ? "DEGRADED — Yahoo is starving this box (the company-cache PC-box reason)."
    : "MIXED — partial degradation; re-run a few times, and compare the IP with the PC.";
  console.log(`VERDICT (this box): ${verdict}`);
  console.log(`\nNow run the identical command on the OTHER box and compare the outbound IP + verdict (see the header of this file for what each combination means).\n`);
}

main().catch((e) => { console.error("diag-yahoo-quality:", String((e as Error)?.message || e)); process.exitCode = 1; });
