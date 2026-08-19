/**
 * Prefill-throughput benchmark for the local inference server (LLM_LOCAL_*).
 *
 * PREFILL (chewing input tokens) is the bottleneck that decides whether the high-input nightly jobs
 * can run locally. overnight-filings alone prefills ~4.5M tokens/night; run-tick kills a step at 45min,
 * so overnight-filings can only go local if the box sustains ~4.5M/(45·60) ≈ 1,700 tok/s aggregate.
 * Low-input jobs (IPO classify, event feeds, catalysts) prefill a fraction of that and are fine on
 * almost any speed — this bench is about the BIG job.
 *
 * Method: send filing-sized prompts with max_tokens:1 (so wall-clock ≈ prefill, generation is one
 * token), at a couple of concurrency levels, and read usage.prompt_tokens for exact counts. Each prompt
 * gets a unique prefix so the server can't prefix-cache a prior identical one and fake the speed.
 *
 * Run ON the GPU box (or anywhere that can reach the server):
 *   LLM_LOCAL_BASE_URL=http://localhost:8000/v1 LLM_LOCAL_MODEL=<served-id> npm run bench-prefill
 * Knobs (env): PROMPT_TOKENS=12000  NIGHT_TOKENS=4500000  CONCURRENCY=1,4,8  ROUNDS=5  STEP_MIN=45
 */
const BASE = (process.env.LLM_LOCAL_BASE_URL || "").replace(/\/+$/, "");
const MODEL = process.env.LLM_LOCAL_MODEL || "";
const KEY = process.env.LLM_LOCAL_API_KEY || "local";
const PROMPT_TOKENS = Number(process.env.PROMPT_TOKENS) || 12_000; // ~ one overnight-filings digest prompt
const NIGHT_TOKENS = Number(process.env.NIGHT_TOKENS) || 4_500_000; // overnight-filings' nightly input
const CONCURRENCY = (process.env.CONCURRENCY || "1,4").split(",").map((n) => parseInt(n, 10)).filter((n) => n > 0);
const ROUNDS = Number(process.env.ROUNDS) || 5;
const STEP_MIN = Number(process.env.STEP_MIN) || 45; // run-tick's per-step kill (STEP_TIMEOUT_MIN)

if (!BASE || !MODEL) {
  console.error("bench-prefill: set LLM_LOCAL_BASE_URL and LLM_LOCAL_MODEL, e.g.");
  console.error("  LLM_LOCAL_BASE_URL=http://localhost:8000/v1 LLM_LOCAL_MODEL=<served-id> npm run bench-prefill");
  process.exit(1);
}

// ~4 chars/token of filing-ish filler; a unique prefix per call defeats prefix caching.
const FILLER = "The registrant reported net revenue, gross margin, and discussed liquidity and risk factors. "
  .repeat(Math.ceil((PROMPT_TOKENS * 4) / 92))
  .slice(0, PROMPT_TOKENS * 4);
let seq = 0;
const uniquePrompt = () => `[bench ${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}]\n${FILLER}`;

async function oneCall(): Promise<{ ok: boolean; promptTokens: number }> {
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1, temperature: 0, messages: [{ role: "user", content: uniquePrompt() }] }),
    });
    if (!res.ok) {
      console.error(`  HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
      return { ok: false, promptTokens: 0 };
    }
    const j: any = await res.json();
    return { ok: true, promptTokens: Number(j?.usage?.prompt_tokens) || PROMPT_TOKENS };
  } catch (e: any) {
    console.error(`  request failed: ${String(e?.message || e).slice(0, 120)}`);
    return { ok: false, promptTokens: 0 };
  }
}

async function main() {
  console.log(`bench-prefill → ${BASE} · model=${MODEL}`);
  console.log(`~${PROMPT_TOKENS} tok/prompt · ${ROUNDS} rounds · concurrency=[${CONCURRENCY.join(", ")}]\n`);
  console.log("warm-up (loads weights / builds caches)…");
  await oneCall();

  const needTokS = NIGHT_TOKENS / (STEP_MIN * 60);
  let best = 0;
  for (const C of CONCURRENCY) {
    let toks = 0, ms = 0, ok = 0;
    for (let r = 0; r < ROUNDS; r++) {
      const t0 = Date.now();
      const results = await Promise.all(Array.from({ length: C }, () => oneCall()));
      ms += Date.now() - t0;
      for (const res of results) if (res.ok) { toks += res.promptTokens; ok++; }
    }
    const tokS = ms > 0 ? toks / (ms / 1000) : 0; // aggregate prefill throughput at this concurrency
    best = Math.max(best, tokS);
    const hrs = tokS > 0 ? NIGHT_TOKENS / tokS / 3600 : Infinity;
    console.log(`  concurrency ${String(C).padStart(2)}: ${tokS.toFixed(0).padStart(6)} tok/s aggregate  (${ok}/${C * ROUNDS} ok)  →  ${(NIGHT_TOKENS / 1e6).toFixed(1)}M = ${hrs.toFixed(1)}h`);
  }

  console.log(`\nBar: overnight-filings (${(NIGHT_TOKENS / 1e6).toFixed(1)}M tok) must prefill inside the ${STEP_MIN}-min step ⇒ need ~${needTokS.toFixed(0)} tok/s aggregate.`);
  if (best >= needTokS) {
    console.log(`✓ best ${best.toFixed(0)} tok/s CLEARS it — overnight-filings could run local (validate output quality separately).`);
  } else {
    console.log(`✗ best ${best.toFixed(0)} tok/s is BELOW ~${needTokS.toFixed(0)} — keep overnight-filings on cloud flash-lite.`);
    console.log(`  (Low-input jobs still run fine locally: they prefill far less than 4.5M/night.)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
