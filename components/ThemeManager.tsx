"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Belt-and-suspenders theme persistence: re-asserts the saved theme on `<html>`
 * after every route change, so nothing (a server re-render, router.refresh, a
 * stale streamed shell) can leave the page on the wrong theme. The initial paint
 * is still handled by the inline <head> script in layout.tsx (no FOUC).
 */
export default function ThemeManager() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const light = localStorage.getItem("theme") === "light";
      document.documentElement.classList.toggle("light", light);
    } catch {}
  }, [pathname]);
  return null;
}
