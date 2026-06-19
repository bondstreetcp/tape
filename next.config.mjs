/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Bundle the local market-data JSON into the serverless functions that read it
  // (Vercel's runtime filesystem only contains traced files).
  outputFileTracingIncludes: {
    "/u/**": ["./data/**"],
    "/api/**": ["./data/**"],
  },
};

export default nextConfig;
