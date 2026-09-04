# Local LLM offload — run the extraction fleet on the EPYC/3090 box

The nightly **mechanical-extraction** calls (overnight filings, IPO/campaign/corp-event/fed/policy/
biotech/trump classifiers — ~90% of token volume, ~$70–95/mo of API) can run on the local server;
**judgment work stays on cloud** (Morning Desk note, Confluence, 13F story, valuation verdicts,
all live per-view routes, the Google-grounded Ask, and embeddings — the pgvector corpus is
Gemini-768-dim, so switching embed models would invalidate it).

The code side is DONE and env-gated (`lib/llm.ts`): when the two `LLM_LOCAL_*` vars are set,
DEFAULT-tier calls try the local server first and **fall back to OpenRouter automatically on any
failure** — the box being offline never kills a feed. `PRO_MODEL` calls always use OpenRouter.
Until the vars are set, nothing changes.

## 1. Serve a model with vLLM (on the EPYC box)
Dual 3090s = 48 GB VRAM. The overnight window is 8+ hours and the batch needs ~2.5h on the big
model, so **default to the 72B** — the robustness is free in wall-clock terms:
- **Qwen2.5-72B-Instruct-AWQ** — 4-bit across both cards (`--tensor-parallel-size 2`), ~2.5 h/night
  for the full batch, ~1.75 kWh/night (~$5/mo). **BUT: it failed the quality eval — see the verdict
  at the bottom. Don't port to this model; benchmark a newer candidate first.**
- **Qwen2.5-32B-Instruct-AWQ** — ~3× faster (~1 h/night) if you ever need the box back sooner.
- NOT the giant CPU-offload MoEs (DeepSeek-class in the 512 GB RAM): prefill throughput ~100-200
  tok/s can't chew the ~4.5M tokens/night of filing text — 25+ hours. GPU-resident models only.
- Model landscape moves fast — check the current open-weights leaderboard when you set this up;
  the router doesn't care what vLLM serves.

```bash
pip install vllm
vllm serve Qwen/Qwen2.5-72B-Instruct-AWQ \
  --tensor-parallel-size 2 --max-model-len 20000 \
  --api-key <MAKE-UP-A-LONG-TOKEN> --port 8000
# smoke test:
curl -s http://localhost:8000/v1/chat/completions -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"model":"Qwen/Qwen2.5-72B-Instruct-AWQ","messages":[{"role":"user","content":"Return {\"ok\":true} as JSON"}],"response_format":{"type":"json_object"}}'
```
`--max-model-len 20000` covers the largest prompts (15k-char filing slices ≈ 4-5k tokens + schema).

## 2. Expose it to GitHub Actions (do NOT use a self-hosted runner — the repo is public;
## fork PRs could execute code on your box)
Cloudflare Tunnel (free, no open ports):
```bash
cloudflared tunnel --url http://localhost:8000
# → prints https://<random>.trycloudflare.com   (or set up a named tunnel for a stable URL)
```
The vLLM `--api-key` is the auth on top of the tunnel.

## 3. Wire it up
GitHub → repo → Settings → Secrets → Actions, add:
| Secret | Value |
|---|---|
| `LLM_LOCAL_BASE_URL` | `https://<tunnel-host>/v1` |
| `LLM_LOCAL_MODEL` | `Qwen/Qwen2.5-72B-Instruct-AWQ` (exactly as served) |
| `LLM_LOCAL_API_KEY` | the vLLM `--api-key` token |

Then expose them in `.github/workflows/refresh-data.yml` job env (next to OPENROUTER_API_KEY):
```yaml
      LLM_LOCAL_BASE_URL: ${{ secrets.LLM_LOCAL_BASE_URL }}
      LLM_LOCAL_MODEL: ${{ secrets.LLM_LOCAL_MODEL }}
      LLM_LOCAL_API_KEY: ${{ secrets.LLM_LOCAL_API_KEY }}
```
(Left un-wired on purpose until the server exists — add the 3 lines when ready.)
Same 3 vars in `.env.local` to use it from local runs.

## 4. Validate before trusting it
Run two feeds locally against the box and spot-check outputs vs sources (the same validation we
did for GLM): `npm run refresh-corp-events` and `npm run refresh-ipo`, then check
`[llm-usage]` lines — local-model rows meter at $0. Watch the first nightly run's log for
"local …" fallback warnings (a healthy setup shows none).

## What moves / what stays (measured, 2026-07-03)
| Workload | $/run (~22 runs/mo) | Destination |
|---|---|---|
| overnight-filings (4.5M tok/run) | ~$1.09 | **local** |
| event feeds (ipo, campaigns, corp-events, fed, policy, biotech, catalyst-vol, trump) | ~$0.10 | **local** |
| refresh-guidance (317 calls, currently Gemini Pro) | ~$2.18 | local **after** a validation pass (swap its `model: PRO_MODEL` once outputs check out) |
| Desk note, Confluence, 13F story, Congress, valuation verdicts | ~$0.37 | cloud (judgment) |
| Ask (Google-grounded), embeddings, live per-view routes | usage-based | cloud (grounding / latency / corpus) |

Net: **~$10–15/mo cloud + ~$2–4/mo electricity** (the nightly batch is ~1–1.5 h of dual-3090 load
≈ 1 kWh). The FULL run fires 22:47 UTC (~5:47pm CT); if time-of-use rates matter, the LLM-heavy
steps could move to a 06:00 UTC (1am CT) tick — worth ~$2/mo, so only do it if the box sleeps anyway.

## Eval verdict (2026-07-03 — HOLD the port)
Benchmarked the exact production prompts via OpenRouter (`scripts/eval-local-model.ts`, graded
against hand-verified gold): **Qwen2.5-72B underperformed the incumbents** — 4/10 exact comps vs
GLM-5.2 at 7/10, and it rejected **5 of 10 real IPOs** as "not an IPO" (GLM: 2). At ~$70/mo of
savings that quality loss is a bad trade, so the fleet stays on cloud for now. Everything here
stays staged; when a stronger open model appears, run
`CANDIDATE=<openrouter-model-id> npx tsx scripts/eval-local-model.ts`
and port only if it beats GLM on both tasks.

## Update 2026-08-19 — KTransformers re-opens the MoE path; the split; the prefill bench

The "GPU-resident only, no CPU MoEs" call above was made against **llama.cpp** (~10 tok/s prefill).
**KTransformers** (CPU/GPU-hybrid, MoE-specialised) is 7–27× faster — DeepSeek-V3 prefill ~54 tok/s
(32 cores) → ~74 (dual-socket) → **255 with Intel AMX kernels** (SOSP'25). The EPYC box has no AMX,
so expect the ~74 end, not 255 — but that's enough to make a frontier MoE worth benchmarking rather
than dismissing. `qwen3.8-27b` eval (2026-08-19): fails SSS extraction (3/10 exact) but passes IPO
classification (9/10) — so a modest local model is fine for the low-input CLASSIFY fleet; precise
NUMBER extraction (sss/guidance) needs a stronger model or stays cloud.

### What runs where
- **Low-input jobs → LOCAL.** Everything on the bare-default tier auto-routes local the moment
  `LLM_LOCAL_*` is set (see `localEligible()` in lib/llm.ts): IPO classify/summary, catalysts, the
  event feeds. Small prompts ⇒ prefill speed is a non-issue. This IS the "offload the low-input jobs"
  step — **no code change, just the env vars below.**
- **overnight-filings → STAYS CLOUD until the bench says otherwise.** ~4.5M tokens/night; to fit
  run-tick's 45-min step it needs **~1,700 tok/s aggregate** prefill. A 40B-active model won't reach
  that on a non-AMX box; a small-active MoE might. Measure before moving it.
- **Precise-extraction judgment (sss, guidance, valuation) → CLOUD** unless a local model clears the eval.

### Model choice
- **Fastest prefill** (to chase overnight-filings): a *small-active* MoE — `gpt-oss-120b` (~5B active)
  or a `deepseek-v4-flash`-class (13B active). Prefill scales with ACTIVE params, so these run ~3–7×
  faster than a 40B-active model.
- **Best quality, zero eval risk:** run **GLM-5.2 itself** locally (744B/40B active, 4-bit ≈ 370 GB,
  fits 512 GB) — the exact model you already use via OpenRouter, so no quality regression. But its 40B
  active makes it the slow-prefill option, so pair it with the low-input fleet, not overnight-filings.

### Serve + benchmark (on the EPYC/3090 box)
```bash
pip install ktransformers
# Serve an OpenAI-compatible endpoint — see ktransformers' DeepseekR1_V3 tutorial for the exact
# --model / --optimize_config_path / --cpu_infer flags for your MoE: https://github.com/kvcache-ai/ktransformers
# then smoke-test:
curl -s http://localhost:8000/v1/chat/completions -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"model":"<served-id>","messages":[{"role":"user","content":"Return {\"ok\":true}"}],"max_tokens":16}'
```
Then measure the prefill throughput that decides the big job (expose via the same Cloudflare Tunnel as
the vLLM section, or run the bench on the box itself against localhost):
```bash
LLM_LOCAL_BASE_URL=http://localhost:8000/v1 LLM_LOCAL_MODEL=<served-id> LLM_LOCAL_API_KEY=<TOKEN> \
  npm run bench-prefill
```
It prints aggregate tok/s at a few concurrency levels and the verdict: ≥ ~1,700 tok/s ⇒ overnight-filings
can go local too; below ⇒ keep it on cloud flash-lite, low-input jobs still win.

### Activate the low-input offload
Set these three where the jobs run — `tape.env` on the NAS runner (primary), `.env.local` for local
runs, GitHub Actions secrets for the workflow fallback:
```
LLM_LOCAL_BASE_URL=https://<tunnel-host>/v1
LLM_LOCAL_MODEL=<served-id>
LLM_LOCAL_API_KEY=<TOKEN>
```
The code routes the eligible jobs local automatically and falls back to OpenRouter on any local failure,
so the box being offline never drops a feed. Confirm with the first nightly log (no `local …` fallback
warnings) and `npm run llm-costs` (those jobs metering near $0).

## Scoped routing — just the earnings-call digests (2026-09)

The Daily Desk's earnings-call digests (`scripts/refresh-call-digests.ts`) can use the box WITHOUT
switching the whole fleet: set **`CALL_DIGEST_LOCAL_URL`** + **`CALL_DIGEST_LOCAL_MODEL`**
(+ `CALL_DIGEST_LOCAL_API_KEY` if the server wants one) and that step alone maps them onto
`LLM_LOCAL_*` for its own process (`lib/llm` reads the local config per call). Everything else keeps
the process-wide `LLM_LOCAL_*` — unset on the NAS today, i.e. cloud.

Why scoped: the rig's `argus-vllm.service` (LXC 102, `Qwen3-VL-32B-Instruct-AWQ`, TP=2,
`--max-model-len 16384`, `--max-num-seqs 1`) is a one-sequence server. That is fine for a dozen
transcripts a tick (a 2-segment call ≈ 3 requests ≈ 5 min) and hopeless for overnight-filings' ~4.5M
tokens a night inside run-tick's 45-min step timeout. The digest job cuts transcripts into ≤34k-character
segments (~9k tokens + a 2.2k-token reply), which fits the 16k window.

NAS wiring (from the NAS's LAN): `CALL_DIGEST_LOCAL_URL=http://192.168.1.76:8000/v1`,
`CALL_DIGEST_LOCAL_MODEL=argus-vlm` (no key — the server runs without `--api-key`). Deliver via
`tape.env` + a container recreate, or via the R2 runner-env channel (`npm run push-runner-env`).
The tab's footer and the `call-digests:` log line say which model served the run.
