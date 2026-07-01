"use client";
/** Current auth user in client components. `enabled` is false until Supabase is configured. */
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { browserSupabase, supabaseEnabled } from "./client";

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(supabaseEnabled);

  useEffect(() => {
    const sb = browserSupabase();
    if (!sb) {
      setLoading(false);
      return;
    }
    let active = true;
    sb.auth.getUser().then(({ data }) => {
      if (active) {
        setUser(data.user ?? null);
        setLoading(false);
      }
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, loading, enabled: supabaseEnabled };
}
