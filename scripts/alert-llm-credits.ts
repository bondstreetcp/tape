/**
 * Proactive LLM-credit alert. The nightly's AI narration — the Trade Desk thesis, the Morning Desk
 * Note, Confluence, valuation verdicts, guidance/13F/overnight write-ups, and the LLM-sorted feeds —
 * ALL route through OpenRouter. When the account runs out of credits every call returns HTTP 402 and
 * those features SILENTLY fall back to code-only / empty output (no thesis, no narration); you only
 * notice by eyeballing the site (which is exactly what happened on 2026-07-04). This pings you BEFORE
 * that: it reads the OpenRouter balance and alerts if it's below LLM_CREDIT_MIN (default $10) — a few
 * nights' runway to top up. Pairs with scripts/alert-freshness.ts; both run from freshness-alert.yml.
 *
 * Inert (exit 0) without a key. On low balance / invalid key it webhooks + exit(1) (→ GitHub's
 * failed-run email as the zero-config baseline). A transient API/network error is NOT an alert.
 */
import { promises as fs } from "fs";
import path from "path";
import { notifyAlert } from "../lib/alertNotify";

const MIN = Number(process.env.LLM_CREDIT_MIN || 10);

/** Resolve the key from env (CI) or .env.local (local tsx runs) — same as lib/llm.ts. */
async function resolveKey(): Promise<string> {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  const env = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf8").catch(() => "");
  return (env.match(/^OPENROUTER_API_KEY\s*=\s*(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
}

async function main(): Promise<void> {
  const key = await resolveKey();
  if (!key) {
    console.log("alert-llm-credits: no OPENROUTER_API_KEY (env or .env.local) — skipping.");
    return;
  }

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/credits", { headers: { Authorization: `Bearer ${key}` } });
  } catch (e) {
    // Network blip — don't cry wolf; a persistent outage surfaces elsewhere.
    console.error("alert-llm-credits: credits fetch failed:", String((e as Error)?.message || e));
    return;
  }

  if (res.status === 401 || res.status === 403) {
    const msg =
      `⚠️ Tape LLM alert: the OpenRouter API key is INVALID (HTTP ${res.status}) — every AI feature will ` +
      `fail. Rotate/refresh the OPENROUTER_API_KEY secret: https://openrouter.ai/settings/keys`;
    await notifyAlert(msg, "Tape LLM key invalid");
    console.error(msg);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`alert-llm-credits: credits API HTTP ${res.status} — skipping (transient).`);
    return;
  }

  const j: any = await res.json().catch(() => null);
  const d = j?.data ?? j ?? {};
  const total = Number(d.total_credits);
  const usage = Number(d.total_usage);
  if (!Number.isFinite(total) || !Number.isFinite(usage)) {
    console.error("alert-llm-credits: unexpected credits payload — skipping.");
    return;
  }
  const remaining = total - usage;
  console.log(`alert-llm-credits: OpenRouter balance ≈ $${remaining.toFixed(2)} (used $${usage.toFixed(2)} of $${total.toFixed(2)}) · floor $${MIN}`);

  if (remaining < MIN) {
    const msg =
      `⚠️ Tape LLM credits LOW — OpenRouter balance ≈ $${remaining.toFixed(2)} (below the $${MIN} floor). ` +
      `When it hits $0 the nightly AI narration (Trade Desk thesis, Morning Desk Note, guidance/valuation ` +
      `write-ups, LLM-sorted feeds) silently goes blank. Top up: https://openrouter.ai/settings/credits`;
    await notifyAlert(msg, "Tape LLM credits low");
    console.error(msg);
    process.exit(1);
  }

  console.log("alert-llm-credits: ✓ credits OK.");
}

main().catch((e) => {
  console.error("alert-llm-credits:", String((e as Error)?.message || e));
  process.exit(1);
});
