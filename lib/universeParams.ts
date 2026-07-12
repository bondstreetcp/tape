import { UNIVERSES } from "./universes";

// Shared generateStaticParams for the per-[universe] data pages: prerender each universe at build so
// the route is ISR-cached (paired with `export const revalidate = N`) instead of running the render
// function on every visit — the Fluid-CPU fix. US-only pages short-circuit to a notice for the intl
// universes, so those prerenders are cheap. Re-export from a page as:
//   export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";
export function universeStaticParams(): { universe: string }[] {
  return UNIVERSES.map((u) => ({ universe: u.id }));
}
