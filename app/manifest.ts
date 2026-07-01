import type { MetadataRoute } from "next";

// Web App Manifest — makes Tape installable to the home screen (Android/desktop "Install",
// iOS "Add to Home Screen") with no app store. Next serves this at /manifest.webmanifest and
// auto-injects the <link rel="manifest">.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tape — Equity Research",
    short_name: "Tape",
    description: "Multi-universe equity research terminal — charts, screening, financials, options, earnings, macro, and news.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b0e14",
    theme_color: "#0b0e14",
    categories: ["finance", "business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
