"use client";
import { useCallback, useEffect, useState } from "react";
import type { ScreenSpec } from "./nlScreen";

const KEY = "tape.savedScreens";

export interface SavedScreen { id: string; name: string; query: string; spec: ScreenSpec; createdAt: number }

function read(): SavedScreen[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** localStorage-backed saved NL screens, synced across components in the tab. */
export function useSavedScreens() {
  const [list, setList] = useState<SavedScreen[]>([]);

  useEffect(() => {
    setList(read());
    const onChange = () => setList(read());
    window.addEventListener("storage", onChange);
    window.addEventListener("saved-screens-change", onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("saved-screens-change", onChange);
    };
  }, []);

  const save = useCallback((name: string, query: string, spec: ScreenSpec) => {
    const id = `${Date.now()}-${Math.floor(performance.now() * 1000) % 1000}`;
    const next = [{ id, name, query, spec, createdAt: Date.now() }, ...read()].slice(0, 30);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    window.dispatchEvent(new Event("saved-screens-change"));
  }, []);

  const remove = useCallback((id: string) => {
    try { localStorage.setItem(KEY, JSON.stringify(read().filter((s) => s.id !== id))); } catch { /* ignore */ }
    window.dispatchEvent(new Event("saved-screens-change"));
  }, []);

  return { list, save, remove };
}
