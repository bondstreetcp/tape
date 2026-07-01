"use client";
/**
 * Browser Supabase client (user JWT + Row-Level Security) for client components.
 *
 * ADDITIVE BY DESIGN: `supabaseEnabled` is false until BOTH NEXT_PUBLIC_ vars are set at build time,
 * and every consumer (useWatchlist, useSavedScreens, the alert UI) falls back to localStorage / a
 * signed-out state when this returns null. So the app behaves exactly as before until auth is wired.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseEnabled = Boolean(URL && ANON);

let _client: SupabaseClient | null = null;
/** Singleton browser client, or null when Supabase isn't configured yet. */
export function browserSupabase(): SupabaseClient | null {
  if (!supabaseEnabled) return null;
  if (!_client) _client = createBrowserClient(URL as string, ANON as string);
  return _client;
}
