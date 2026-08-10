import { redirect } from "next/navigation";
import { DEFAULT_UNIVERSE } from "@/lib/universes";

// Forward the query string: the auth callback bounces failures to /?auth_error=1, and a bare
// redirect here silently swallowed the param before the notice could render.
export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    for (const one of Array.isArray(v) ? v : v != null ? [v] : []) params.append(k, one);
  }
  const qs = params.toString();
  redirect(`/u/${DEFAULT_UNIVERSE}${qs ? `?${qs}` : ""}`);
}
