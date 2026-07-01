"use client";
/**
 * Saved NL screens — Postgres-backed (per user, RLS) when signed in, localStorage when not, with a
 * one-time local→cloud merge on first login. Same hook API ({ list, save, remove }) as before.
 */
import { useCallback, useEffect, useState } from "react";
import type { ScreenSpec } from "./nlScreen";
import { browserSupabase } from "./supabase/client";
import { useUser } from "./supabase/useUser";

const KEY = "tape.savedScreens";
let ssMerged = false; // one-time local→cloud merge guard (blocks a StrictMode double-invoke race)

export interface SavedScreen {
  id: string;
  name: string;
  query: string;
  spec: ScreenSpec;
  createdAt: number;
}

function readLocal(): SavedScreen[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeLocal(list: SavedScreen[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

interface Row {
  id: string;
  name: string;
  query: string;
  spec: ScreenSpec;
  created_at: string;
}
const fromRow = (r: Row): SavedScreen => ({ id: r.id, name: r.name, query: r.query, spec: r.spec, createdAt: Date.parse(r.created_at) });

export function useSavedScreens() {
  const { user, enabled } = useUser();
  const cloud = enabled && !!user;
  const [list, setList] = useState<SavedScreen[]>([]);

  const reload = useCallback(async () => {
    const sb = browserSupabase();
    if (!sb) return;
    const { data } = await sb.from("saved_screens").select("id,name,query,spec,created_at").order("created_at", { ascending: false });
    if (data) setList((data as Row[]).map(fromRow));
  }, []);

  useEffect(() => {
    let active = true;
    if (cloud) {
      const sb = browserSupabase();
      if (!sb) return;
      (async () => {
        // One-time merge, guarded + content-deduped (by name|query) so a re-run / StrictMode double
        // invoke can't duplicate rows (saved_screens has a random-uuid PK, so nothing else would).
        const local = readLocal();
        if (local.length && !ssMerged) {
          ssMerged = true;
          try {
            const { data: existing } = await sb.from("saved_screens").select("name,query");
            const have = new Set((existing ?? []).map((r: { name: string; query: string }) => `${r.name}|${r.query}`));
            const toAdd = local.filter((s) => !have.has(`${s.name}|${s.query}`));
            if (toAdd.length) await sb.from("saved_screens").insert(toAdd.map((s) => ({ name: s.name, query: s.query, spec: s.spec })));
            writeLocal([]);
          } catch {
            /* cloud is authoritative — ignore */
          }
        }
        if (active) await reload();
      })();
      return () => {
        active = false;
      };
    }
    setList(readLocal());
    const onChange = () => setList(readLocal());
    window.addEventListener("storage", onChange);
    window.addEventListener("saved-screens-change", onChange);
    return () => {
      active = false;
      window.removeEventListener("storage", onChange);
      window.removeEventListener("saved-screens-change", onChange);
    };
  }, [cloud, reload]);

  const save = useCallback(
    async (name: string, query: string, spec: ScreenSpec) => {
      if (cloud) {
        const sb = browserSupabase();
        if (!sb) return;
        await sb.from("saved_screens").insert({ name, query, spec });
        await reload();
        return;
      }
      const id = `${Date.now()}-${Math.floor(performance.now() * 1000) % 1000}`;
      const next = [{ id, name, query, spec, createdAt: Date.now() }, ...readLocal()].slice(0, 30);
      writeLocal(next);
      window.dispatchEvent(new Event("saved-screens-change"));
    },
    [cloud, reload],
  );

  const remove = useCallback(
    async (id: string) => {
      if (cloud) {
        const sb = browserSupabase();
        if (!sb) return;
        setList((prev) => prev.filter((s) => s.id !== id)); // optimistic
        const { error } = await sb.from("saved_screens").delete().eq("id", id);
        if (error) await reload(); // revert drift on failure
        return;
      }
      writeLocal(readLocal().filter((s) => s.id !== id));
      window.dispatchEvent(new Event("saved-screens-change"));
    },
    [cloud],
  );

  return { list, save, remove };
}
