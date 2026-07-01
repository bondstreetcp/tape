"use client";
/** The signed-in user's alert rules (RLS-scoped). No-op when signed out / unconfigured. */
import { useCallback, useEffect, useState } from "react";
import { browserSupabase } from "./client";
import { useUser } from "./useUser";
import type { AlertRule, AlertKind } from "../alerts";

export function useAlertRules() {
  const { user, enabled } = useUser();
  const cloud = enabled && !!user;
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    const sb = browserSupabase();
    if (!sb) return;
    const { data } = await sb
      .from("alert_rules")
      .select("id,symbol,kind,params,active,created_at")
      .order("created_at", { ascending: false });
    if (data) setRules(data as AlertRule[]);
  }, []);

  useEffect(() => {
    if (!cloud) {
      setRules([]);
      return;
    }
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [cloud, reload]);

  const create = useCallback(
    async (r: { symbol: string | null; kind: AlertKind; params: Record<string, unknown> }) => {
      const sb = browserSupabase();
      if (!sb) return;
      await sb.from("alert_rules").insert(r);
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      const sb = browserSupabase();
      if (!sb) return;
      setRules((prev) => prev.filter((r) => r.id !== id));
      const { error } = await sb.from("alert_rules").delete().eq("id", id);
      if (error) await reload(); // revert optimistic drift
    },
    [reload],
  );

  const setActive = useCallback(
    async (id: string, active: boolean) => {
      const sb = browserSupabase();
      if (!sb) return;
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, active } : r)));
      const { error } = await sb.from("alert_rules").update({ active }).eq("id", id);
      if (error) await reload();
    },
    [reload],
  );

  return { rules, loading, cloud, create, remove, setActive };
}
