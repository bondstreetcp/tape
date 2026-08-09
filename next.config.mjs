import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Bake a build stamp into the bundle so the running site can show WHICH deploy is live (see
// components/VersionBadge.tsx). On Vercel, VERCEL_GIT_COMMIT_SHA is provided; locally we read git
// HEAD; if neither is available (e.g. a tarball build with no .git) we fall back to "dev".
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
let sha = process.env.VERCEL_GIT_COMMIT_SHA || "";
if (!sha) {
  try {
    sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    // no git / no .git dir — leave sha empty, VersionBadge shows "dev"
  }
}
const shortSha = sha ? sha.slice(0, 7) : "dev";
const buildTime = new Date().toISOString();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Inlined into the client + server bundles at build time (see next.js `env` config). Powers the
  // always-on version badge — package version + git short-SHA + build time = one glance tells you
  // which deploy you're looking at.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_GIT_SHA: shortSha,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
    // Supabase CLIENT credentials — deliberately committed, not env-plumbed (2026-08-09): the
    // publishable/anon key is DESIGNED to be public (it ships verbatim in every browser bundle;
    // Row-Level Security does the guarding — docs/SETUP-auth.md), and env-at-build-time on the NAS
    // proved fragile (the entrypoint that sources /app/.alert-env couldn't be deployed past a
    // root-owned file, so builds silently produced a signed-out app). The SECRET key stays
    // server-env-only, never here.
    NEXT_PUBLIC_SUPABASE_URL: "https://sjmxwqksrftwqaqpktbm.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_EPmV7obZYYv-avGCdo-ncA_HVe96Q6W",
  },
  // pdf-parse (used by the daily briefing) loads from node_modules at runtime —
  // keep it external so the bundler doesn't trip over its optional deps.
  serverExternalPackages: ["pdf-parse"],
  // Bundle the local market-data JSON into the serverless functions that read it
  // (Vercel's runtime filesystem only contains traced files).
  outputFileTracingIncludes: {
    "/u/**": ["./data/**"],
    "/api/**": ["./data/**"],
  },
};

export default nextConfig;
