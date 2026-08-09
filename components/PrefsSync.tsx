"use client";
/** Runs the local↔cloud prefs merge whenever the auth state lands on signed-in (mount included) —
 *  the cursor, push topic, and pasted book follow the account across devices. Fires
 *  "tape:prefs-synced" so live hooks (useMyNames' book state) re-read localStorage. Renders
 *  nothing; a no-op while auth is unconfigured or signed out. */
import { useEffect, useRef } from "react";
import { useUser } from "@/lib/supabase/useUser";
import { syncPrefs } from "@/lib/userPrefs";

export default function PrefsSync() {
  const { user, enabled } = useUser();
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !user || synced.current === user.id) return;
    synced.current = user.id;
    void syncPrefs().then(() => {
      try { window.dispatchEvent(new Event("tape:prefs-synced")); } catch { /* cosmetic */ }
    });
  }, [enabled, user]);
  return null;
}
