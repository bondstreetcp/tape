/**
 * Server Supabase client (RSC + route handlers), bound to the request cookies so Server Components
 * see the signed-in user. Returns null when Supabase isn't configured (see lib/supabase/client).
 */
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const supabaseEnabled = Boolean(URL && ANON);

export async function serverSupabase(): Promise<SupabaseClient | null> {
  if (!supabaseEnabled) return null;
  const store = await cookies();
  return createServerClient(URL as string, ANON as string, {
    cookies: {
      getAll: () => store.getAll(),
      // In a pure RSC the cookie store is read-only and this throws — the middleware refreshes the
      // session cookie instead, so swallow it. In route handlers/actions the write succeeds.
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* read-only cookie context */
        }
      },
    },
  });
}

/** Convenience: the current user (or null) on the server. */
export async function currentUser() {
  const supabase = await serverSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
