import { redirect } from "next/navigation";

export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// Merger-arb moved to our dedicated ARB tool (2026-08-16, Richard): the standalone site carries the
// full deal book with path-to-close, far richer than the in-app screen ever was. The nav entry opens
// it externally; any deep-link to the old in-app route redirects there too. The refresh-merger-arb
// FEED stays — it still powers the earnings-play stand-aside (lib/catalystOverlay marks acquisition
// targets so a name under a signed deal doesn't get a vol play). This page is just the redirect.
export default function MergerArbPage() {
  redirect("https://arb.truporchhomesvm.com");
}
