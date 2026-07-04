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
