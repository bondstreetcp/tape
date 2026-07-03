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
Dual 3090s = 48 GB VRAM. Two sensible choices:
- **Qwen2.5-72B-Instruct-AWQ** — best quality, fits across both cards (`--tensor-parallel-size 2`), ~15–25 tok/s/stream.
- **Qwen2.5-32B-Instruct-AWQ** — ~3× faster, still strong for schema extraction; start here.

```bash
pip install vllm
vllm serve Qwen/Qwen2.5-32B-Instruct-AWQ \
  --tensor-parallel-size 2 --max-model-len 20000 \
  --api-key <MAKE-UP-A-LONG-TOKEN> --port 8000
# smoke test:
curl -s http://localhost:8000/v1/chat/completions -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"model":"Qwen/Qwen2.5-32B-Instruct-AWQ","messages":[{"role":"user","content":"Return {\"ok\":true} as JSON"}],"response_format":{"type":"json_object"}}'
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
| `LLM_LOCAL_MODEL` | `Qwen/Qwen2.5-32B-Instruct-AWQ` (exactly as served) |
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
