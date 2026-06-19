"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Tracks the live pixel width of a referenced element via ResizeObserver.
 * Hardened so it never gets stuck at 0 on a cold/direct load (which would blank
 * width-gated children like the sector treemap): it measures via clientWidth →
 * getBoundingClientRect → parent width, only commits positive values, and retries
 * across a couple of frames in case layout isn't settled when the effect runs.
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth || el.getBoundingClientRect().width || el.parentElement?.clientWidth || 0;
      if (w > 0) setWidth((prev) => (prev === w ? prev : w));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    const raf = requestAnimationFrame(measure);
    const t1 = setTimeout(measure, 120);
    const t2 = setTimeout(measure, 400);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return { ref, width };
}
