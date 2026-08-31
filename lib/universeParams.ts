import { DEFAULT_UNIVERSE } from "./universes";

// generateStaticParams for the per-[universe] ISR pages. We prerender ONLY the default universe at build;
// every other universe renders ON-DEMAND on first request and is then ISR-cached (each page sets
// `export const revalidate = N`). Re-export from a page as:
//   export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";
//
// This is the balance point between two failure modes. Prerendering ALL ~19 universes × ~72 ISR pages
// against the FULL R2 dataset (which vercel-build hydrates before `next build`) OOM'd / timed out the
// Vercel build — every deploy has failed since that all-universes prerender was introduced (c6df57bc),
// even though it built fine locally on the lighter dataset. Not prerendering at all, conversely, put the
// per-visit render load back onto Fluid CPU (the cap this whole change was avoiding). Default-only keeps
// the highest-traffic pages static and cheap at runtime while keeping the build small enough to finish;
// the long tail of universes still works, generated lazily and cached on first hit.
export function universeStaticParams(): { universe: string }[] {
  return [{ universe: DEFAULT_UNIVERSE }];
}
