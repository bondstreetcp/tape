/**
 * Upload ONLY the per-stock company cache (data/company → company.tar.gz + its stamp) to R2.
 * The Windows box's nightly Task Scheduler job runs `refresh-company-cache` then this — making the
 * desktop the company-cache primary (the box Yahoo serves clean stats to), while the NAS/GH bakes
 * stand down to the fresh stamp and only bake as the fallback. See lib/companyArchive for the
 * whole protocol. Run with: npx tsx --env-file=.env.local scripts/upload-company-cache.ts
 */
import { uploadCompanyArchive } from "../lib/companyArchive";

uploadCompanyArchive()
  .then((m) => console.log(`upload-company-cache: ${(m.bytes / 1e6).toFixed(1)} MB as writer "${m.writer}" @ ${m.bakedAt}`))
  .catch((e) => { console.error("upload-company-cache:", String(e?.message || e)); process.exit(1); });
