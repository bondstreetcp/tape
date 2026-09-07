/**
 * Upload the earnings-call archive (data/calls/*) to R2 — site-data/calls.tar.gz + its stamp. For the AD-HOC
 * backfill/ingest workflow (run from ~/tape-ops/repo on the NAS host, outside the tape-runner container): the
 * container's FULL tick uploads the archive automatically, but a clone-built archive needs this to reach R2 so
 * tape-web hydrates it. Needs R2 write creds (LAKE_S3_*): `set -a; . /volume1/docker/tape/tape.env; set +a`.
 *   set -a; . /volume1/docker/tape/tape.env; set +a; npm run sync-calls-archive
 */
import { uploadCallsArchive } from "../lib/callsArchiveSync";
import { countCallRecords } from "../lib/callsArchive";
import { r2Configured } from "../lib/r2";

async function main() {
  if (!r2Configured()) {
    console.error("sync-calls-archive: R2 not configured — source tape.env for LAKE_S3_* first (set -a; . /volume1/docker/tape/tape.env; set +a).");
    process.exit(1);
  }
  const n = await countCallRecords();
  if (!n) {
    console.error("sync-calls-archive: data/calls is empty — run `npm run backfill-transcripts` first.");
    process.exit(1);
  }
  const m = await uploadCallsArchive(n);
  console.log(`sync-calls-archive: uploaded calls.tar.gz (${(m.bytes / 1e6).toFixed(1)} MB, ${n} calls, writer "${m.writer}") — tape-web hydrates it on its next data pull.`);
}

main().catch((e) => { console.error("sync-calls-archive:", String((e as Error)?.message || e)); process.exit(1); });
