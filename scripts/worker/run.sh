#!/usr/bin/env bash
# The clean-IP worker's one run: hydrate → bake + upload the company cache → read + publish the call digests.
# See docs/SETUP-clean-ip-worker.md. Safe to re-run; every job is incremental and merges into R2.
set -u
cd "$(dirname "$0")/../.." || exit 1
if [ ! -f .env.local ]; then echo "worker: no .env.local (LAKE_S3_* + OPENROUTER_API_KEY) — see docs/SETUP-clean-ip-worker.md"; exit 1; fi
set -a; . ./.env.local; set +a
export TAPE_WRITER="${TAPE_WRITER:-worker}"          # the company-cache stamp names this box; the NAS stands down to a fresh one
export CALL_DIGEST_PUBLISH=1                          # merge + ship data/call-digests.json to R2
export CALL_DIGEST_BUDGET_MIN="${CALL_DIGEST_BUDGET_MIN:-30}"
export ONNXRUNTIME_NODE_INSTALL=skip

echo "worker: $(date -u +%FT%TZ) start (writer $TAPE_WRITER)"
npm run -s data-from-r2 || { echo "worker: hydrate failed — nothing to build on"; exit 1; }
npm run -s refresh-company-cache && npx tsx scripts/upload-company-cache.ts || echo "worker: company cache step failed (the NAS bakes as fallback)"
npm run -s refresh-call-digests || echo "worker: call digests failed (the prior R2 copy stands)"
echo "worker: $(date -u +%FT%TZ) done"
