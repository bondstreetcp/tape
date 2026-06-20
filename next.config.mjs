/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
