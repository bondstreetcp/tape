// Generate a COLLISION-SAFE outputFileTracingExcludes map + validate it with Next's own picomatch
// (Linux-style forward-slash paths, matching the Vercel/NAS build). Emits lib/tracingExcludes.mjs.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ROOT = path.resolve(process.argv[2] && process.argv[2] !== "--write" ? process.argv[2] : ".");
const picomatch = require(path.join(ROOT, "node_modules/next/dist/compiled/picomatch"));
const APP = path.join(ROOT, "app");

// ---------- import-graph analyzer (same taint rules as route-data-analyzer) ----------
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/(^|[\\/])(page|route)\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}
const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"];
function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const ext of exts) { const c = base + ext; if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; }
  for (const ext of exts) { const c = path.join(base, "index" + ext); if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; }
  return null;
}
const importRe = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const cache = new Map();
const read = (f) => { if (!cache.has(f)) cache.set(f, fs.readFileSync(f, "utf8")); return cache.get(f); };
function importsOf(f) { const s = read(f), out = []; let m; importRe.lastIndex = 0; while ((m = importRe.exec(s))) { const r = resolveImport(m[1] || m[2], f); if (r) out.push(r); } return out; }
const DATA_TS = path.join(ROOT, "lib", "data.ts");
const COMPANY_CACHE = path.join(ROOT, "lib", "companyCache.ts");
const COMPANY_ARCHIVE = path.join(ROOT, "lib", "companyArchive.ts");
const usesSeries = (f) => (/loadSymbolSeries|loadManySymbolSeries/.test(read(f)) && f !== DATA_TS) || /["']series["']\s*,\s*["']symbols["']|series\/symbols/.test(read(f));
const usesCompany = (f) => (/loadCompanyBundle|cachedProfile|cachedStats|readCompanyCache|loadCompanyStats/.test(read(f)) && f !== COMPANY_CACHE) || (/["']company["']\s*\)|data[\\/ ]+company|["']company["']\s*,/.test(read(f)) && f !== COMPANY_ARCHIVE);
function analyze(route) {
  const seen = new Set([route]), stack = [route]; let series = false, company = false;
  while (stack.length) { const f = stack.pop(); if (usesSeries(f)) series = true; if (usesCompany(f)) company = true; for (const i of importsOf(f)) if (!seen.has(i)) { seen.add(i); stack.push(i); } }
  return { series, company };
}
function routeId(routeFile) { // matches Next's normalizeAppPath output (brackets kept, /page stripped)
  const rel = path.relative(APP, routeFile).replace(/\\/g, "/").replace(/\/(page|route)\.tsx?$/, "");
  return "/" + rel;
}
const routeKey = (id) => id.replace(/\[[^\]]+\]/g, "*"); // [seg] -> * so picomatch matches the id

const routes = walk(APP).map((f) => { const id = routeId(f); return { id, key: routeKey(id), ...analyze(f) }; });
const seriesIds = routes.filter((r) => r.series).map((r) => r.id);
const companyIds = routes.filter((r) => r.company).map((r) => r.id);

const SERIES = "./data/series/**";
const COMPANY = "./data/company/**";

// ---------- build collision-safe excludes ----------
// For a route R we want to exclude dir D (because R doesn't read D). R's key is a picomatch pattern
// applied with {contains:true}. It's SAFE only if that key matches NO route that DOES need D.
const mm = (pat) => picomatch(pat, { dot: true, contains: true });
function keyIsSafe(key, needIds) { const isM = mm(key); return !needIds.some((id) => isM(id)); }

const excludes = {};
let slimSeries = 0, slimCompany = 0, unsafe = [];
for (const r of routes) {
  const dirs = [];
  if (!r.series) { if (keyIsSafe(r.key, seriesIds)) { dirs.push(SERIES); slimSeries++; } else unsafe.push([r.key, "series"]); }
  if (!r.company) { if (keyIsSafe(r.key, companyIds)) { dirs.push(COMPANY); slimCompany++; } else unsafe.push([r.key, "company"]); }
  if (dirs.length) excludes[r.key] = (excludes[r.key] || []).concat(dirs);
}
// de-dupe values
for (const k of Object.keys(excludes)) excludes[k] = [...new Set(excludes[k])];

// ---------- VALIDATION: prove no needing-route is excluded from its dir (Linux paths) ----------
let violations = 0;
for (const [key, dirs] of Object.entries(excludes)) {
  const isM = mm(key);
  if (dirs.includes(SERIES)) for (const id of seriesIds) if (isM(id)) { console.error("VIOLATION: series-excluded key", key, "matches series route", id); violations++; }
  if (dirs.includes(COMPANY)) for (const id of companyIds) if (isM(id)) { console.error("VIOLATION: company-excluded key", key, "matches company route", id); violations++; }
}
// prove the dir globs match the right FILES and not base files (resolved like Next does: join(dir, glob))
const fileMatch = picomatch([path.join(ROOT, "./data/series/**"), path.join(ROOT, "./data/company/**")].map((p) => p.replace(/\\/g, "/")), { dot: true, contains: true });
const seriesFile = (ROOT + "/data/series/symbols/AAPL.json").replace(/\\/g, "/");
const companyFile = (ROOT + "/data/company/AAPL.json").replace(/\\/g, "/");
const baseFile1 = (ROOT + "/data/market.json").replace(/\\/g, "/");
const baseFile2 = (ROOT + "/data/sp500/snapshot.json").replace(/\\/g, "/");
console.log("\n=== SUMMARY ===");
console.log("routes:", routes.length, "| series-needing:", seriesIds.length, "| company-needing:", companyIds.length);
console.log("excluded series from", slimSeries, "routes | excluded company from", slimCompany, "routes");
console.log("keys skipped for safety (contains-collision):", unsafe.length, unsafe.slice(0, 8));
console.log("VIOLATIONS (must be 0):", violations);
console.log("\n=== file-glob sanity (Linux paths) ===");
console.log("series file excluded? ", fileMatch(seriesFile), "(want true)");
console.log("company file excluded?", fileMatch(companyFile), "(want true)");
console.log("base market.json excluded?  ", fileMatch(baseFile1), "(want FALSE)");
console.log("base snapshot.json excluded?", fileMatch(baseFile2), "(want FALSE)");

// ---------- emit module ----------
const header = `// AUTO-GENERATED by scripts/gen-tracing-excludes.mjs — do not hand-edit.\n// Per-route outputFileTracingExcludes: strips data/series/** and/or data/company/** from the\n// serverless functions that DON'T read them, so Vercel functions stay well under the 250MB limit.\n// Safe by construction: (1) only routes proven (import-graph) not to read a dir are listed; (2) every\n// key is collision-checked against needing-routes under picomatch {contains:true}; (3) excludes only\n// ever REMOVE already-included files (Next applies them after includes), so a stale/expanded route\n// simply keeps the full data/ include. Regenerate: node scripts/gen-tracing-excludes.mjs --write\n`;
const body = `export const tracingExcludes = ${JSON.stringify(excludes, null, 2)};\n`;
const outPath = path.join(ROOT, "lib", "tracingExcludes.mjs");
if (process.argv.includes("--write")) { fs.writeFileSync(outPath, header + body); console.log("\nWROTE", path.relative(ROOT, outPath), "(" + Object.keys(excludes).length + " keys)"); }
else console.log("\n(dry run — pass --write to emit lib/tracingExcludes.mjs)");
