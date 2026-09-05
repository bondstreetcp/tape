/**
 * Render docs/ENV.md from lib/envManifest.ts. Run after adding or changing a knob:
 *   npm run gen-env-reference
 * tests/envManifest fails when the file lags the table, so this can't be forgotten for long.
 */
import { writeFileSync } from "fs";
import path from "path";
import { renderEnvReference, ENV_KNOBS } from "../lib/envManifest";

const out = path.join(process.cwd(), "docs", "ENV.md");
writeFileSync(out, renderEnvReference());
console.log(`gen-env-reference: wrote ${out} (${ENV_KNOBS.length} knobs)`);
