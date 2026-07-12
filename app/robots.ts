import type { MetadataRoute } from "next";

// Keep crawlers off the serverless API surface (per-request compute — LLM/EDGAR/Yahoo fetches) and the
// data-health endpoint. The content pages stay crawlable; a broader crawl limit is a separate call.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: ["/api/"] },
  };
}
